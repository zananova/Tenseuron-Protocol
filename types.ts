/**
 * Tenseuron Protocol - Core Types
 * 
 * Fully decentralized, chain-agnostic AI network protocol
 * No admin keys, no single points of failure, fully forkable
 */

export type SupportedChain =
  | 'ethereum'
  | 'polygon'
  | 'bsc'
  | 'arbitrum'
  | 'base'
  | 'avalanche'
  | 'optimism'
  | 'solana'
  | 'tron';

export type SettlementMode = 'escrow' | 'receipt';

export type TokenDesign = 'burn-on-use' | 'earn-only' | 'decay' | 'stake-required';

export type ScoringType = 'wasm' | 'js';

/**
 * AI Module - Protocol-level capability definition
 * Defines WHAT is being solved, not HOW (models solve HOW)
 */
export interface AIModule {
  id: string;
  moduleId: string; // Unique identifier (e.g., "text-to-code", "image-classification")
  name: string;
  description: string;
  category: string;

  // Module Definition
  taskInputSchema: object; // JSON schema for task input
  taskOutputSchema: object; // JSON schema for task output
  taskTimeout: number; // Default timeout in seconds

  // Scoring Rules
  scoringType: ScoringType | 'statistical' | 'deterministic';
  scoringRules: object; // Rules for scoring outputs
  scoringModuleHash?: string; // Hash of scoring module (if applicable)
  scoringModuleUrl?: string; // URL/IPFS CID of scoring module (if applicable)

  // Validation Criteria
  validationCriteria: object; // Criteria for validator evaluation
  evaluationMode: 'deterministic' | 'statistical' | 'human-in-the-loop';

  // Module Capabilities
  capabilities: string[]; // Array of capabilities (e.g., ["text-to-code", "code-audit"])

  // Module Configuration
  isProtocolDefined: boolean; // Protocol-defined vs user-created
  isActive: boolean;
  version: string;

  // Usage Tracking
  networksUsing: number;
  totalTasks: bigint | string;

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  createdBy?: string; // Creator address (null for protocol-defined)
}

/**
 * Network Graduation Levels
 * Networks progress through levels based on real usage metrics
 * No price, no market cap, no hype - only measurable performance
 */
export type GraduationLevel = 'sandbox' | 'active' | 'trusted' | 'open_economic';

export interface GraduationStatus {
  level: GraduationLevel;
  achievedAt?: string; // ISO timestamp when level was achieved
  conditions: {
    validatorCount: number;
    minerCount: number;
    completedTasks: number;
    validatorAgreementRate: number;
    unresolvedDisputes: number;
  };
}

/**
 * Network Manifest - Core protocol document
 * Stored on IPFS, mirrored on Git
 */
export interface NetworkManifest {
  // Identity
  networkId: string;        // Deterministic hash(name + creator + timestamp)
  name: string;
  description: string;
  category: string;
  version: string;          // Protocol version (e.g., "1.0.0")

  // AI Module (Module Layer)
  moduleId?: string;        // Reference to AIModule (e.g., "text-to-code")
  module?: AIModule;       // Full module definition (optional, can be loaded separately)

  // Creator
  creatorAddress: string;        // Creator address
  creatorSignature: string;
  createdAt: string;        // ISO timestamp

  // Inter-Network Call (INC) Support
  inc?: {
    supported: boolean;     // Whether network accepts INC calls
    capabilities: string[];  // What this network can do (e.g., ["image_generation", "text_processing"])
    pricing: {
      model: 'per_task' | 'per_token' | 'fixed';
      basePrice: string;     // Base price in wei or smallest unit
      currency: 'native' | 'network_token';
    };
    requirements: {
      minBudget: string;     // Minimum budget required for INC calls
      maxDepth: number;      // Maximum call depth allowed
      allowedNetworks?: string[];  // Empty = all networks allowed
    };
  };

  // Evaluation Layer
  taskFormat: {
    inputSchema: object;     // JSON schema for task input
    outputSchema: object;    // JSON schema for task output
    timeout: number;         // Timeout in seconds
  };

  scoringLogic: {
    type: ScoringType;       // 'wasm' for production, 'js' for dev
    hash: string;            // Content hash of scoring module
    url: string;             // IPFS CID or URL to scoring module
  };

  // Evaluation Mode (Hybrid Approach)
  evaluationMode?: 'deterministic' | 'statistical' | 'human-in-the-loop';

  // Deterministic Replay Requirements
  deterministicReplay?: {
    required: boolean;       // Whether replay is required
    seedRequired: boolean;   // Whether fixed seed is required
    intermediateHashing: boolean; // Whether intermediate steps must be hashed
    executionEnvRequired: boolean; // Whether execution environment hash is required
  };

  // Statistical Evaluation Config
  statisticalEvaluation?: {
    multipleOutputs: boolean;  // Whether miners produce multiple outputs
    minOutputs: number;        // Minimum outputs required
    weightedScoring: boolean;  // Whether to use reputation-weighted scoring
    agreementThreshold: number; // Minimum agreement score (0-1)

    // NEW: Distribution-based evaluation (Monte Carlo approach)
    distributionBased?: boolean;              // Enable Monte Carlo distribution analysis
    embeddingModel?: string;                 // Which embedding model to use (optional, for backward compat)
    embeddingDimension?: number;            // Embedding dimension (128, 256, 384, 512, 768)
    clusteringAlgorithm?: 'dbscan' | 'kmeans' | 'hierarchical' | 'simple'; // Default algorithm (for backward compat)
    contributionWeights?: {                  // Default weights (for backward compat)
      robustness: number;                    // Weight for robustness (default: 0.4)
      novelty: number;                       // Weight for novelty (default: 0.3)
      diversity: number;                     // Weight for diversity (default: 0.3)
    };
    minModeSize?: number;                    // Minimum outputs per mode
    maxModes?: number;                       // Maximum number of modes
    enableUserPreference?: boolean;         // Allow user preference selection

    // NEW: Validator pluralism (epistemic decentralization)
    enableValidatorPluralism?: boolean;     // Allow validators to choose their own methods (default: true)
    minMethodDiversity?: number;            // Minimum method diversity score (0-1, default: 0.3)
    minUniqueMethods?: number;              // Minimum unique methods required (default: 2)

    // NEW: Custom embedding configuration (user-provided API keys)
    embeddingConfig?: {
      provider: 'openai' | 'xenova' | 'none';  // Embedding provider: 'openai' (custom), 'xenova' (free), 'none' (hash-based)
      apiKey?: string;                         // User-provided API key (for OpenAI, encrypted in DB)
      model?: string;                          // Model name (e.g., 'text-embedding-3-small', 'text-embedding-3-large')
      dimension?: number;                      // Embedding dimension (OpenAI: 1536 for small, 3072 for large)
    };
  };

  // Human-in-the-Loop Config
  humanInTheLoop?: {
    enabled: boolean;        // Whether human selection is enabled
    topN: number;            // Number of outputs to pre-filter
    userSelectionWeight: number; // Weight of user selection (0-1)

    // User preference for pre-filtering (optional)
    // If specified, uses preference-based sampling from StatisticalDistributionService
    userPreference?: {
      type: 'safe' | 'novel' | 'diverse' | 'balanced'; // Pre-defined preference types
      // OR custom preference vector
      customPreference?: {
        alpha: number;  // Weight for robustness (safe) - default: 0.4
        beta: number;  // Weight for novelty (creative) - default: 0.3
        gamma: number; // Weight for diversity (exploratory) - default: 0.3
      };
    };
  };

  // User Redo Mechanism (Anti-Collusion)
  userRedo?: {
    enabled: boolean;        // Whether user can reject and request redo
    maxRedos: number;        // Maximum number of redos per task (default: 3)
    validatorReplacement: boolean; // Replace validators on redo (default: true)
    collusionTracking: boolean; // Track validator patterns (default: true)
  };

  validatorConfig: {
    minValidators: number;   // Minimum validators required
    consensusThreshold: number;  // N-of-M consensus (e.g., 3-of-5)
    disputeWindow: number;       // Dispute window in seconds
    stakeRequired: string;       // Token amount required to stake
  };

  // Challenge Resolution (optional)
  challengeResolution?: {
    mode: 'validator' | 'oracle' | 'governance'; // Default: 'validator'
    oracleAddress?: string;     // Oracle contract address (if mode = 'oracle')
    oracleType?: 'chainlink' | 'uma' | 'custom'; // Oracle type (if mode = 'oracle')
    governanceToken?: string;   // Governance token address (if mode = 'governance')
  };

  // Settlement Layer
  settlement: {
    mode: SettlementMode;
    chain: SupportedChain;
    contractAddress?: string; // For Mode A (escrow)
    tokenAddress?: string;    // Settlement asset address (bound in Step 3)
    validatorRegistryAddress?: string; // FIX #2: Validator registry contract address (for on-chain checks)

    // Settlement Asset Binding (Flow C - Step 3)
    settlementAsset?: {
      bindingType: 'native-token' | 'existing-token' | 'credit-based' | 'hybrid';
      boundAt?: string; // ISO timestamp when asset was bound
      bindingTxHash?: string; // Transaction hash of binding
    };
  };

  // Network Requirements (Flow C - Step 2)
  networkRequirements: {
    requiresPayment: boolean;
    requiresStaking: boolean;
    requiresSlashing: boolean;
  };

  // Graduation Status (automatic progression based on usage)
  graduation?: GraduationStatus;

  // Creator Token Vesting
  creatorTokenVesting?: {
    contractAddress: string; // Vesting contract address
    totalVested: string; // Total amount vested
    unlockedAmount: string; // Amount unlocked so far
  };

  // Tokenomics (optional - only if network needs payment or staking)
  // These settings are used when binding a native token as settlement asset
  tokenomics?: {
    totalSupply: number;
    initialPrice: number;
    presaleAllocation: number;
    liquidityAllocation: number;
    teamAllocation: number;
    marketingAllocation: number;
    vestingPeriod: number;
    lockupPeriod: number;
    minInvestment: number;
    maxInvestment: number;
    launchThreshold: number;
  };

  // Token Design (REMOVED from network creation - now in SettlementAssetBinding)
  // Token only exists if network bound a native token in Step 3
  token?: any;

  // Risk Parameters (Protocol-Level Anti-Cheat)
  // token?: { ... } - REMOVED

  // Risk Parameters (Protocol-Level Anti-Cheat)
  riskParameters: {
    // Safe parameters (cheap - limit damage/value extraction)
    payoutCap: string;              // Max payout per task (lower = safer = cheaper)
    settlementDelay: number;         // Delay in seconds before settlement (higher = safer = cheaper)
    taskSchemaFixed: boolean;        // Fixed vs custom schema (fixed = safer = cheaper)

    // Risk-enabling parameters (expensive - enable value extraction/cheating)
    customScoring: boolean;          // Custom vs standard scoring (custom = riskier = expensive)
    instantPayout: boolean;          // Instant vs delayed payout (instant = riskier = expensive)
    singleValidator: boolean;        // Single vs multi-validator (single = riskier = expensive)
    nonDeterministic: boolean;       // Non-deterministic evaluation allowed (riskier = expensive)
    validatorSelfSelect: boolean;    // Validators can self-select tasks (riskier = expensive)
    maxPayoutPerTask: string;       // Maximum payout per task (higher = riskier = expensive)
  };

  // Penalty Configuration (Configurable by Network Creator)
  penaltyConfig: {
    // Penalty mechanism type
    mechanism: 'slashing' | 'reputation-only' | 'temporary-ban' | 'warning-system' | 'hybrid' | 'none';

    // Slashing configuration (if mechanism includes slashing)
    slashing?: {
      enabled: boolean;              // Can be disabled even if mechanism is 'slashing'
      rate: number;                  // 0-100, percentage of stake to slash (e.g., 25 = 25%)
      minStakeRequired: string;      // Minimum stake required for slashing to apply
      cooldownPeriod: number;        // Cooldown period in seconds (default: 7 days)
    };

    // Reputation-only penalties (if mechanism is 'reputation-only' or 'hybrid')
    reputation?: {
      enabled: boolean;
      penaltyPerOffense: number;     // Reputation points deducted (0-100 scale)
      minReputationForBan: number;    // If reputation drops below this, validator is banned
      recoveryRate: number;           // Reputation recovery per successful validation (0-1)
    };

    // Temporary ban system (if mechanism is 'temporary-ban' or 'hybrid')
    temporaryBan?: {
      enabled: boolean;
      banDuration: number;            // Ban duration in seconds (e.g., 7 days)
      offensesBeforeBan: number;      // Number of offenses before ban triggers
      escalationFactor: number;      // Ban duration multiplier per repeat offense (e.g., 2x)
    };

    // Warning system (if mechanism is 'warning-system' or 'hybrid')
    warningSystem?: {
      enabled: boolean;
      warningsBeforeAction: number;   // Number of warnings before penalty
      warningExpiry: number;          // Warning expiry time in seconds
      actionAfterWarnings: 'reputation' | 'ban' | 'slash'; // Action after max warnings
    };

    // Hybrid mode: Combine multiple mechanisms
    hybrid?: {
      firstOffense: 'warning' | 'reputation' | 'slash';
      secondOffense: 'reputation' | 'slash' | 'ban';
      thirdOffense: 'slash' | 'ban' | 'permanent-ban';
      permanentBanThreshold: number;  // Number of offenses before permanent ban
    };
  };

  // Risk Assessment (calculated at creation, immutable)
  riskAssessment?: {
    totalRisk: number;              // 0-100, higher = riskier
    riskCategory: 'safe' | 'moderate' | 'risky' | 'dangerous';
    requiredCosts: {
      creationFee: string;
      creatorReward: string;
      requiredStake: string;
      settlementDelay: number;
      escrowLockup: number;
      slashingEnabled: boolean;
      slashingRate: number;
    };
  };

  // Advanced Risk Scoring Configuration (Anti-Gaming)
  advancedRiskScoring?: {
    enabled: boolean;               // Enable advanced risk scoring (default: true)
    multiDimensional: boolean;       // Use multi-dimensional risk vectors (default: true)
    taskConditioned: boolean;        // Use task-conditioned risk (default: true)
    surprisalPenalty: boolean;       // Apply surprisal penalties (default: true)
    temporalDecay: boolean;         // Apply temporal decay (default: true)
    adversarialTesting: boolean;     // Enable adversarial testing (default: true)
    correlationDetection: boolean;   // Detect correlated behavior (default: true)
    networkSpecific: boolean;        // Use network-specific risk (default: true)
    globalOverlay: boolean;          // Use global overlay (weak prior, default: false)
  };

  // Money Flow Configuration (Protocol-Level)
  moneyFlow: {
    // Where creation fees go
    creationFeeSplit: {
      creatorReward: number;      // % to creator (0-100)
      minerPool: number;          // % to miner reward pool
      purposeBoundSinks: number;  // % to purpose-bound sinks (validator subsidy, audit bonds, disputes, infra)
      burn: number;               // % to burn
    };

    // Transaction/usage cut (per task)
    usageCut: {
      enabled: boolean;
      percentage: number;         // % of task payment to creator
      minCut: string;            // Minimum cut per task
      maxCut: string;            // Maximum cut per task
    };

    // Validator payment (per task) - CRITICAL: Validators must be paid
    validatorPayment: {
      enabled: boolean;
      percentage: number;         // % of task payment to validators (split equally)
      minPayment: string;        // Minimum payment per validator
      maxPayment: string;        // Maximum payment per validator
    };
  };

  // Registry
  registry: {
    ipfsCid: string;         // IPFS CID of this manifest
    gitUrl?: string;         // Optional Git mirror URL
  };
}

/**
 * Network Creation Request
 */
/**
 * FLOW C: Network-First, Token-Later, Protocol-Bound
 * 
 * Step 1: Create network WITHOUT token
 * Step 2: Network declares requirements (payment, staking, slashing)
 * Step 3: Bind settlement asset (separate step)
 * Step 4: Token created only if needed (native token option)
 */

export interface NetworkCreationRequest {
  name: string;
  description: string;
  category: string;

  // AI Module (Module Layer) - REQUIRED
  moduleId: string; // Module to use (defines task schema, scoring, validation)

  // Task format (optional overrides - module provides defaults)
  taskInputSchema?: object; // Optional override of module's taskInputSchema
  taskOutputSchema?: object; // Optional override of module's taskOutputSchema
  taskTimeout?: number; // Optional override of module's taskTimeout

  // Scoring (optional overrides - module provides defaults)
  scoringType?: ScoringType; // Optional override of module's scoringType
  scoringModuleHash?: string; // Optional override of module's scoringModuleHash
  scoringModuleUrl?: string; // Optional override of module's scoringModuleUrl

  // Validators
  minValidators: number;
  consensusThreshold: number;
  disputeWindow: number;
  stakeRequired: string;

  // Challenge Resolution (optional)
  challengeResolutionMode?: 'validator' | 'oracle' | 'governance'; // Default: 'validator'
  oracleAddress?: string;     // Oracle contract address (if mode = 'oracle')
  oracleType?: 'chainlink' | 'uma' | 'custom'; // Oracle type (if mode = 'oracle')

  // NETWORK REQUIREMENTS DECLARATION (Step 2 - REQUIRED, not optional)
  // Network must declare what it needs - this is protocol-level
  networkRequirements: {
    requiresPayment: boolean;      // Does network require payment for tasks?
    requiresStaking: boolean;       // Does network require validators to stake?
    requiresSlashing: boolean;      // Does network require slashing penalties?
  };

  // Penalty Configuration (Configurable by Network Creator)
  penaltyConfig: {
    mechanism: 'slashing' | 'reputation-only' | 'temporary-ban' | 'warning-system' | 'hybrid' | 'none';
    slashing?: {
      enabled: boolean;
      rate: number;                  // 0-100, percentage of stake to slash
      minStakeRequired: string;
      cooldownPeriod: number;        // Cooldown in seconds (default: 7 days)
    };
    reputation?: {
      enabled: boolean;
      penaltyPerOffense: number;     // Reputation points deducted (0-100 scale)
      minReputationForBan: number;   // If reputation drops below this, validator is banned
      recoveryRate: number;           // Reputation recovery per successful validation (0-1)
    };
    temporaryBan?: {
      enabled: boolean;
      banDuration: number;          // Ban duration in seconds
      offensesBeforeBan: number;     // Number of offenses before ban triggers
      escalationFactor: number;     // Ban duration multiplier per repeat offense
    };
    warningSystem?: {
      enabled: boolean;
      warningsBeforeAction: number;  // Number of warnings before penalty
      warningExpiry: number;         // Warning expiry time in seconds
      actionAfterWarnings: 'reputation' | 'ban' | 'slash';
    };
    hybrid?: {
      firstOffense: 'warning' | 'reputation' | 'slash';
      secondOffense: 'reputation' | 'slash' | 'ban';
      thirdOffense: 'slash' | 'ban' | 'permanent-ban';
      permanentBanThreshold: number;
    };
  };

  // Settlement
  settlementMode: SettlementMode;
  settlementChain?: SupportedChain; // Optional: Automatically determined by protocol based on payment mechanism

  // TOKEN REMOVED FROM NETWORK CREATION (Flow C)
  // Token binding happens in separate step after network creation
  token?: any;

  // Tokenomics (optional - only if network needs payment or staking)
  // token?: { ... } - REMOVED

  // Tokenomics (optional - only if network needs payment or staking)
  // These settings are used when binding a native token as settlement asset
  tokenomics?: {
    totalSupply: number;
    initialPrice: number;
    presaleAllocation: number;
    liquidityAllocation: number;
    teamAllocation: number;
    marketingAllocation: number;
    vestingPeriod: number;
    lockupPeriod: number;
    minInvestment: number;
    maxInvestment: number;
    launchThreshold: number;
  };

  // Creator
  creatorAddress: string;        // Creator address
  creatorSignature: string;

  // Risk Parameters (Protocol-Level Anti-Cheat)
  riskParameters: {
    payoutCap: string;
    settlementDelay: number;
    taskSchemaFixed: boolean;
    customScoring: boolean;
    instantPayout: boolean;
    singleValidator: boolean;
    nonDeterministic: boolean;
    validatorSelfSelect: boolean;
    maxPayoutPerTask: string;
  };

  // Evaluation Mode (Hybrid Approach - Optional, defaults to deterministic)
  evaluationMode?: 'deterministic' | 'statistical' | 'human-in-the-loop';
  deterministicReplay?: {
    required: boolean;
    seedRequired: boolean;
    intermediateHashing: boolean;
  };
  statisticalEvaluation?: {
    multipleOutputs: boolean;
    minOutputs: number;
    weightedScoring: boolean;
    agreementThreshold: number;

    // Custom embedding configuration (user-provided API keys)
    embeddingConfig?: {
      provider: 'openai' | 'xenova' | 'none';  // Embedding provider: 'openai' (custom), 'xenova' (free), 'none' (hash-based)
      apiKey?: string;                         // User-provided API key (for OpenAI, encrypted in DB)
      model?: string;                          // Model name (e.g., 'text-embedding-3-small', 'text-embedding-3-large')
      dimension?: number;                      // Embedding dimension (OpenAI: 1536 for small, 3072 for large)
    };
  };
  humanInTheLoop?: {
    enabled: boolean;
    topN: number;
    userSelectionWeight: number;
  };

  // Money Flow Configuration (Protocol-Level)
  moneyFlow: {
    creationFeeSplit: {
      creatorReward: number;
      minerPool: number;
      purposeBoundSinks: number;  // % to purpose-bound sinks (validator subsidy, audit bonds, disputes, infra)
      burn: number;
    };
    usageCut: {
      enabled: boolean;
      percentage: number;
      minCut: string;
      maxCut: string;
    };
    validatorPayment: {
      enabled: boolean;
      percentage: number;
      minPayment: string;
      maxPayment: string;
    };
  };

  // Payment verification (optional)
  paymentTxHash?: string; // Transaction hash proving payment of creation fees
}

/**
 * Settlement Asset Binding (Step 3 - Flow C)
 * 
 * Network binds a settlement asset AFTER network creation.
 * This is a binding, not a link - once bound, tasks/rewards/penalties use it.
 */
export interface SettlementAssetBinding {
  networkId: string;
  bindingType: 'native-token' | 'existing-token' | 'credit-based' | 'hybrid';

  // For native-token: deploy new token
  nativeToken?: {
    name: string;
    symbol: string;
    totalSupply: string;
    design: TokenDesign;
    params: object;
  };

  // For existing-token: use existing token (ETH, SOL, USDC, etc.)
  existingToken?: {
    chain: SupportedChain;
    tokenAddress: string;
    tokenSymbol: string;
  };

  // For credit-based: off-chain payment system
  creditBased?: {
    paymasterAddress?: string;
    creditLimit?: string;
  };

  // For hybrid: combination of above
  hybrid?: {
    primaryAsset: 'native-token' | 'existing-token' | 'credit-based';
    secondaryAssets?: Array<{
      type: 'native-token' | 'existing-token' | 'credit-based';
      weight: number; // 0-100, percentage
      config: any;
    }>;
  };

  // Binding metadata
  creatorAddress: string;
  creatorSignature: string;
  bindingTxHash?: string; // Transaction hash if on-chain binding
}

/**
 * Network Deployment Status
 */
export interface NetworkDeploymentStatus {
  networkId: string;
  status: 'pending' | 'deploying' | 'deployed' | 'failed';
  progress: number;
  steps: {
    id: string;
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    error?: string;
  }[];
  contractAddress?: string;
  tokenAddress?: string;
  ipfsCid?: string;
  error?: string;
  statistics?: {
    totalTasks: number;
    activeTasks: number;
    completedTasks: number;
    totalDeposits: string;
    totalPayouts: string;
    validatorCount: number;
    minerCount: number;
  };
  onChainState?: {
    contractDeployed: boolean;
    totalDeposits: string | null;
    totalReleased: string | null;
    validatorCount: number | null;
  };
}

/**
 * Task Submission
 */
export interface TaskSubmission {
  taskId: string;
  networkId: string;
  input: object;
  minerAddress: string;
  timestamp: number;
}

/**
 * Task Result
 */
export interface TaskResult {
  taskId: string;
  networkId: string;
  output: object;
  minerAddress: string;
  timestamp: number;
  score?: number;
}

/**
 * Validator Signature
 */
export interface ValidatorSignature {
  validatorAddress: string;
  taskId: string;
  accepted: boolean;
  score: number;
  signature: string;
  timestamp: number;
}

/**
 * Settlement Receipt (Mode B)
 */
export interface SettlementReceipt {
  taskId: string;
  networkId: string;
  amount: string;
  recipient: string;
  validatorSignatures: ValidatorSignature[];
  timestamp: number;
  disputeWindowEnd: number;
}

/**
 * Escrow Deposit (Mode A)
 */
export interface EscrowDeposit {
  taskId: string;
  networkId: string;
  depositor: string;
  amount: string;
  tokenAddress?: string;  // If using network token
  timestamp: number;
}

/**
 * Escrow Release (Mode A)
 */
export interface EscrowRelease {
  taskId: string;
  networkId: string;
  recipient: string;
  amount: string;
  validatorSignatures: ValidatorSignature[];
  timestamp: number;
}

/**
 * Inter-Network Call (INC)
 * Signed request from one network to another
 */
export interface InterNetworkCall {
  incId: string;                    // Unique identifier (hash of source + dest + payload + timestamp)
  sourceNetworkId: string;          // Network making the call
  destinationNetworkId: string;     // Network receiving the call
  taskPayload: object;              // Task input for destination network
  maxBudget: string;                // Maximum payment for this call
  settlementMode: SettlementMode;  // How payment is handled
  signature: string;                // Signature from source network validators (consensus)
  timestamp: number;                // Unix timestamp when call was created
  maxDepth: number;                 // Maximum call depth (prevents infinite loops)
  currentDepth: number;             // Current depth in call chain
  callChain: string[];              // List of network IDs in call chain (prevents cycles)
  metadata?: object;                // Optional metadata (purpose, context, etc.)
}

/**
 * INC Receipt
 * Result from destination network
 */
export interface INCCallReceipt {
  incId: string;
  destinationNetworkId: string;
  result: object;                    // Task result from destination network
  receipt: SettlementReceipt;       // Payment receipt
  timestamp: number;
  success: boolean;
  error?: string;                    // Error if call failed
}

/**
 * INC Call Failure
 */
export interface INCCallFailure {
  incId: string;
  sourceNetworkId: string;
  destinationNetworkId: string;
  reason: 'budget_exceeded' | 'cycle_detected' | 'max_depth_reached' | 'network_rejected' | 'timeout' | 'invalid_signature';
  message: string;
  timestamp: number;
}

/**
 * Multi-Dimensional Risk Vector
 * Replaces single scalar risk score with multi-dimensional vector
 */
export interface RiskVector {
  exploration: number;    // How much they explore (novelty) - 0-1
  consistency: number;     // How consistent they are - 0-1
  reliability: number;     // How reliable (success rate) - 0-1
  diversity: number;       // How diverse their outputs - 0-1
  surprisal: number;      // How unpredictable (entropy) - 0-1
  temporalStability: number; // How stable over time - 0-1
  adversarialResistance: number; // Resistance to adversarial tests - 0-1
}

/**
 * Task-Conditioned Reputation
 * Reputation per task type/network, not global
 */
export interface TaskConditionedReputation {
  validatorAddress: string;
  networkId: string;
  taskType: string;
  reputation: number;              // 0-100
  riskVector: RiskVector;          // Multi-dimensional risk
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  lastActivity: number;             // Unix timestamp
  temporalDecay: number;            // Decay factor (0-1)
}

/**
 * Validator Risk Correlation
 * Detects correlated risk patterns between validators
 */
export interface ValidatorRiskCorrelation {
  validatorA: string;
  validatorB: string;
  correlationScore: number;         // -1 to 1 (1 = perfectly correlated)
  correlationType: 'positive' | 'negative' | 'none';
  detectedAt: number;               // Unix timestamp
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Adversarial Test Configuration
 */
export interface AdversarialTestConfig {
  globalRate: number;              // Global rate (0-1, default: 0.075 = 7.5%)
  perActorJitter: number;            // Per-actor jitter range (0-1, default: 0.05 = ±5%)
  highReputationMultiplier: number; // Multiplier for high-reputation validators (default: 1.5x)
  rapidGrowthMultiplier: number;    // Multiplier for rapid reputation growth (default: 2.0x)
  correlationMultiplier: number;    // Multiplier for correlated behavior (default: 3.0x)
  minReputationForHighRate: number; // Minimum reputation for high rate (default: 80)
  rapidGrowthThreshold: number;    // Reputation increase per task for "rapid growth" (default: 2)
}

/**
 * Network State for Adaptive Risk Scoring
 */
export interface NetworkState {
  currentEntropy: number;           // Current entropy of outputs (0-1)
  modeCollapseDetected: boolean;    // Whether mode collapse is detected
  taskDifficulty: number;           // Average task difficulty (0-1)
  networkAge: number;               // Network age in days
  maturity: 'early' | 'healthy' | 'mature' | 'declining';
  explorationBias: number;          // Bias toward exploration (0-1, higher = more exploration)
  reliabilityBias: number;          // Bias toward reliability (0-1, higher = more reliability)
}

/**
 * INC Call Budget
 */
export interface INCCallBudget {
  maxBudget: string;                 // Maximum payment
  allocated: string;                 // Amount allocated so far
  remaining: string;                 // Remaining budget
  currency: 'native' | 'network_token';
  tokenAddress?: string;             // If using network token
}
