// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Validator Registry Contract
 * 
 * On-chain registry of validators for a network
 * Validators must stake tokens to register
 * Escrow contract verifies validators before accepting signatures
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract ValidatorRegistry {
    string public networkId;
    address public networkToken; // Token used for staking (0x0 for native token)
    uint256 public minStake; // Minimum stake required
    
    struct Validator {
        address validatorAddress;
        uint256 stake;
        uint256 registeredAt;
        bool active;
        uint256 reputation; // 0-100, starts at 50
        string p2pEndpoint; // PHASE 5: P2P endpoint (multiaddr format) - REQUIRED
        bytes32 p2pPeerId; // PHASE 5: P2P peer ID hash for verification
    }
    
    mapping(address => Validator) public validators;
    address[] public validatorList; // List of all validator addresses
    
    event ValidatorRegistered(address indexed validator, uint256 stake);
    event ValidatorUnregistered(address indexed validator);
    event StakeUpdated(address indexed validator, uint256 newStake);
    event ReputationUpdated(address indexed validator, uint256 newReputation);
    
    constructor(
        string memory _networkId,
        address _networkToken,
        uint256 _minStake
    ) {
        networkId = _networkId;
        networkToken = _networkToken;
        minStake = _minStake;
    }
    
    /**
     * Register as validator (requires stake and P2P endpoint)
     * PHASE 5: P2P endpoint is mandatory for validators
     */
    function registerValidator(string memory p2pEndpoint, bytes32 p2pPeerId) external payable {
        require(!validators[msg.sender].active, "Already registered");
        require(bytes(p2pEndpoint).length > 0, "P2P endpoint required"); // PHASE 5: Enforce P2P
        
        uint256 stake;
        if (networkToken == address(0)) {
            // Native token stake
            require(msg.value >= minStake, "Stake below minimum");
            stake = msg.value;
        } else {
            // ERC20 token stake
            require(msg.value == 0, "Cannot send native token with ERC20");
            IERC20 token = IERC20(networkToken);
            uint256 allowance = token.allowance(msg.sender, address(this));
            require(allowance >= minStake, "Stake below minimum");
            require(token.transferFrom(msg.sender, address(this), allowance), "Token transfer failed");
            stake = allowance;
        }
        
        validators[msg.sender] = Validator({
            validatorAddress: msg.sender,
            stake: stake,
            registeredAt: block.timestamp,
            active: true,
            reputation: 50, // Start with neutral reputation
            p2pEndpoint: p2pEndpoint, // PHASE 5: Store P2P endpoint
            p2pPeerId: p2pPeerId // PHASE 5: Store P2P peer ID
        });
        
        validatorList.push(msg.sender);
        emit ValidatorRegistered(msg.sender, stake);
    }
    
    /**
     * Unregister validator (returns stake after cooldown)
     */
    function unregisterValidator() external {
        Validator storage validator = validators[msg.sender];
        require(validator.active, "Not registered");
        
        validator.active = false;
        
        // Return stake (in production, might have cooldown period)
        if (networkToken == address(0)) {
            (bool success, ) = msg.sender.call{value: validator.stake}("");
            require(success, "Transfer failed");
        } else {
            IERC20 token = IERC20(networkToken);
            require(token.transfer(msg.sender, validator.stake), "Token transfer failed");
        }
        
        emit ValidatorUnregistered(msg.sender);
    }
    
    /**
     * Check if address is a registered validator
     */
    function isValidator(address validatorAddress) external view returns (bool) {
        return validators[validatorAddress].active;
    }
    
    /**
     * Get validator info
     */
    function getValidator(address validatorAddress) external view returns (
        address validatorAddr,
        uint256 stake,
        uint256 registeredAt,
        bool active,
        uint256 reputation,
        string memory p2pEndpoint,
        bytes32 p2pPeerId
    ) {
        Validator memory validator = validators[validatorAddress];
        return (
            validator.validatorAddress,
            validator.stake,
            validator.registeredAt,
            validator.active,
            validator.reputation,
            validator.p2pEndpoint,
            validator.p2pPeerId
        );
    }
    
    /**
     * PHASE 5: Update P2P endpoint (validators can update their endpoint)
     */
    function updateP2PEndpoint(string memory p2pEndpoint, bytes32 p2pPeerId) external {
        require(validators[msg.sender].active, "Not registered");
        require(bytes(p2pEndpoint).length > 0, "P2P endpoint required");
        
        validators[msg.sender].p2pEndpoint = p2pEndpoint;
        validators[msg.sender].p2pPeerId = p2pPeerId;
    }
    
    /**
     * PHASE 5: Check if validator has P2P endpoint
     */
    function hasP2PEndpoint(address validatorAddress) external view returns (bool) {
        return bytes(validators[validatorAddress].p2pEndpoint).length > 0;
    }
    
    /**
     * Get list of all validators
     */
    function getValidatorList() external view returns (address[] memory) {
        return validatorList;
    }
    
    /**
     * Get count of active validators
     */
    function getValidatorCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < validatorList.length; i++) {
            if (validators[validatorList[i]].active) {
                count++;
            }
        }
        return count;
    }
    
    /**
     * Update validator reputation (called by network logic)
     * In production, this would be called by consensus mechanism
     */
    function updateReputation(address validatorAddress, uint256 newReputation) external {
        // In production, would require consensus or governance
        // For now, allow any caller (network should implement access control)
        require(validators[validatorAddress].active, "Validator not active");
        require(newReputation <= 100, "Reputation must be <= 100");
        
        validators[validatorAddress].reputation = newReputation;
        emit ReputationUpdated(validatorAddress, newReputation);
    }
}
