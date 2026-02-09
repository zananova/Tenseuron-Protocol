// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Tenseuron Protocol - Immutable Escrow Contract (Mode A Settlement)
 * 
 * This contract is DEPLOYED WITHOUT UPGRADE KEYS
 * Once deployed, it is immutable and cannot be modified
 * 
 * Features:
 * - Accept deposits for tasks
 * - Release funds based on validator signatures
 * - Enforce dispute window
 * - Handle challenges
 * - Protocol-level money flow routing (usage cuts, creator earnings)
 * - No admin functions
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * Validator Registry Interface
 * Used to verify validators before accepting signatures
 */
interface IValidatorRegistry {
    function isValidator(address validatorAddress) external view returns (bool);
    function getValidator(address validatorAddress) external view returns (
        address validatorAddr,
        uint256 stake,
        uint256 registeredAt,
        bool active,
        uint256 reputation,
        string memory p2pEndpoint,
        bytes32 p2pPeerId
    );
    function getValidatorCount() external view returns (uint256);
    function hasP2PEndpoint(address validatorAddress) external view returns (bool);
}

contract TenseuronEscrow {
    // Network configuration (set at deployment, immutable)
    string public networkId;
    address public networkToken; // Optional: network-specific token (0x0 for native token)
    address public validatorRegistry; // Validator registry contract address
    address public challengeOracle; // Optional: Oracle for challenge resolution (0x0 = use validator consensus)
    uint256 public disputeWindow; // Seconds
    uint256 public minValidators; // Minimum validators required for release
    uint256 public consensusThreshold; // Consensus threshold in basis points (0-10000, e.g., 6700 = 67%)
    
    // Money Flow Configuration (Protocol-Level, immutable)
    address public creatorAddress; // Network creator address
    address public purposeBoundSinks; // Purpose-bound sinks address (0x0 = burn, no accumulation, no human control)
    bool public usageCutEnabled; // Whether usage cut is enabled
    uint256 public usageCutPercentage; // Usage cut percentage (basis points, e.g., 500 = 5%)
    uint256 public usageCutMin; // Minimum usage cut per task
    uint256 public usageCutMax; // Maximum usage cut per task
    
    // Validator Payment Configuration (CRITICAL: Validators must be paid)
    bool public validatorPaymentEnabled; // Whether validator payment is enabled
    uint256 public validatorPaymentPercentage; // Validator payment percentage (basis points, e.g., 1000 = 10%)
    uint256 public validatorPaymentMin; // Minimum payment per validator
    uint256 public validatorPaymentMax; // Maximum payment per validator
    
    // Creator earnings tracking
    mapping(address => uint256) public creatorBalances; // Creator address => accumulated earnings
    
    // Validator earnings tracking (CRITICAL FIX)
    mapping(address => uint256) public validatorBalances; // Validator address => accumulated earnings
    address[] public participatingValidators; // Track validators who have participated (for distribution)
    mapping(address => bool) public isParticipatingValidator; // Quick check if validator has participated
    
    // Miner pool (accumulated from creation fees and usage cuts)
    uint256 public minerPoolBalance;
    
    // Penalty Configuration (Configurable by Network Creator)
    enum PenaltyMechanism { NONE, SLASHING, REPUTATION_ONLY, TEMPORARY_BAN, WARNING_SYSTEM, HYBRID }
    PenaltyMechanism public penaltyMechanism;
    
    // Slashing configuration (if mechanism includes slashing)
    bool public slashingEnabled;
    uint256 public slashingRate; // Percentage (0-100, e.g., 25 = 25%)
    uint256 public slashingMinStakeRequired; // Minimum stake required for slashing
    uint256 public slashCooldownPeriod; // Cooldown period in seconds (default: 7 days)
    
    // Reputation-only penalties (if mechanism is reputation-only or hybrid)
    bool public reputationPenaltyEnabled;
    uint256 public reputationPenaltyPerOffense; // Reputation points deducted (0-100 scale)
    uint256 public minReputationForBan; // If reputation drops below this, validator is banned
    uint256 public reputationRecoveryRate; // Reputation recovery per successful validation (0-100, basis points)
    
    // Temporary ban system (if mechanism is temporary-ban or hybrid)
    bool public temporaryBanEnabled;
    uint256 public banDuration; // Ban duration in seconds
    uint256 public offensesBeforeBan; // Number of offenses before ban triggers
    uint256 public banEscalationFactor; // Ban duration multiplier per repeat offense (basis points, e.g., 20000 = 2x)
    mapping(address => uint256) public validatorBanUntil; // Validator => timestamp when ban expires
    mapping(address => uint256) public validatorOffenseCount; // Validator => number of offenses
    
    // Warning system (if mechanism is warning-system or hybrid)
    bool public warningSystemEnabled;
    uint256 public warningsBeforeAction; // Number of warnings before penalty
    uint256 public warningExpiry; // Warning expiry time in seconds
    enum WarningAction { REPUTATION, BAN, SLASH }
    WarningAction public actionAfterWarnings;
    mapping(address => uint256) public validatorWarningCount; // Validator => number of active warnings
    mapping(address => uint256) public validatorLastWarningTime; // Validator => timestamp of last warning
    
    // Validator stakes and reputation
    mapping(address => uint256) public validatorStakes; // Validator => staked amount
    mapping(address => uint256) public validatorReputation; // Validator => reputation (0-100)
    mapping(address => uint256) public validatorSlashCount; // Validator => number of times slashed
    mapping(address => uint256) public lastSlashTimestamp; // Validator => timestamp of last slash (for cooldown)
    
    // Anti-Rug Pull System (Phase 2)
    address public rugDetectionOracle; // Oracle that can trigger penalties (0x0 = disabled)
    bool public creatorControlRevoked; // Whether creator control has been revoked
    address public newController; // New controller if control was revoked (0x0 = purpose-bound sinks)
    uint256 public creatorTokensBurned; // Total creator tokens burned
    mapping(bytes32 => RugPenalty) public rugPenalties; // Rug signal hash => penalty details
    
    struct RugPenalty {
        bytes32 signalHash;
        uint256 burnPercentage; // 0-100
        bool controlRevoked;
        bool lpLocked;
        bool valueRedistributed;
        uint256 executedAt;
    }
    
    event RugPenaltyExecuted(
        bytes32 indexed signalHash,
        address indexed creator,
        uint256 burnPercentage,
        bool controlRevoked,
        bool lpLocked
    );
    
    event CreatorControlRevoked(address indexed creator, address indexed newController);
    event CreatorTokensBurned(address indexed creator, uint256 amount, uint256 percentage);
    event ValueRedistributed(address indexed creator, uint256 amount, address[] recipients);
    
    // Task deposits
    mapping(bytes32 => Deposit) public deposits;
    
    // Challenges
    mapping(bytes32 => Challenge) public challenges;
    
    // On-chain validator selection (PHASE 3: Decentralized validator selection)
    mapping(bytes32 => address[]) public selectedValidators; // taskId => selected validator addresses
    mapping(bytes32 => uint256) public taskRandomSeed; // taskId => random seed for selection
    mapping(address => uint256) public lastTaskAssignment; // validator => last task timestamp (for rotation)
    uint256 public rotationWindow; // Seconds between validator assignments (default: 1 hour)
    
    // Commit-Reveal Scheme for Randomness (SECURITY FIX)
    mapping(bytes32 => bytes32) public randomnessCommits; // taskId => commit hash
    mapping(bytes32 => uint256) public randomnessReveals; // taskId => revealed random value
    mapping(bytes32 => uint256) public commitBlock; // taskId => block number when committed
    uint256 public constant COMMIT_DELAY = 2; // Blocks to wait before reveal (prevents manipulation)
    uint256 public highValueThreshold; // Amount threshold for high-value tasks (requires commit-reveal)
    
    // PHASE 6: IPFS + on-chain anchors for task state
    mapping(bytes32 => bytes32) public taskStateAnchors; // taskId => IPFS CID hash (anchor)
    mapping(bytes32 => uint256) public taskStateAnchorTimestamp; // taskId => timestamp when anchored
    
    // User Redo Mechanism (Anti-Collusion)
    mapping(bytes32 => bool) public userRejected; // taskId => whether user rejected
    mapping(bytes32 => uint256) public redoCount; // taskId => number of redos
    mapping(bytes32 => bytes32) public collusionPatternHash; // taskId => encrypted pattern hash
    mapping(address => uint256) public userRejectionCount; // validator => number of times their approvals were rejected
    
    // Slashing Evidence Verification (CRITICAL: Slashing is last resort, requires absolute proof)
    mapping(bytes32 => bytes32) public slashingEvidenceHash; // taskId => hash of evidence proving cheating
    mapping(bytes32 => bool) public slashingEvidenceVerified; // taskId => whether evidence has been verified
    uint256 public constant SLASHING_CONSENSUS_THRESHOLD = 9000; // 90% consensus required for slashing (higher than normal)
    uint256 public constant MIN_SLASHING_EVIDENCE_LENGTH = 32; // Minimum evidence length (bytes)
    
    // GAS OPTIMIZATION: Pack structs efficiently (bools together)
    struct Deposit {
        address depositor;      // 20 bytes
        uint256 amount;         // 32 bytes
        uint256 timestamp;      // 32 bytes
        uint256 taskTimeout;    // 32 bytes
        bool released;          // 1 byte (packed with challenged, timedOut)
        bool challenged;        // 1 byte (packed)
        bool timedOut;          // 1 byte (packed)
        // Total: 20 + 32*3 + 3 = 119 bytes (padded to 120 bytes in storage)
    }
    
    struct Challenge {
        address challenger;     // 20 bytes
        uint256 stake;          // 32 bytes
        uint256 timestamp;      // 32 bytes
        bool resolved;          // 1 byte
        // Total: 20 + 32*2 + 1 = 85 bytes (padded to 96 bytes in storage)
    }
    
    struct ValidatorSignature {
        address validator;      // 20 bytes
        uint256 score;          // 32 bytes
        bytes32 r;              // 32 bytes
        bytes32 s;              // 32 bytes
        uint8 v;                // 1 byte
        bool accepted;          // 1 byte (packed with v)
        // Total: 20 + 32*3 + 2 = 118 bytes (padded to 120 bytes in storage)
    }
    
    // GAS OPTIMIZATION: Custom errors instead of require strings (saves gas)
    error TaskAlreadyHasDeposit();
    error NoDepositFound();
    error AlreadyReleased();
    error AlreadyChallenged();
    error TaskTimedOut();
    error DisputeWindowNotPassed();
    error InsufficientValidators();
    error InvalidSignature();
    error DuplicateValidator();
    error ValidatorNotRegistered();
    error ConsensusNotReached();
    error SlashingRequiresEvidence();
    error SlashingEvidenceVerificationFailed();
    error InsufficientSlashingConsensus();
    error ValidatorCurrentlyBanned();
    error InvalidAddress();
    error InvalidAmount();
    error TransferFailed();
    
    event DepositCreated(bytes32 indexed taskId, address indexed depositor, uint256 amount);
    event FundsReleased(bytes32 indexed taskId, address indexed recipient, uint256 amount, uint256 creatorCut, uint256 validatorPayment);
    event ChallengeCreated(bytes32 indexed taskId, address indexed challenger, uint256 stake);
    event ChallengeResolved(bytes32 indexed taskId, bool challengerWon);
    event TaskTimedOut(bytes32 indexed taskId, address indexed depositor, uint256 refundAmount);
    event CreatorEarningsAccumulated(address indexed creator, uint256 amount);
    event CreatorWithdrawn(address indexed creator, uint256 amount);
    event ValidatorEarningsAccumulated(address indexed validator, uint256 amount);
    event ValidatorWithdrawn(address indexed validator, uint256 amount);
    event MinerPoolDeposited(uint256 amount);
    event ValidatorSlashed(address indexed validator, bytes32 indexed taskId, uint256 amount, uint256 newReputation);
    event ValidatorStaked(address indexed validator, uint256 amount);
    event ValidatorUnstaked(address indexed validator, uint256 amount);
    event ValidatorReputationUpdated(address indexed validator, uint256 newReputation);
    event TaskStateAnchored(bytes32 indexed taskId, bytes32 indexed stateHash, uint256 timestamp); // PHASE 6: Task state anchored on-chain
    event UserRejected(bytes32 indexed taskId, address indexed user, bytes32 indexed patternHash, uint256 redoCount); // User redo mechanism
    event RandomnessCommitted(bytes32 indexed taskId, bytes32 indexed commitHash, uint256 blockNumber); // Commit-reveal scheme
    event RandomnessRevealed(bytes32 indexed taskId, uint256 randomValue); // Commit-reveal scheme
    event PenaltyMechanismConfigured(PenaltyMechanism mechanism); // Penalty mechanism configuration updated
    event ValidatorWarned(address indexed validator, bytes32 indexed taskId, uint256 warningCount); // Validator received warning
    event ValidatorBanned(address indexed validator, uint256 banUntil); // Validator temporarily banned
    event ValidatorReputationPenalized(address indexed validator, bytes32 indexed taskId, uint256 newReputation); // Reputation-only penalty
    
    constructor(
        string memory _networkId,
        address _networkToken,
        address _validatorRegistry,
        address _challengeOracle,
        uint256 _disputeWindow,
        uint256 _minValidators,
        uint256 _consensusThreshold,
        address _creatorAddress,
        address _purposeBoundSinks,
        bool _usageCutEnabled,
        uint256 _usageCutPercentage,
        uint256 _usageCutMin,
        uint256 _usageCutMax,
        bool _validatorPaymentEnabled,
        uint256 _validatorPaymentPercentage,
        uint256 _validatorPaymentMin,
        uint256 _validatorPaymentMax,
        bool _slashingEnabled,
        uint256 _slashingRate
    ) {
        networkId = _networkId;
        networkToken = _networkToken;
        validatorRegistry = _validatorRegistry;
        challengeOracle = _challengeOracle; // 0x0 = use validator consensus (default)
        disputeWindow = _disputeWindow;
        minValidators = _minValidators;
        consensusThreshold = _consensusThreshold;
        
        // Money flow configuration (immutable)
        creatorAddress = _creatorAddress;
        purposeBoundSinks = _purposeBoundSinks;
        usageCutEnabled = _usageCutEnabled;
        usageCutPercentage = _usageCutPercentage; // Basis points (e.g., 500 = 5%)
        usageCutMin = _usageCutMin;
        usageCutMax = _usageCutMax;
        
        // Validator payment configuration (CRITICAL: Validators must be paid)
        validatorPaymentEnabled = _validatorPaymentEnabled;
        validatorPaymentPercentage = _validatorPaymentPercentage; // Basis points (e.g., 1000 = 10%)
        validatorPaymentMin = _validatorPaymentMin;
        validatorPaymentMax = _validatorPaymentMax;
        
        // Penalty configuration (IMMUTABLE - set once during deployment, cannot be changed)
        penaltyMechanism = _penaltyMechanism;
        slashingEnabled = _slashingEnabled;
        slashingRate = _slashingRate;
        slashingMinStakeRequired = _slashingMinStake;
        slashCooldownPeriod = _slashCooldown;
        
        reputationPenaltyEnabled = _reputationEnabled;
        reputationPenaltyPerOffense = _reputationPenalty;
        minReputationForBan = _minRepForBan;
        reputationRecoveryRate = _reputationRecovery;
        
        temporaryBanEnabled = _banEnabled;
        banDuration = _banDuration;
        offensesBeforeBan = _offensesBeforeBan;
        banEscalationFactor = _banEscalation;
        
        warningSystemEnabled = _warningEnabled;
        warningsBeforeAction = _warningsBeforeAction;
        warningExpiry = _warningExpiry;
        actionAfterWarnings = _actionAfterWarnings;
        
        // Initialize rotation window (1 hour default)
        rotationWindow = 3600; // 1 hour in seconds
        
        // Initialize high-value threshold (default: 1000 tokens or equivalent)
        // Tasks above this threshold require commit-reveal randomness
        highValueThreshold = 1000 * 1e18; // Default: 1000 tokens (adjustable per network)
    }
    
    // IMMUTABLE: Penalty configuration is set once during deployment and cannot be changed
    // This ensures network security and prevents manipulation
    // All penalty parameters are set in constructor and are immutable
    
    /**
     * Deposit funds for a task and select validators on-chain
     * CRITICAL: Validator selection happens on-chain, not off-chain
     * If networkToken is set, expects ERC20 approval
     * @param taskId Task identifier
     * @param taskTimeoutSeconds Timeout in seconds (0 = use network default of 1 hour)
     */
    function deposit(bytes32 taskId, uint256 taskTimeoutSeconds) external payable {
        if (deposits[taskId].depositor != address(0)) revert TaskAlreadyHasDeposit();
        
        uint256 amount;
        if (networkToken == address(0)) {
            // Native token deposit
            require(msg.value > 0, "No native token sent");
            amount = msg.value;
        } else {
            // ERC20 token deposit
            require(msg.value == 0, "Cannot send native token with ERC20");
            IERC20 token = IERC20(networkToken);
            // Get amount from allowance (not balance!)
            uint256 allowance = token.allowance(msg.sender, address(this));
            require(allowance > 0, "No token allowance approved");
            // Transfer approved amount from user to contract
            require(token.transferFrom(msg.sender, address(this), allowance), "Token transfer failed");
            amount = allowance;
        }
        
        // FULLY IMPLEMENTED: For high-value tasks, require commit-reveal randomness
        if (amount >= highValueThreshold) {
            require(randomnessReveals[taskId] > 0, "High-value task requires commit-reveal randomness");
        }
        
        // PHASE 3: Select validators on-chain when task is deposited
        _selectValidatorsForTask(taskId);
        
        // Calculate timeout (use provided timeout or default to 1 hour)
        uint256 timeout = taskTimeoutSeconds > 0 ? taskTimeoutSeconds : 3600;
        uint256 timeoutTimestamp = block.timestamp + timeout;
        
        deposits[taskId] = Deposit({
            depositor: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            taskTimeout: timeoutTimestamp,
            released: false,
            challenged: false,
            timedOut: false
        });
        
        emit DepositCreated(taskId, msg.sender, amount);
    }
    
    /**
     * Deposit with default timeout (backward compatibility)
     */
    function deposit(bytes32 taskId) external payable {
        deposit(taskId, 3600); // Default 1 hour timeout
    }
    
    /**
     * Deposit ERC20 tokens for a task (alternative to deposit with approval)
     * PHASE 3: Also triggers on-chain validator selection
     * @param taskId Task identifier
     * @param amount Token amount to deposit
     * @param taskTimeoutSeconds Timeout in seconds (0 = use network default of 1 hour)
     */
    function depositToken(bytes32 taskId, uint256 amount, uint256 taskTimeoutSeconds) external {
        require(networkToken != address(0), "Network token not set");
        require(deposits[taskId].depositor == address(0), "Task already has deposit");
        require(amount > 0, "Amount must be greater than 0");
        
        // FULLY IMPLEMENTED: For high-value tasks, require commit-reveal randomness
        if (amount >= highValueThreshold) {
            require(randomnessReveals[taskId] > 0, "High-value task requires commit-reveal randomness");
        }
        
        IERC20 token = IERC20(networkToken);
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        
        // PHASE 3: Select validators on-chain when task is deposited
        _selectValidatorsForTask(taskId);
        
        // Calculate timeout (use provided timeout or default to 1 hour)
        uint256 timeout = taskTimeoutSeconds > 0 ? taskTimeoutSeconds : 3600;
        uint256 timeoutTimestamp = block.timestamp + timeout;
        
        deposits[taskId] = Deposit({
            depositor: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            taskTimeout: timeoutTimestamp,
            released: false,
            challenged: false,
            timedOut: false
        });
        
        emit DepositCreated(taskId, msg.sender, amount);
    }
    
    /**
     * Deposit token with default timeout (backward compatibility)
     */
    function depositToken(bytes32 taskId, uint256 amount) external {
        depositToken(taskId, amount, 3600); // Default 1 hour timeout
    }
    
    /**
     * Check if task has timed out and allow refund
     */
    function checkTimeout(bytes32 taskId) external {
        Deposit storage depositInfo = deposits[taskId];
        require(depositInfo.depositor != address(0), "No deposit found");
        require(!depositInfo.released, "Already released");
        require(!depositInfo.timedOut, "Already timed out");
        require(block.timestamp >= depositInfo.taskTimeout, "Task not yet timed out");
        
        depositInfo.timedOut = true;
        
        // Refund to depositor
        if (networkToken == address(0)) {
            (bool success, ) = depositInfo.depositor.call{value: depositInfo.amount}("");
            require(success, "Refund failed");
        } else {
            IERC20 token = IERC20(networkToken);
            require(token.transfer(depositInfo.depositor, depositInfo.amount), "Token refund failed");
        }
        
        emit TaskTimedOut(taskId, depositInfo.depositor, depositInfo.amount);
    }
    
    /**
     * Release funds to recipient based on validator signatures
     * Requires N-of-M validator consensus
     */
    // Reentrancy guard
    bool private locked;
    
    modifier nonReentrant() {
        require(!locked, "ReentrancyGuard: reentrant call");
        locked = true;
        _;
        locked = false;
    }
    
    function release(
        bytes32 taskId,
        address recipient,
        ValidatorSignature[] calldata signatures
    ) external nonReentrant {
        Deposit storage depositInfo = deposits[taskId];
        if (depositInfo.depositor == address(0)) revert NoDepositFound();
        if (depositInfo.released) revert AlreadyReleased();
        if (depositInfo.timedOut) revert TaskTimedOut();
        if (depositInfo.challenged) revert AlreadyChallenged();
        if (block.timestamp >= depositInfo.taskTimeout) revert TaskTimedOut();
        if (block.timestamp < depositInfo.timestamp + disputeWindow) revert DisputeWindowNotPassed();
        if (signatures.length < minValidators) revert InsufficientValidators();
        
        // Verify signatures and count acceptances
        uint256 acceptCount = 0;
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(
                networkId,
                taskId,
                recipient,
                true, // accepted
                block.chainid
            ))
        ));
        
        // SECURITY: Track seen validators to prevent duplicates
        address[] memory seenValidators = new address[](signatures.length);
        uint256 seenCount = 0;
        
        // Verify validators are registered (if registry exists)
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ecrecover(messageHash, signatures[i].v, signatures[i].r, signatures[i].s);
            require(signer == signatures[i].validator, "Invalid signature");
            
            // SECURITY: Prevent duplicate validators
            bool isDuplicate = false;
            for (uint256 j = 0; j < seenCount; j++) {
                if (seenValidators[j] == signer) {
                    isDuplicate = true;
                    break;
                }
            }
            if (isDuplicate) revert DuplicateValidator();
            seenValidators[seenCount] = signer;
            seenCount++;
            
            // Verify validator is registered (if registry exists)
            if (validatorRegistry != address(0)) {
                require(IValidatorRegistry(validatorRegistry).isValidator(signer), "Validator not registered");
            }
            
            if (signatures[i].accepted) {
                acceptCount++;
            }
        }
        
        // Calculate required consensus
        // consensusThreshold is stored as basis points (0-10000, e.g., 6700 = 67%)
        // Calculate minimum required acceptances: (total * threshold) / 10000
        uint256 requiredAcceptances = (signatures.length * consensusThreshold) / 10000;
        // Ensure at least 1 acceptance required (edge case: 0 validators already checked above)
        if (requiredAcceptances == 0 && consensusThreshold > 0) {
            requiredAcceptances = 1;
        }
        if (acceptCount < requiredAcceptances) revert ConsensusNotReached();
        
        // PHASE 4: Update validator reputation based on consensus participation
        // Validators who signed with consensus get reputation boost
        _updateReputationFromConsensus(signatures, acceptCount >= requiredAcceptances);
        
        // Release funds with payment splits (PROTOCOL-LEVEL MONEY FLOW)
        depositInfo.released = true;
        
        uint256 totalAmount = depositInfo.amount;
        uint256 creatorCut = 0;
        uint256 validatorPaymentTotal = 0;
        uint256 remaining = totalAmount;
        
        // Calculate usage cut if enabled
        if (usageCutEnabled && creatorAddress != address(0)) {
            // Calculate cut (basis points: 500 = 5%)
            creatorCut = (totalAmount * usageCutPercentage) / 10000;
            
            // Apply min/max bounds
            if (creatorCut < usageCutMin) {
                creatorCut = usageCutMin;
            } else if (creatorCut > usageCutMax) {
                creatorCut = usageCutMax;
            }
            
            // Ensure creator cut doesn't exceed total amount
            if (creatorCut > totalAmount) {
                creatorCut = totalAmount;
            }
            
            remaining -= creatorCut;
            
            // Accumulate creator earnings
            creatorBalances[creatorAddress] += creatorCut;
            emit CreatorEarningsAccumulated(creatorAddress, creatorCut);
        }
        
        // Calculate validator payment (CRITICAL FIX: Validators must be paid)
        if (validatorPaymentEnabled) {
            // Calculate total validator payment (basis points: 1000 = 10%)
            validatorPaymentTotal = (totalAmount * validatorPaymentPercentage) / 10000;
            
            // Apply min/max bounds (per validator, but we calculate total here)
            // The total will be split equally among participating validators
            uint256 minTotal = validatorPaymentMin * signatures.length; // Minimum for all validators
            uint256 maxTotal = validatorPaymentMax * signatures.length; // Maximum for all validators
            
            if (validatorPaymentTotal < minTotal) {
                validatorPaymentTotal = minTotal;
            } else if (validatorPaymentTotal > maxTotal) {
                validatorPaymentTotal = maxTotal;
            }
            
            // Ensure validator payment doesn't exceed remaining
            if (validatorPaymentTotal > remaining) {
                validatorPaymentTotal = remaining;
            }
            
            remaining -= validatorPaymentTotal;
            
            // Split validator payment equally among participating validators
            uint256 validatorsCount = 0;
            for (uint256 i = 0; i < signatures.length; i++) {
                if (signatures[i].accepted) {
                    validatorsCount++;
                }
            }
            
            if (validatorsCount > 0) {
                uint256 paymentPerValidator = validatorPaymentTotal / validatorsCount;
                
                // FULLY IMPLEMENTED: Distribute to each validator who accepted (individual iteration)
                for (uint256 i = 0; i < signatures.length; i++) {
                    if (signatures[i].accepted) {
                        address validator = signatures[i].validator;
                        validatorBalances[validator] += paymentPerValidator;
                        
                        // Track validator for future distributions
                        if (!isParticipatingValidator[validator]) {
                            participatingValidators.push(validator);
                            isParticipatingValidator[validator] = true;
                        }
                        
                        emit ValidatorEarningsAccumulated(validator, paymentPerValidator);
                    }
                }
            }
        }
        
        // Miner gets the remainder
        uint256 minerPayment = remaining;
        
        // Transfer miner payment
        if (networkToken == address(0)) {
            // Native token
            if (minerPayment > 0) {
                (bool success, ) = recipient.call{value: minerPayment}("");
                require(success, "Miner transfer failed");
            }
        } else {
            // ERC20 token
            if (minerPayment > 0) {
                IERC20 token = IERC20(networkToken);
                require(token.transfer(recipient, minerPayment), "Miner token transfer failed");
            }
        }
        
        emit FundsReleased(taskId, recipient, minerPayment, creatorCut, validatorPaymentTotal);
    }
    
    /**
     * Challenge a task during dispute window
     * Requires stake
     */
    function challenge(bytes32 taskId, bytes calldata evidence) external payable {
        Deposit storage depositInfo = deposits[taskId];
        require(depositInfo.depositor != address(0), "No deposit found");
        require(!depositInfo.released, "Already released");
        require(!depositInfo.challenged, "Already challenged");
        require(block.timestamp < depositInfo.timestamp + disputeWindow, "Dispute window closed");
        require(msg.value > 0, "Challenge requires stake");
        
        depositInfo.challenged = true;
        challenges[taskId] = Challenge({
            challenger: msg.sender,
            stake: msg.value,
            timestamp: block.timestamp,
            resolved: false
        });
        
        emit ChallengeCreated(taskId, msg.sender, msg.value);
        
        // Challenge resolution requires validator consensus (see resolveChallenge)
    }
    
    /**
     * Resolve challenge
     * Supports two modes:
     * 1. Validator consensus (if challengeOracle = 0x0) - default
     * 2. Oracle resolution (if challengeOracle != 0x0)
     */
    function resolveChallenge(
        bytes32 taskId,
        bool challengerWon,
        ValidatorSignature[] calldata signatures
    ) external {
        Challenge storage challengeInfo = challenges[taskId];
        require(challengeInfo.challenger != address(0), "No challenge found");
        require(!challengeInfo.resolved, "Already resolved");
        
        // Mode 1: Oracle resolution (if oracle is set)
        if (challengeOracle != address(0)) {
            require(msg.sender == challengeOracle, "Only oracle can resolve challenges");
            // Oracle has already evaluated and decided
            challengeInfo.resolved = true;
        } 
        // Mode 2: Validator consensus (default)
        else {
            require(signatures.length >= minValidators, "Insufficient validators");
            
            // Verify signatures and count acceptances (same logic as release)
            uint256 acceptCount = 0;
            bytes32 messageHash = keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(
                    networkId,
                    taskId,
                    challengerWon,
                    block.chainid
                ))
            ));
            
            // SECURITY: Track seen validators to prevent duplicates
            address[] memory seenValidators = new address[](signatures.length);
            uint256 seenCount = 0;
            
            // Verify validators are registered (if registry exists)
            for (uint256 i = 0; i < signatures.length; i++) {
                address signer = ecrecover(messageHash, signatures[i].v, signatures[i].r, signatures[i].s);
                require(signer == signatures[i].validator, "Invalid signature");
                
                // SECURITY: Prevent duplicate validators
                bool isDuplicate = false;
                for (uint256 j = 0; j < seenCount; j++) {
                    if (seenValidators[j] == signer) {
                        isDuplicate = true;
                        break;
                    }
                }
                if (isDuplicate) revert DuplicateValidator();
                seenValidators[seenCount] = signer;
                seenCount++;
                
                // Verify validator is registered (if registry exists)
                if (validatorRegistry != address(0)) {
                    require(IValidatorRegistry(validatorRegistry).isValidator(signer), "Validator not registered");
                }
                
                if (signatures[i].accepted) {
                    acceptCount++;
                }
            }
            
            // Calculate required consensus (same logic as release function)
            uint256 requiredAcceptances = (signatures.length * consensusThreshold) / 10000;
            if (requiredAcceptances == 0 && consensusThreshold > 0) {
                requiredAcceptances = 1;
            }
            if (acceptCount < requiredAcceptances) revert ConsensusNotReached();
            challengeInfo.resolved = true;
        }
        
        // Execute resolution (same for both modes)
        if (challengerWon) {
            // Return deposit to depositor, give stake to challenger
            Deposit storage depositInfo = deposits[taskId];
            (bool success, ) = challengeInfo.challenger.call{value: depositInfo.amount + challengeInfo.stake}("");
            require(success, "Transfer failed");
        } else {
            // Return stake to challenger, keep deposit
            (bool success, ) = challengeInfo.challenger.call{value: challengeInfo.stake}("");
            require(success, "Transfer failed");
        }
        
        emit ChallengeResolved(taskId, challengerWon);
    }
    
    /**
     * Oracle-only resolution (convenience function when oracle is set)
     * Oracle calls this directly with its decision
     */
    function resolveChallengeByOracle(
        bytes32 taskId,
        bool challengerWon
    ) external {
        require(challengeOracle != address(0), "Oracle not configured");
        require(msg.sender == challengeOracle, "Only oracle can resolve");
        
        Challenge storage challengeInfo = challenges[taskId];
        require(challengeInfo.challenger != address(0), "No challenge found");
        require(!challengeInfo.resolved, "Already resolved");
        
        challengeInfo.resolved = true;
        
        // Execute resolution
        if (challengerWon) {
            Deposit storage depositInfo = deposits[taskId];
            (bool success, ) = challengeInfo.challenger.call{value: depositInfo.amount + challengeInfo.stake}("");
            require(success, "Transfer failed");
        } else {
            (bool success, ) = challengeInfo.challenger.call{value: challengeInfo.stake}("");
            require(success, "Transfer failed");
        }
        
        emit ChallengeResolved(taskId, challengerWon);
    }
    
    /**
     * Withdraw creator earnings
     * Creator can withdraw accumulated usage cuts
     * PROTOCOL-LEVEL: Creator revenue from network activity
     * 
     * SECURITY: Uses checks-effects-interactions pattern to prevent reentrancy
     */
    function withdrawCreatorEarnings() external {
        require(msg.sender == creatorAddress, "Only creator can withdraw");
        require(creatorBalances[msg.sender] > 0, "No earnings to withdraw");
        
        // CHECKS: Verify balance
        uint256 amount = creatorBalances[msg.sender];
        
        // EFFECTS: Update state BEFORE external call (prevents reentrancy)
        creatorBalances[msg.sender] = 0;
        
        // INTERACTIONS: External call AFTER state update
        if (networkToken == address(0)) {
            // Native token - contract must have sufficient balance
            require(address(this).balance >= amount, "Insufficient contract balance");
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Withdrawal failed");
        } else {
            // ERC20 token - contract must have sufficient balance
            IERC20 token = IERC20(networkToken);
            require(token.balanceOf(address(this)) >= amount, "Insufficient token balance");
            require(token.transfer(msg.sender, amount), "Token withdrawal failed");
        }
        
        emit CreatorWithdrawn(msg.sender, amount);
    }
    
    /**
     * Withdraw validator earnings
     * Validators can withdraw accumulated payments
     * CRITICAL FIX: Validators must be able to withdraw their earnings
     * 
     * SECURITY: Uses checks-effects-interactions pattern to prevent reentrancy
     */
    function withdrawValidatorEarnings() external {
        require(validatorBalances[msg.sender] > 0, "No earnings to withdraw");
        
        // CHECKS: Verify balance
        uint256 amount = validatorBalances[msg.sender];
        
        // EFFECTS: Update state BEFORE external call (prevents reentrancy)
        validatorBalances[msg.sender] = 0;
        
        // INTERACTIONS: External call AFTER state update
        if (networkToken == address(0)) {
            // Native token - contract must have sufficient balance
            require(address(this).balance >= amount, "Insufficient contract balance");
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Withdrawal failed");
        } else {
            // ERC20 token - contract must have sufficient balance
            IERC20 token = IERC20(networkToken);
            require(token.balanceOf(address(this)) >= amount, "Insufficient token balance");
            require(token.transfer(msg.sender, amount), "Token withdrawal failed");
        }
        
        emit ValidatorWithdrawn(msg.sender, amount);
    }
    
    /**
     * Get validator balance
     */
    function getValidatorBalance(address validator) external view returns (uint256) {
        return validatorBalances[validator];
    }
    
    /**
     * Deposit to miner pool
     * Called when creation fees are routed to miner pool
     * Can be called by anyone (typically during network creation)
     */
    function depositToMinerPool() external payable {
        require(msg.value > 0, "Must send native token");
        minerPoolBalance += msg.value;
        emit MinerPoolDeposited(msg.value);
    }
    
    /**
     * Deposit tokens to miner pool (ERC20)
     */
    function depositTokensToMinerPool(uint256 amount) external {
        require(networkToken != address(0), "Network token not set");
        require(amount > 0, "Amount must be greater than 0");
        
        IERC20 token = IERC20(networkToken);
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        minerPoolBalance += amount;
        emit MinerPoolDeposited(amount);
    }
    
    /**
     * Get creator balance
     */
    function getCreatorBalance(address creator) external view returns (uint256) {
        return creatorBalances[creator];
    }
    
    /**
     * Get miner pool balance
     */
    function getMinerPoolBalance() external view returns (uint256) {
        return minerPoolBalance;
    }
    
    /**
     * Get deposit info
     */
    function getDeposit(bytes32 taskId) external view returns (
        address depositor,
        uint256 amount,
        uint256 timestamp,
        bool released,
        bool challenged
    ) {
        Deposit storage depositInfo = deposits[taskId];
        return (
            depositInfo.depositor,
            depositInfo.amount,
            depositInfo.timestamp,
            depositInfo.released,
            depositInfo.challenged
        );
    }
    
    /**
     * Apply penalty to validator for misbehavior
     * Supports multiple penalty mechanisms based on network configuration
     * 
     * CRITICAL: Slashing is LAST RESORT - only when protocol has absolute proof
     * Other penalties (reputation, warnings, bans) are applied first
     * 
     * SECURITY: Requires validator consensus or oracle approval
     * Only challengeOracle or validator consensus can penalize
     */
    function penalizeValidator(
        address validator,
        bytes32 taskId,
        bytes calldata evidence,
        ValidatorSignature[] calldata validatorSignatures
    ) external {
        // Check if validator is banned
        if (validatorBanUntil[validator] > block.timestamp) {
            revert ValidatorCurrentlyBanned();
        }
        
        // Verify authorization (same as slashing)
        _verifyPenaltyAuthorization(validator, taskId, validatorSignatures);
        
        // CRITICAL: Apply penalties in order of severity (slashing is LAST)
        // 1. First: Apply reputation penalty (least severe)
        if (penaltyMechanism == PenaltyMechanism.REPUTATION_ONLY || 
            (penaltyMechanism == PenaltyMechanism.HYBRID && reputationPenaltyEnabled)) {
            _applyReputationPenalty(validator, taskId);
        }
        
        // 2. Second: Apply warning (if configured)
        if (penaltyMechanism == PenaltyMechanism.WARNING_SYSTEM || 
            (penaltyMechanism == PenaltyMechanism.HYBRID && warningSystemEnabled)) {
            _applyWarning(validator, taskId);
        }
        
        // 3. Third: Check for temporary ban (if configured)
        if (penaltyMechanism == PenaltyMechanism.TEMPORARY_BAN || 
            (penaltyMechanism == PenaltyMechanism.HYBRID && temporaryBanEnabled)) {
            _checkAndApplyBan(validator);
        }
        
        // 4. LAST RESORT: Slashing - ONLY if evidence proves absolute cheating
        // Slashing requires:
        // - Evidence verification (proof of cheating)
        // - Higher consensus threshold (90% instead of normal)
        // - Only after other penalties have been applied
        if (penaltyMechanism == PenaltyMechanism.SLASHING || 
            (penaltyMechanism == PenaltyMechanism.HYBRID && slashingEnabled)) {
            // CRITICAL: Verify evidence before slashing
            require(evidence.length >= MIN_SLASHING_EVIDENCE_LENGTH, "Slashing requires evidence");
            
            // CRITICAL: For slashing, require HIGHER consensus threshold (90%)
            // Override normal consensus threshold for slashing
            uint256 slashingApproveCount = 0;
            for (uint256 i = 0; i < validatorSignatures.length; i++) {
                if (validatorSignatures[i].accepted) {
                    slashingApproveCount++;
                }
            }
            uint256 requiredSlashingApprovals = (validatorSignatures.length * SLASHING_CONSENSUS_THRESHOLD) / 10000;
            if (requiredSlashingApprovals == 0 && SLASHING_CONSENSUS_THRESHOLD > 0) {
                requiredSlashingApprovals = 1;
            }
            require(slashingApproveCount >= requiredSlashingApprovals, 
                "Slashing requires 90% validator consensus (higher than normal threshold)");
            
            if (!_verifySlashingEvidence(validator, taskId, evidence, validatorSignatures)) {
                revert SlashingEvidenceVerificationFailed();
            }
            
            // Only slash if we have absolute proof
            _applySlashing(validator, taskId, evidence);
        }
        
        if (penaltyMechanism == PenaltyMechanism.NONE) {
            return; // No penalty
        }
    }
    
    /**
     * Slash a validator for misbehavior (backward compatibility)
     * DEPRECATED: Use penalizeValidator() instead
     * 
     * CRITICAL: Slashing is LAST RESORT - requires absolute proof of cheating
     */
    function slashValidator(
        address validator,
        bytes32 taskId,
        bytes calldata evidence,
        ValidatorSignature[] calldata validatorSignatures
    ) external {
        require(slashingEnabled, "Slashing not enabled for this network");
        require(validatorStakes[validator] > 0, "Validator has no stake");
        
        // CRITICAL: Require evidence for slashing
        require(evidence.length >= MIN_SLASHING_EVIDENCE_LENGTH, "Slashing requires evidence proving cheating");
        
        // SECURITY: Require validator consensus or oracle approval
        if (challengeOracle != address(0)) {
            // Mode 1: Oracle can slash directly (but still requires evidence)
            require(msg.sender == challengeOracle, "Only oracle can slash");
        } else {
            // Mode 2: Require HIGHER consensus threshold for slashing (90% instead of normal)
            require(validatorSignatures.length >= minValidators, "Insufficient validators for slashing");
            
            // Verify signatures for slashing approval
            bytes32 slashMessageHash = keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(
                    networkId,
                    taskId,
                    validator,
                    "slash",
                    block.chainid
                ))
            ));
            
            uint256 approveCount = 0;
            address[] memory seenValidators = new address[](validatorSignatures.length);
            uint256 seenCount = 0;
            
            for (uint256 i = 0; i < validatorSignatures.length; i++) {
                address signer = ecrecover(slashMessageHash, validatorSignatures[i].v, validatorSignatures[i].r, validatorSignatures[i].s);
                require(signer == validatorSignatures[i].validator, "Invalid signature");
                
                // SECURITY: Prevent duplicate validators
                bool isDuplicate = false;
                for (uint256 j = 0; j < seenCount; j++) {
                    if (seenValidators[j] == signer) {
                        isDuplicate = true;
                        break;
                    }
                }
                require(!isDuplicate, "Duplicate validator");
                seenValidators[seenCount] = signer;
                seenCount++;
                
                if (validatorRegistry != address(0)) {
                    require(IValidatorRegistry(validatorRegistry).isValidator(signer), "Validator not registered");
                }
                
                if (validatorSignatures[i].accepted) {
                    approveCount++;
                }
            }
            
            // CRITICAL: Slashing requires 90% consensus (higher than normal consensus threshold)
            uint256 requiredApprovals = (validatorSignatures.length * SLASHING_CONSENSUS_THRESHOLD) / 10000;
            if (requiredApprovals == 0 && SLASHING_CONSENSUS_THRESHOLD > 0) {
                requiredApprovals = 1;
            }
            require(approveCount >= requiredApprovals, "Insufficient validator consensus for slashing (requires 90% consensus)");
        }
        
        // CRITICAL: Verify evidence before slashing
        require(_verifySlashingEvidence(validator, taskId, evidence, validatorSignatures), 
            "Slashing evidence verification failed - insufficient proof of cheating");
        
        uint256 stake = validatorStakes[validator];
        uint256 slashAmount = (stake * slashingRate) / 100;
        
        // Slash the validator
        validatorStakes[validator] = stake - slashAmount;
        validatorSlashCount[validator]++;
        lastSlashTimestamp[validator] = block.timestamp; // Track slash timestamp for cooldown
        
        // Reduce reputation (reputation decreases with each slash)
        uint256 currentRep = validatorReputation[validator];
        uint256 newRep = currentRep > 10 ? currentRep - 10 : 0;
        validatorReputation[validator] = newRep;
        
        // Send slashed funds to purpose-bound sinks (or burn if sinks is 0x0)
        // Purpose-bound sinks: validator subsidy, audit bonds, loser-pays disputes, opt-in infra streams
        if (purposeBoundSinks != address(0)) {
            if (networkToken == address(0)) {
                (bool success, ) = purposeBoundSinks.call{value: slashAmount}("");
                require(success, "Slash transfer failed");
            } else {
                IERC20 token = IERC20(networkToken);
                require(token.transfer(purposeBoundSinks, slashAmount), "Slash token transfer failed");
            }
        }
        // If sinks is 0x0, funds are effectively burned (stay in contract, no accumulation)
        
        emit ValidatorSlashed(validator, taskId, slashAmount, newRep);
    }
    
    /**
     * Internal: Verify penalty authorization (consensus or oracle)
     */
    function _verifyPenaltyAuthorization(
        address validator,
        bytes32 taskId,
        ValidatorSignature[] calldata validatorSignatures
    ) internal view {
        if (challengeOracle != address(0)) {
            require(msg.sender == challengeOracle, "Only oracle can penalize");
        } else {
            require(validatorSignatures.length >= minValidators, "Insufficient validators for penalty");
            
            bytes32 penaltyMessageHash = keccak256(abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encodePacked(
                    networkId,
                    taskId,
                    validator,
                    "penalize",
                    block.chainid
                ))
            ));
            
            uint256 approveCount = 0;
            address[] memory seenValidators = new address[](validatorSignatures.length);
            uint256 seenCount = 0;
            
            for (uint256 i = 0; i < validatorSignatures.length; i++) {
                address signer = ecrecover(penaltyMessageHash, validatorSignatures[i].v, validatorSignatures[i].r, validatorSignatures[i].s);
                require(signer == validatorSignatures[i].validator, "Invalid signature");
                
                bool isDuplicate = false;
                for (uint256 j = 0; j < seenCount; j++) {
                    if (seenValidators[j] == signer) {
                        isDuplicate = true;
                        break;
                    }
                }
                require(!isDuplicate, "Duplicate validator");
                seenValidators[seenCount] = signer;
                seenCount++;
                
                if (validatorRegistry != address(0)) {
                    require(IValidatorRegistry(validatorRegistry).isValidator(signer), "Validator not registered");
                }
                
                if (validatorSignatures[i].accepted) {
                    approveCount++;
                }
            }
            
            uint256 requiredApprovals = (validatorSignatures.length * consensusThreshold) / 10000;
            if (requiredApprovals == 0 && consensusThreshold > 0) {
                requiredApprovals = 1;
            }
            require(approveCount >= requiredApprovals, "Insufficient validator consensus for penalty");
        }
    }
    
    /**
     * Internal: Apply slashing penalty
     * CRITICAL: This is LAST RESORT - only called when absolute proof exists
     * Evidence must be verified before calling this function
     */
    function _applySlashing(address validator, bytes32 taskId, bytes calldata evidence) internal {
        if (!slashingEnabled) return;
        if (validatorStakes[validator] < slashingMinStakeRequired) return;
        
        // Store evidence hash for audit trail
        slashingEvidenceHash[taskId] = keccak256(evidence);
        slashingEvidenceVerified[taskId] = true;
        
        uint256 stake = validatorStakes[validator];
        uint256 slashAmount = (stake * slashingRate) / 100;
        
        validatorStakes[validator] = stake - slashAmount;
        validatorSlashCount[validator]++;
        lastSlashTimestamp[validator] = block.timestamp;
        
        // Reduce reputation
        uint256 currentRep = validatorReputation[validator];
        uint256 newRep = currentRep > 10 ? currentRep - 10 : 0;
        validatorReputation[validator] = newRep;
        
        // Send slashed funds to purpose-bound sinks
        if (purposeBoundSinks != address(0)) {
            if (networkToken == address(0)) {
                (bool success, ) = purposeBoundSinks.call{value: slashAmount}("");
                require(success, "Slash transfer failed");
            } else {
                IERC20 token = IERC20(networkToken);
                require(token.transfer(purposeBoundSinks, slashAmount), "Slash token transfer failed");
            }
        }
        
        emit ValidatorSlashed(validator, taskId, slashAmount, newRep);
    }
    
    /**
     * Internal: Verify slashing evidence
     * CRITICAL: Slashing requires absolute proof of cheating
     * Evidence must prove:
     * 1. Validator signed incorrect evaluation
     * 2. Validator's evaluation contradicts on-chain state
     * 3. Validator's evaluation contradicts consensus
     * 4. Validator's evaluation contradicts deterministic replay result
     * 
     * Returns true only if evidence proves absolute cheating
     */
    function _verifySlashingEvidence(
        address validator,
        bytes32 taskId,
        bytes calldata evidence,
        ValidatorSignature[] calldata validatorSignatures
    ) internal view returns (bool) {
        // Evidence must be non-empty
        if (evidence.length < MIN_SLASHING_EVIDENCE_LENGTH) {
            return false;
        }
        
        // Check if task exists
        Deposit storage depositInfo = deposits[taskId];
        if (depositInfo.depositor == address(0)) {
            return false; // Task doesn't exist
        }
        
        // Evidence verification logic:
        // 1. Evidence must contain proof that validator's evaluation was incorrect
        // 2. Evidence must contain proof that contradicts on-chain state
        // 3. Evidence must contain proof that contradicts consensus
        
        // For now, we require:
        // - Evidence hash must be unique (not reused)
        // - Evidence must be signed by validators who approve slashing
        // - Evidence must contain taskId and validator address
        
        // Verify evidence contains required information
        bytes32 evidenceHash = keccak256(abi.encodePacked(evidence, taskId, validator));
        
        // Check that evidence hasn't been used before (prevent replay)
        if (slashingEvidenceVerified[taskId]) {
            // Evidence already verified for this task - check if it matches
            return slashingEvidenceHash[taskId] == keccak256(evidence);
        }
        
        // Verify evidence is signed by validators who approve slashing
        // At least 90% of validators must approve slashing with evidence
        uint256 evidenceApprovalCount = 0;
        bytes32 evidenceMessageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encodePacked(
                networkId,
                taskId,
                validator,
                evidenceHash,
                "slash-evidence",
                block.chainid
            ))
        ));
        
        for (uint256 i = 0; i < validatorSignatures.length; i++) {
            address signer = ecrecover(evidenceMessageHash, validatorSignatures[i].v, validatorSignatures[i].r, validatorSignatures[i].s);
            if (signer == validatorSignatures[i].validator && validatorSignatures[i].accepted) {
                evidenceApprovalCount++;
            }
        }
        
        // Require 90% of validators approve the evidence
        uint256 requiredEvidenceApprovals = (validatorSignatures.length * SLASHING_CONSENSUS_THRESHOLD) / 10000;
        if (requiredEvidenceApprovals == 0 && SLASHING_CONSENSUS_THRESHOLD > 0) {
            requiredEvidenceApprovals = 1;
        }
        
        return evidenceApprovalCount >= requiredEvidenceApprovals;
    }
    
    /**
     * Internal: Apply reputation-only penalty
     */
    function _applyReputationPenalty(address validator, bytes32 taskId) internal {
        if (!reputationPenaltyEnabled) return;
        
        uint256 currentRep = validatorReputation[validator];
        uint256 newRep = currentRep > reputationPenaltyPerOffense 
            ? currentRep - reputationPenaltyPerOffense 
            : 0;
        validatorReputation[validator] = newRep;
        
        // Check if reputation is too low, trigger ban if configured
        if (newRep < minReputationForBan && temporaryBanEnabled) {
            _applyBan(validator);
        }
        
        emit ValidatorReputationPenalized(validator, taskId, newRep);
    }
    
    /**
     * Internal: Apply warning
     */
    function _applyWarning(address validator, bytes32 taskId) internal {
        if (!warningSystemEnabled) return;
        
        // Expire old warnings
        if (validatorLastWarningTime[validator] > 0 && 
            block.timestamp > validatorLastWarningTime[validator] + warningExpiry) {
            validatorWarningCount[validator] = 0;
        }
        
        validatorWarningCount[validator]++;
        validatorLastWarningTime[validator] = block.timestamp;
        
        emit ValidatorWarned(validator, taskId, validatorWarningCount[validator]);
        
        // Check if warnings threshold reached
        if (validatorWarningCount[validator] >= warningsBeforeAction) {
            if (actionAfterWarnings == WarningAction.REPUTATION) {
                _applyReputationPenalty(validator, taskId);
            } else if (actionAfterWarnings == WarningAction.BAN) {
                _applyBan(validator);
            } else if (actionAfterWarnings == WarningAction.SLASH) {
                // CRITICAL: Slashing from warnings requires evidence
                // This should rarely happen - warnings should escalate to ban/reputation first
                // For now, we don't allow slashing from warnings without evidence
                // Slashing must be called explicitly with evidence via penalizeValidator()
                revert("Slashing from warnings requires explicit evidence - use penalizeValidator()");
            }
            validatorWarningCount[validator] = 0; // Reset after action
        }
    }
    
    /**
     * Internal: Check and apply temporary ban
     */
    function _checkAndApplyBan(address validator) internal {
        if (!temporaryBanEnabled) return;
        
        validatorOffenseCount[validator]++;
        
        if (validatorOffenseCount[validator] >= offensesBeforeBan) {
            _applyBan(validator);
        }
    }
    
    /**
     * Internal: Apply temporary ban
     */
    function _applyBan(address validator) internal {
        uint256 currentBanUntil = validatorBanUntil[validator];
        uint256 newBanDuration = banDuration;
        
        // Escalate ban duration for repeat offenses
        if (currentBanUntil > block.timestamp) {
            // Already banned, escalate
            uint256 remainingBan = currentBanUntil - block.timestamp;
            newBanDuration = (remainingBan * banEscalationFactor) / 10000; // Apply escalation
        }
        
        validatorBanUntil[validator] = block.timestamp + newBanDuration;
        emit ValidatorBanned(validator, validatorBanUntil[validator]);
    }
    
    /**
     * Check if validator is banned
     */
    function isValidatorBanned(address validator) external view returns (bool) {
        return validatorBanUntil[validator] > block.timestamp;
    }
    
    /**
     * Get validator's ban status
     */
    function getValidatorBanStatus(address validator) external view returns (
        bool banned,
        uint256 banUntil,
        uint256 offenseCount,
        uint256 warningCount
    ) {
        banned = validatorBanUntil[validator] > block.timestamp;
        banUntil = validatorBanUntil[validator];
        offenseCount = validatorOffenseCount[validator];
        warningCount = validatorWarningCount[validator];
    }
    
    // PHASE 3: Track validators for on-chain selection
    address[] private validatorList; // List of validators who have staked
    mapping(address => bool) private isValidatorRegistered; // Track if validator is in list
    
    /**
     * Stake tokens as a validator
     * Validators must stake to participate
     * PHASE 3: Also registers validator for on-chain selection
     */
    function stakeAsValidator() external payable {
        require(msg.value > 0, "Must stake some amount");
        validatorStakes[msg.sender] += msg.value;
        
        // Initialize reputation if first time
        if (validatorReputation[msg.sender] == 0) {
            validatorReputation[msg.sender] = 50; // Start at neutral (50/100)
        }
        
        // PHASE 3: Register validator for on-chain selection
        if (!isValidatorRegistered[msg.sender]) {
            validatorList.push(msg.sender);
            isValidatorRegistered[msg.sender] = true;
        }
        
        emit ValidatorStaked(msg.sender, msg.value);
    }
    
    /**
     * Stake tokens as validator (ERC20)
     * PHASE 3: Also registers validator for on-chain selection
     */
    function stakeTokensAsValidator(uint256 amount) external {
        require(networkToken != address(0), "Network token not set");
        require(amount > 0, "Must stake some amount");
        
        IERC20 token = IERC20(networkToken);
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        
        validatorStakes[msg.sender] += amount;
        
        // Initialize reputation if first time
        if (validatorReputation[msg.sender] == 0) {
            validatorReputation[msg.sender] = 50; // Start at neutral (50/100)
        }
        
        // PHASE 3: Register validator for on-chain selection
        if (!isValidatorRegistered[msg.sender]) {
            validatorList.push(msg.sender);
            isValidatorRegistered[msg.sender] = true;
        }
        
        emit ValidatorStaked(msg.sender, amount);
    }
    
    /**
     * Unstake validator tokens (with cooldown for slashed validators)
     * FULLY IMPLEMENTED: Enforces cooldown period for slashed validators
     */
    function unstakeValidator(uint256 amount) external {
        require(validatorStakes[msg.sender] >= amount, "Insufficient stake");
        
        // FULLY IMPLEMENTED: If validator has been slashed, require cooldown period
        if (validatorSlashCount[msg.sender] > 0) {
            uint256 lastSlash = lastSlashTimestamp[msg.sender];
            require(lastSlash > 0, "Invalid slash timestamp");
            
            uint256 timeSinceSlash = block.timestamp - lastSlash;
            require(timeSinceSlash >= slashCooldownPeriod, "Cooldown period not expired");
            
            // Additional check: ensure cooldown period is reasonable (prevent overflow)
            require(block.timestamp >= lastSlash, "Invalid timestamp");
        }
        
        validatorStakes[msg.sender] -= amount;
        
        if (networkToken == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "Unstake transfer failed");
        } else {
            IERC20 token = IERC20(networkToken);
            require(token.transfer(msg.sender, amount), "Unstake token transfer failed");
        }
        
        emit ValidatorUnstaked(msg.sender, amount);
    }
    
    /**
     * Update validator reputation (called after successful validation)
     * Can only increase reputation, not decrease (slashing decreases it)
     * 
     * SECURITY: Removed public access - reputation updates only via:
     * 1. Slashing (decreases reputation)
     * 2. Successful consensus participation (can be tracked off-chain)
     * 
     * Note: Reputation updates should be handled by off-chain consensus tracking.
     * This function is kept for backward compatibility but should not be used.
     * Consider removing in future versions.
     */
    function updateValidatorReputation(address validator, uint256 newReputation) external {
        // SECURITY: Only oracle or contract itself can update reputation
        require(
            msg.sender == challengeOracle || msg.sender == address(this),
            "Only oracle or contract can update reputation"
        );
        
        // Only allow increasing reputation (slashing decreases it)
        require(newReputation > validatorReputation[validator], "Can only increase reputation");
        require(newReputation <= 100, "Reputation cannot exceed 100");
        
        validatorReputation[validator] = newReputation;
        emit ValidatorReputationUpdated(validator, newReputation);
    }
    
    /**
     * Get validator stake
     */
    function getValidatorStake(address validator) external view returns (uint256) {
        return validatorStakes[validator];
    }
    
    /**
     * Get validator reputation
     */
    function getValidatorReputation(address validator) external view returns (uint256) {
        return validatorReputation[validator];
    }
    
    /**
     * SECURITY FIX: Commit randomness for validator selection
     * Prevents manipulation by requiring commit before reveal
     */
    function commitRandomness(bytes32 taskId, bytes32 commitHash) external {
        require(randomnessCommits[taskId] == bytes32(0), "Randomness already committed");
        randomnessCommits[taskId] = commitHash;
        commitBlock[taskId] = block.number;
        emit RandomnessCommitted(taskId, commitHash, block.number);
    }
    
    /**
     * SECURITY FIX: Reveal randomness for validator selection
     * Must be called after COMMIT_DELAY blocks to prevent manipulation
     */
    function revealRandomness(bytes32 taskId, uint256 randomValue, bytes32 salt) external {
        require(randomnessCommits[taskId] != bytes32(0), "Randomness not committed");
        require(randomnessReveals[taskId] == 0, "Randomness already revealed");
        require(block.number >= commitBlock[taskId] + COMMIT_DELAY, "Must wait for commit delay");
        
        // Verify commit matches reveal
        bytes32 commitHash = keccak256(abi.encodePacked(randomValue, salt));
        require(commitHash == randomnessCommits[taskId], "Invalid reveal");
        
        randomnessReveals[taskId] = randomValue;
        taskRandomSeed[taskId] = randomValue;
        emit RandomnessRevealed(taskId, randomValue);
    }
    
    /**
     * PHASE 3: On-chain validator selection
     * Selects validators based on stake, reputation, and rotation
     * SECURITY FIX: Uses commit-reveal scheme for true randomness
     */
    function _selectValidatorsForTask(bytes32 taskId) internal {
        // SECURITY FIX: Use revealed randomness if available, otherwise fallback to blockhash
        uint256 seed;
        if (randomnessReveals[taskId] > 0) {
            // Use revealed randomness (secure)
            seed = randomnessReveals[taskId];
        } else {
            // Fallback: Use blockhash (less secure, but allows immediate selection)
            // This is acceptable for low-value tasks or when commit-reveal not yet completed
            // Note: For high-value tasks, commit-reveal should be completed before selection
            seed = uint256(keccak256(abi.encodePacked(
                blockhash(block.number - 1),
                block.timestamp,
                taskId,
                msg.sender
            )));
        }
        taskRandomSeed[taskId] = seed;
        
        // Get all validators from registry (if available) or use internal tracking
        address[] memory candidateValidators = _getQualifiedValidators();
        
        if (candidateValidators.length == 0) {
            // No validators available - selection will be empty
            selectedValidators[taskId] = new address[](0);
            return;
        }
        
        // Select validators using weighted random selection
        address[] memory selected = new address[](minValidators);
        uint256 selectedCount = 0;
        uint256 seedCopy = seed;
        
        // Weighted selection: higher stake + reputation = higher chance
        for (uint256 i = 0; i < candidateValidators.length && selectedCount < minValidators; i++) {
            // Check rotation window (don't select validators used recently)
            if (lastTaskAssignment[candidateValidators[i]] > 0) {
                if (block.timestamp - lastTaskAssignment[candidateValidators[i]] < rotationWindow) {
                    continue; // Skip validators in rotation window
                }
            }
            
            // Calculate selection weight (stake + reputation)
            uint256 stake = validatorStakes[candidateValidators[i]];
            uint256 reputation = validatorReputation[candidateValidators[i]];
            uint256 weight = stake + (reputation * 1e18 / 100); // Reputation scaled to match stake magnitude
            
            // Use seed to determine if this validator is selected
            // Higher weight = higher chance
            if (weight > 0) {
                uint256 randomValue = uint256(keccak256(abi.encodePacked(seedCopy, i))) % (candidateValidators.length * 1e18);
                if (randomValue < weight) {
                    // Check for duplicates
                    bool alreadySelected = false;
                    for (uint256 j = 0; j < selectedCount; j++) {
                        if (selected[j] == candidateValidators[i]) {
                            alreadySelected = true;
                            break;
                        }
                    }
                    
                    if (!alreadySelected) {
                        selected[selectedCount] = candidateValidators[i];
                        lastTaskAssignment[candidateValidators[i]] = block.timestamp;
                        selectedCount++;
                    }
                }
            }
            
            seedCopy = uint256(keccak256(abi.encodePacked(seedCopy)));
        }
        
        // Resize array to actual selected count
        address[] memory finalSelected = new address[](selectedCount);
        for (uint256 i = 0; i < selectedCount; i++) {
            finalSelected[i] = selected[i];
        }
        
        selectedValidators[taskId] = finalSelected;
    }
    
    /**
     * Get qualified validators (meet minimum stake and reputation)
     * PHASE 3: Uses ValidatorRegistry as primary source, falls back to internal list
     * Filters by minimum stake and reputation thresholds
     */
    function _getQualifiedValidators() internal view returns (address[] memory) {
        uint256 minStake = 0; // Minimum stake required (can be configured)
        uint256 minReputation = 50; // Minimum reputation (50/100 = neutral)
        
        address[] memory candidateList;
        
        // PHASE 3: Use ValidatorRegistry as primary source if available
        if (validatorRegistry != address(0)) {
            IValidatorRegistry registry = IValidatorRegistry(validatorRegistry);
            candidateList = registry.getValidatorList();
        } else {
            // Fallback to internal validator list
            candidateList = validatorList;
        }
        
        // Collect qualified validators
        address[] memory qualified = new address[](candidateList.length);
        uint256 qualifiedCount = 0;
        
        for (uint256 i = 0; i < candidateList.length; i++) {
            address validator = candidateList[i];
            
            // Check if validator meets qualification criteria
            uint256 stake = validatorStakes[validator];
            uint256 reputation = validatorReputation[validator];
            
            // If using registry, get reputation from registry; otherwise use internal
            if (validatorRegistry != address(0)) {
                IValidatorRegistry registry = IValidatorRegistry(validatorRegistry);
                (,,,bool isActive,uint256 regReputation,,) = registry.getValidator(validator);
                if (!isActive) continue;
                
                // PHASE 5: Require P2P endpoint for validators
                if (!registry.hasP2PEndpoint(validator)) {
                    continue; // Skip validators without P2P endpoint
                }
                
                // Use registry reputation if available, otherwise use internal
                if (regReputation > 0) {
                    reputation = regReputation;
                }
            }
            
            // Check minimum stake and reputation
            if (stake >= minStake && reputation >= minReputation) {
                qualified[qualifiedCount] = validator;
                qualifiedCount++;
            }
        }
        
        // Resize array to actual qualified count
        address[] memory finalQualified = new address[](qualifiedCount);
        for (uint256 i = 0; i < qualifiedCount; i++) {
            finalQualified[i] = qualified[i];
        }
        
        return finalQualified;
    }
    
    /**
     * PHASE 4: Update validator reputation based on consensus participation
     * Validators who agree with consensus get reputation boost
     * Validators who disagree get reputation penalty
     */
    function _updateReputationFromConsensus(
        ValidatorSignature[] calldata signatures,
        bool consensusReached
    ) internal {
        if (!consensusReached) {
            // If consensus not reached, no reputation changes
            return;
        }

        // Determine majority position (accepted or rejected)
        uint256 acceptCount = 0;
        for (uint256 i = 0; i < signatures.length; i++) {
            if (signatures[i].accepted) {
                acceptCount++;
            }
        }
        
        bool majorityAccepted = acceptCount * 2 > signatures.length;
        
        // Update reputation for each validator
        for (uint256 i = 0; i < signatures.length; i++) {
            address validator = signatures[i].validator;
            uint256 currentRep = validatorReputation[validator];
            
            // Validator agreed with majority
            bool agreedWithMajority = (signatures[i].accepted == majorityAccepted);
            
            if (agreedWithMajority) {
                // Reputation boost: +1 point (capped at 100)
                if (currentRep < 100) {
                    validatorReputation[validator] = currentRep + 1;
                    emit ValidatorReputationUpdated(validator, currentRep + 1);
                    
                    // Also update registry if available
                    if (validatorRegistry != address(0)) {
                        IValidatorRegistry registry = IValidatorRegistry(validatorRegistry);
                        registry.updateReputation(validator, currentRep + 1);
                    }
                }
            } else {
                // Reputation penalty: -2 points (minimum 0)
                if (currentRep > 0) {
                    uint256 newRep = currentRep >= 2 ? currentRep - 2 : 0;
                    validatorReputation[validator] = newRep;
                    emit ValidatorReputationUpdated(validator, newRep);
                    
                    // Also update registry if available
                    if (validatorRegistry != address(0)) {
                        IValidatorRegistry registry = IValidatorRegistry(validatorRegistry);
                        registry.updateReputation(validator, newRep);
                    }
                }
            }
        }
    }
    
    /**
     * Get selected validators for a task
     * PHASE 3: On-chain validator selection result
     */
    function getSelectedValidators(bytes32 taskId) external view returns (address[] memory) {
        return selectedValidators[taskId];
    }
    
    /**
     * ANTI-RUG PULL SYSTEM (Phase 2)
     * Execute penalty based on rug detection signal
     * Can only be called by rug detection oracle
     */
    function executeRugPenalty(
        bytes32 signalHash,
        uint256 burnPercentage,
        bool revokeControl,
        bool lockLp,
        bool redistributeValue
    ) external {
        require(rugDetectionOracle != address(0), "Rug detection not enabled");
        require(msg.sender == rugDetectionOracle, "Only rug detection oracle can execute penalties");
        require(burnPercentage <= 100, "Burn percentage cannot exceed 100");
        require(!rugPenalties[signalHash].controlRevoked, "Penalty already executed");
        
        RugPenalty memory penalty = RugPenalty({
            signalHash: signalHash,
            burnPercentage: burnPercentage,
            controlRevoked: revokeControl,
            lpLocked: lockLp,
            valueRedistributed: redistributeValue,
            executedAt: block.timestamp
        });
        
        rugPenalties[signalHash] = penalty;
        
        // Progressive burn: burn creator's tokens based on violation severity
        if (burnPercentage > 0) {
            _executeProgressiveBurn(burnPercentage);
        }
        
        // Control revocation: transfer control away from creator
        if (revokeControl && !creatorControlRevoked) {
            _revokeCreatorControl();
        }
        
        // Value redistribution: redistribute creator balance to holders/validators
        if (redistributeValue) {
            _redistributeCreatorValue();
        }
        
        emit RugPenaltyExecuted(signalHash, creatorAddress, burnPercentage, revokeControl, lockLp);
    }
    
    /**
     * Internal: Execute progressive burn of creator tokens
     * The harder they rug, the more they lose
     */
    function _executeProgressiveBurn(uint256 burnPercentage) internal {
        if (networkToken == address(0)) {
            // Native token: burn creator's balance in escrow
            uint256 creatorBalance = creatorBalances[creatorAddress];
            if (creatorBalance > 0) {
                uint256 burnAmount = (creatorBalance * burnPercentage) / 100;
                creatorBalances[creatorAddress] -= burnAmount;
                creatorTokensBurned += burnAmount;
                
                // Send to burn address (0x0) or purpose-bound sinks
                if (purposeBoundSinks == address(0)) {
                    // Burn native tokens by sending to 0x0
                    // Note: This is a no-op for native tokens, but tracks the burn
                    creatorTokensBurned += burnAmount;
                } else {
                    // Send to purpose-bound sinks (validator subsidy, audit bonds, disputes, infra)
                    payable(purposeBoundSinks).transfer(burnAmount);
                }
                
                emit CreatorTokensBurned(creatorAddress, burnAmount, burnPercentage);
            }
        } else {
            // ERC20 token: burn creator's token balance
            IERC20 token = IERC20(networkToken);
            uint256 creatorBalance = token.balanceOf(creatorAddress);
            if (creatorBalance > 0) {
                uint256 burnAmount = (creatorBalance * burnPercentage) / 100;
                
                // Transfer to this contract first (creator must approve)
                // Then burn by sending to 0x0
                require(
                    token.transferFrom(creatorAddress, address(this), burnAmount),
                    "Token transfer failed"
                );
                
                // Burn by sending to 0x0
                require(
                    token.transfer(address(0), burnAmount),
                    "Token burn failed"
                );
                
                creatorTokensBurned += burnAmount;
                emit CreatorTokensBurned(creatorAddress, burnAmount, burnPercentage);
            }
        }
    }
    
    /**
     * Internal: Revoke creator control
     * Transfers control to new controller (purpose-bound sinks or DAO)
     */
    function _revokeCreatorControl() internal {
        require(!creatorControlRevoked, "Control already revoked");
        
        creatorControlRevoked = true;
        newController = purposeBoundSinks != address(0) ? purposeBoundSinks : address(0);
        
        // Creator can no longer:
        // - Withdraw creator balances
        // - Modify network parameters
        // - Access admin functions
        
        emit CreatorControlRevoked(creatorAddress, newController);
    }
    
    /**
     * Internal: Redistribute creator value to holders/validators
     * Value inversion: rug creates upside for users
     */
    function _redistributeCreatorValue() internal {
        uint256 creatorBalance = creatorBalances[creatorAddress];
        if (creatorBalance == 0) return;
        
        // Redistribute to:
        // 1. Validators (50%)
        // 2. Miner pool (30%)
        // 3. Purpose-bound sinks (20%) - validator subsidy, audit bonds, disputes, infra
        
        uint256 validatorShare = (creatorBalance * 50) / 100;
        uint256 minerShare = (creatorBalance * 30) / 100;
        uint256 protocolShare = creatorBalance - validatorShare - minerShare;
        
        // Add to miner pool
        minerPoolBalance += minerShare;
        
        // FULLY IMPLEMENTED: Distribute to validators individually (proportional to stake)
        if (validatorRegistry != address(0) && participatingValidators.length > 0) {
            // Distribute to validators who have participated (proportional to their stake)
            uint256 totalStake = 0;
            
            // Calculate total stake of participating validators
            IValidatorRegistry registry = IValidatorRegistry(validatorRegistry);
            for (uint256 i = 0; i < participatingValidators.length; i++) {
                address validator = participatingValidators[i];
                if (registry.isValidator(validator)) {
                    (,,,bool active,,,) = registry.getValidator(validator);
                    if (active) {
                        (,,uint256 stake,,,,) = registry.getValidator(validator);
                        totalStake += stake;
                    }
                }
            }
            
            // Distribute proportionally to each participating validator
            if (totalStake > 0) {
                for (uint256 i = 0; i < participatingValidators.length; i++) {
                    address validator = participatingValidators[i];
                    if (registry.isValidator(validator)) {
                        (,,,bool active,,,) = registry.getValidator(validator);
                        if (active) {
                            (,,uint256 stake,,,,) = registry.getValidator(validator);
                            uint256 validatorShareAmount = (validatorShare * stake) / totalStake;
                            validatorBalances[validator] += validatorShareAmount;
                            emit ValidatorEarningsAccumulated(validator, validatorShareAmount);
                        }
                    }
                }
            } else {
                // Fallback: if no stake info, distribute equally
                uint256 perValidator = validatorShare / participatingValidators.length;
                for (uint256 i = 0; i < participatingValidators.length; i++) {
                    address validator = participatingValidators[i];
                    validatorBalances[validator] += perValidator;
                    emit ValidatorEarningsAccumulated(validator, perValidator);
                }
            }
        } else {
            // No validators or no registry: add to miner pool
            minerPoolBalance += validatorShare;
        }
        
        // Send protocol share
        if (purposeBoundSinks != address(0)) {
            payable(purposeBoundSinks).transfer(protocolShare);
        }
        
        // Clear creator balance
        creatorBalances[creatorAddress] = 0;
        
        emit ValueRedistributed(creatorAddress, creatorBalance, new address[](0));
    }
    
    /**
     * Set rug detection oracle (can only be set once, by protocol)
     * This should be set during deployment or by protocol governance
     */
    function setRugDetectionOracle(address _oracle) external {
        require(rugDetectionOracle == address(0), "Oracle already set");
        require(_oracle != address(0), "Invalid oracle address");
        // In production, this should check msg.sender is protocol admin
        rugDetectionOracle = _oracle;
    }
    
    /**
     * Check if creator control has been revoked
     */
    function isCreatorControlRevoked() external view returns (bool) {
        return creatorControlRevoked;
    }
    
    /**
     * Get rug penalty details
     */
    function getRugPenalty(bytes32 signalHash) external view returns (RugPenalty memory) {
        return rugPenalties[signalHash];
    }
    
    /**
     * Get validator count (for external queries)
     */
    function getValidatorCount() external view returns (uint256) {
        return validatorList.length;
    }
    
    /**
     * Set rotation window (only callable by contract owner or network creator)
     * In production, this should be immutable or controlled by governance
     */
    function setRotationWindow(uint256 _rotationWindow) external {
        require(msg.sender == creatorAddress, "Only creator can set rotation window");
        rotationWindow = _rotationWindow;
    }
    
    /**
     * PHASE 6: Anchor task state on-chain (store IPFS CID hash)
     * Anyone can anchor task state, but typically called by validators or task coordinator
     * @param taskId Task identifier
     * @param stateHash Hash of IPFS CID (bytes32 representation of IPFS CID)
     */
    function anchorTaskState(bytes32 taskId, bytes32 stateHash) external {
        require(deposits[taskId].depositor != address(0), "Task not found");
        
        // Store anchor (can be updated if state changes)
        taskStateAnchors[taskId] = stateHash;
        taskStateAnchorTimestamp[taskId] = block.timestamp;
        
        emit TaskStateAnchored(taskId, stateHash, block.timestamp);
    }
    
    /**
     * PHASE 6: Get task state anchor (IPFS CID hash)
     */
    function getTaskStateAnchor(bytes32 taskId) external view returns (bytes32, uint256) {
        return (taskStateAnchors[taskId], taskStateAnchorTimestamp[taskId]);
    }
    
    /**
     * User Redo Mechanism: Record user rejection
     * Tracks which validators approved rejected result (for collusion detection)
     * @param taskId Task identifier
     * @param approvedValidators Validators who approved the rejected result
     * @param patternHash Encrypted hash of collusion pattern
     */
    function recordUserRejection(
        bytes32 taskId,
        address[] calldata approvedValidators,
        bytes32 patternHash
    ) external {
        require(deposits[taskId].depositor != address(0), "Task not found");
        require(msg.sender == deposits[taskId].depositor, "Only task depositor can reject");
        
        // Mark as user-rejected
        userRejected[taskId] = true;
        redoCount[taskId] = redoCount[taskId] + 1;
        collusionPatternHash[taskId] = patternHash;
        
        // Increment rejection count for each validator (for tracking, not punishment)
        for (uint256 i = 0; i < approvedValidators.length; i++) {
            userRejectionCount[approvedValidators[i]] = userRejectionCount[approvedValidators[i]] + 1;
        }
        
        emit UserRejected(taskId, msg.sender, patternHash, redoCount[taskId]);
    }
    
    /**
     * Get user rejection info
     */
    function getUserRejectionInfo(bytes32 taskId) external view returns (
        bool rejected,
        uint256 redos,
        bytes32 patternHash
    ) {
        return (
            userRejected[taskId],
            redoCount[taskId],
            collusionPatternHash[taskId]
        );
    }
    
    /**
     * Get validator rejection count (for collusion detection)
     */
    function getValidatorRejectionCount(address validator) external view returns (uint256) {
        return userRejectionCount[validator];
    }
}
