// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Creator Token Vesting Contract
 * 
 * Locks creator tokens and unlocks them based on network graduation levels.
 * No human control - unlocks are automatic based on protocol-measured network performance.
 * 
 * Graduation Levels:
 * - Level 0 (Sandbox): 0% unlocked
 * - Level 1 (Active): 25% unlocked
 * - Level 2 (Trusted): 50% unlocked
 * - Level 3 (Open Economic): 100% unlocked
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CreatorTokenVesting {
    // Network and creator info
    string public networkId;
    address public creator;
    address public networkToken; // Token being vested (0x0 for native token)
    
    // Vesting details
    uint256 public totalVestedAmount; // Total amount locked
    uint256 public totalUnlockedAmount; // Total amount unlocked so far
    uint256 public vestedAt; // Timestamp when vesting started
    
    // Graduation-based unlocking
    enum GraduationLevel { SANDBOX, ACTIVE, TRUSTED, OPEN_ECONOMIC }
    GraduationLevel public currentLevel;
    
    // Unlock percentages per level (fixed, immutable)
    uint256 public constant LEVEL_0_UNLOCK = 0;    // 0% at Sandbox
    uint256 public constant LEVEL_1_UNLOCK = 25;  // 25% at Active
    uint256 public constant LEVEL_2_UNLOCK = 50;  // 50% at Trusted
    uint256 public constant LEVEL_3_UNLOCK = 100; // 100% at Open Economic
    
    // Protocol oracle (can update graduation level)
    address public graduationOracle; // Protocol oracle that can update graduation level
    
    // Events
    event TokensVested(string indexed networkId, address indexed creator, uint256 amount);
    event GraduationLevelUpdated(string indexed networkId, GraduationLevel newLevel, uint256 unlockedAmount);
    event TokensUnlocked(string indexed networkId, address indexed creator, uint256 amount);
    
    constructor(
        string memory _networkId,
        address _creator,
        address _networkToken,
        uint256 _vestedAmount,
        address _graduationOracle
    ) payable {
        networkId = _networkId;
        creator = _creator;
        networkToken = _networkToken;
        totalVestedAmount = _vestedAmount;
        vestedAt = block.timestamp;
        currentLevel = GraduationLevel.SANDBOX; // Start at Sandbox (0% unlocked)
        graduationOracle = _graduationOracle;
        
        // If native token, require payment
        if (_networkToken == address(0)) {
            require(msg.value >= _vestedAmount, "Insufficient vesting payment");
        } else {
            // ERC20 token: tokens must be transferred to this contract before deployment
            IERC20 token = IERC20(_networkToken);
            require(token.balanceOf(address(this)) >= _vestedAmount, "Insufficient tokens in contract");
        }
        
        emit TokensVested(_networkId, _creator, _vestedAmount);
    }
    
    /**
     * Update graduation level (called by protocol oracle)
     * Automatically unlocks tokens based on new level
     */
    function updateGraduationLevel(GraduationLevel newLevel) external {
        require(msg.sender == graduationOracle, "Only graduation oracle can update level");
        require(uint256(newLevel) > uint256(currentLevel), "Cannot downgrade graduation level");
        
        GraduationLevel oldLevel = currentLevel;
        currentLevel = newLevel;
        
        // Calculate unlock amount based on new level
        uint256 unlockPercentage = _getUnlockPercentage(newLevel);
        uint256 targetUnlocked = (totalVestedAmount * unlockPercentage) / 100;
        uint256 newlyUnlocked = targetUnlocked - totalUnlockedAmount;
        
        if (newlyUnlocked > 0) {
            totalUnlockedAmount = targetUnlocked;
            _transferToCreator(newlyUnlocked);
            emit TokensUnlocked(networkId, creator, newlyUnlocked);
        }
        
        emit GraduationLevelUpdated(networkId, newLevel, newlyUnlocked);
    }
    
    /**
     * Get unlock percentage for a graduation level
     */
    function _getUnlockPercentage(GraduationLevel level) internal pure returns (uint256) {
        if (level == GraduationLevel.SANDBOX) {
            return LEVEL_0_UNLOCK;
        } else if (level == GraduationLevel.ACTIVE) {
            return LEVEL_1_UNLOCK;
        } else if (level == GraduationLevel.TRUSTED) {
            return LEVEL_2_UNLOCK;
        } else if (level == GraduationLevel.OPEN_ECONOMIC) {
            return LEVEL_3_UNLOCK;
        }
        return 0;
    }
    
    /**
     * Transfer unlocked tokens to creator
     */
    function _transferToCreator(uint256 amount) internal {
        require(amount > 0, "Amount must be greater than 0");
        require(totalUnlockedAmount <= totalVestedAmount, "Cannot unlock more than vested");
        
        if (networkToken == address(0)) {
            // Native token
            payable(creator).transfer(amount);
        } else {
            // ERC20 token
            IERC20 token = IERC20(networkToken);
            require(token.transfer(creator, amount), "Token transfer failed");
        }
    }
    
    /**
     * Get vesting status
     */
    function getVestingStatus() external view returns (
        uint256 _totalVested,
        uint256 _totalUnlocked,
        uint256 _remainingLocked,
        GraduationLevel _currentLevel,
        uint256 _unlockPercentage
    ) {
        _totalVested = totalVestedAmount;
        _totalUnlocked = totalUnlockedAmount;
        _remainingLocked = totalVestedAmount - totalUnlockedAmount;
        _currentLevel = currentLevel;
        _unlockPercentage = _getUnlockPercentage(currentLevel);
    }
    
    /**
     * Get available balance (unlocked but not yet withdrawn)
     * For native tokens, this is the contract balance
     * For ERC20 tokens, this is the contract's token balance
     */
    function getAvailableBalance() external view returns (uint256) {
        if (networkToken == address(0)) {
            return address(this).balance;
        } else {
            IERC20 token = IERC20(networkToken);
            return token.balanceOf(address(this));
        }
    }
}
