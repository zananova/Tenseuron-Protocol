// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Creator Bond Escrow Contract
 * 
 * Holds creator bonds (collateral) for network creation.
 * Bonds can be slashed if creator rugs the network.
 * Bonds are released after network proves stable (or slashed on rug).
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract CreatorBondEscrow {
    // Network and creator info
    string public networkId;
    address public creator;
    address public networkToken; // Token used for bond (0x0 for native token)
    
    // Bond details
    uint256 public bondAmount;
    uint256 public bondLockPeriod; // Seconds (e.g., 30 days)
    uint256 public bondLockedAt;
    uint256 public bondReleasedAt;
    
    // Bond status
    enum BondStatus { LOCKED, SLASHED, RELEASED }
    BondStatus public status;
    
    // Graduation-based release
    enum GraduationLevel { SANDBOX, ACTIVE, TRUSTED, OPEN_ECONOMIC }
    GraduationLevel public requiredLevelForRelease; // Minimum level required to release bond
    GraduationLevel public currentNetworkLevel; // Current network graduation level
    address public graduationOracle; // Protocol oracle that can update graduation level
    
    // Slashing
    address public rugDetectionOracle; // Can slash bond on rug detection
    uint256 public slashedAmount;
    address public slashingRecipient; // Where slashed funds go (purpose-bound sinks or burn)
    
    // Events
    event BondLocked(string indexed networkId, address indexed creator, uint256 amount, uint256 lockPeriod);
    event BondSlashed(string indexed networkId, address indexed creator, uint256 amount, string reason);
    event BondReleased(string indexed networkId, address indexed creator, uint256 amount);
    event GraduationLevelUpdated(string indexed networkId, GraduationLevel newLevel);
    
    constructor(
        string memory _networkId,
        address _creator,
        address _networkToken,
        uint256 _bondAmount,
        uint256 _bondLockPeriod,
        address _rugDetectionOracle,
        address _slashingRecipient,
        address _graduationOracle,
        GraduationLevel _requiredLevelForRelease
    ) payable {
        networkId = _networkId;
        creator = _creator;
        networkToken = _networkToken;
        bondAmount = _bondAmount;
        bondLockPeriod = _bondLockPeriod;
        bondLockedAt = block.timestamp;
        rugDetectionOracle = _rugDetectionOracle;
        slashingRecipient = _slashingRecipient;
        graduationOracle = _graduationOracle;
        requiredLevelForRelease = _requiredLevelForRelease; // Default: TRUSTED (Level 2)
        currentNetworkLevel = GraduationLevel.SANDBOX; // Start at Sandbox
        status = BondStatus.LOCKED;
        
        // If native token, require payment
        if (_networkToken == address(0)) {
            require(msg.value >= _bondAmount, "Insufficient bond payment");
        } else {
            // ERC20 token: creator must approve before deployment
            IERC20 token = IERC20(_networkToken);
            require(token.transferFrom(_creator, address(this), _bondAmount), "Token transfer failed");
        }
        
        emit BondLocked(_networkId, _creator, _bondAmount, _bondLockPeriod);
    }
    
    /**
     * Slash bond (called by rug detection oracle on rug detection)
     */
    function slashBond(
        uint256 slashAmount,
        string memory reason
    ) external {
        require(msg.sender == rugDetectionOracle, "Only rug detection oracle can slash");
        require(status == BondStatus.LOCKED, "Bond not locked");
        require(slashAmount > 0 && slashAmount <= bondAmount, "Invalid slash amount");
        
        status = BondStatus.SLASHED;
        slashedAmount = slashAmount;
        
        // Transfer slashed amount to recipient (purpose-bound sinks or burn)
        if (networkToken == address(0)) {
            // Native token
            if (slashingRecipient != address(0)) {
                payable(slashingRecipient).transfer(slashAmount);
            }
            // If slashingRecipient is 0x0, tokens are effectively burned (stuck in contract)
        } else {
            // ERC20 token
            IERC20 token = IERC20(networkToken);
            if (slashingRecipient != address(0)) {
                require(token.transfer(slashingRecipient, slashAmount), "Token transfer failed");
            }
            // If slashingRecipient is 0x0, tokens are effectively burned (stuck in contract)
        }
        
        emit BondSlashed(networkId, creator, slashAmount, reason);
    }
    
    /**
     * Release bond (requires graduation level + lock period)
     * Bond can only be released when network reaches required graduation level
     */
    function releaseBond() external {
        require(status == BondStatus.LOCKED, "Bond not locked");
        require(block.timestamp >= bondLockedAt + bondLockPeriod, "Lock period not expired");
        require(uint256(currentNetworkLevel) >= uint256(requiredLevelForRelease), "Network has not reached required graduation level");
        
        status = BondStatus.RELEASED;
        bondReleasedAt = block.timestamp;
        
        uint256 releaseAmount = bondAmount - slashedAmount;
        
        // Transfer remaining bond to creator
        if (networkToken == address(0)) {
            // Native token
            payable(creator).transfer(releaseAmount);
        } else {
            // ERC20 token
            IERC20 token = IERC20(networkToken);
            require(token.transfer(creator, releaseAmount), "Token transfer failed");
        }
        
        emit BondReleased(networkId, creator, releaseAmount);
    }
    
    /**
     * Update graduation level (called by protocol oracle)
     * Bond release requires both time lock AND graduation level
     */
    function updateGraduationLevel(GraduationLevel newLevel) external {
        require(msg.sender == graduationOracle, "Only graduation oracle can update level");
        require(uint256(newLevel) >= uint256(currentNetworkLevel), "Cannot downgrade graduation level");
        
        currentNetworkLevel = newLevel;
        emit GraduationLevelUpdated(networkId, newLevel);
    }
    
    /**
     * Early release (if network proves stable AND reaches required graduation level)
     * Requires both graduation level AND minimum time (50% of lock period)
     */
    function earlyRelease() external {
        require(status == BondStatus.LOCKED, "Bond not locked");
        require(uint256(currentNetworkLevel) >= uint256(requiredLevelForRelease), "Network has not reached required graduation level");
        require(block.timestamp >= bondLockedAt + (bondLockPeriod / 2), "Too early for early release");
        
        status = BondStatus.RELEASED;
        bondReleasedAt = block.timestamp;
        
        uint256 releaseAmount = bondAmount - slashedAmount;
        
        if (networkToken == address(0)) {
            payable(creator).transfer(releaseAmount);
        } else {
            IERC20 token = IERC20(networkToken);
            require(token.transfer(creator, releaseAmount), "Token transfer failed");
        }
        
        emit BondReleased(networkId, creator, releaseAmount);
    }
    
    /**
     * Get bond status
     */
    function getBondStatus() external view returns (
        BondStatus _status,
        uint256 _bondAmount,
        uint256 _slashedAmount,
        uint256 _remainingAmount,
        uint256 _lockPeriodRemaining,
        GraduationLevel _currentLevel,
        GraduationLevel _requiredLevel,
        bool _canRelease
    ) {
        _status = status;
        _bondAmount = bondAmount;
        _slashedAmount = slashedAmount;
        _remainingAmount = bondAmount - slashedAmount;
        _currentLevel = currentNetworkLevel;
        _requiredLevel = requiredLevelForRelease;
        
        if (status == BondStatus.LOCKED) {
            uint256 elapsed = block.timestamp - bondLockedAt;
            _lockPeriodRemaining = elapsed < bondLockPeriod ? bondLockPeriod - elapsed : 0;
            // Can release if both time lock expired AND graduation level reached
            _canRelease = (_lockPeriodRemaining == 0) && (uint256(_currentLevel) >= uint256(_requiredLevel));
        } else {
            _lockPeriodRemaining = 0;
            _canRelease = false;
        }
    }
}
