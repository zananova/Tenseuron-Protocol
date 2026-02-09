/**
 * Network Manifest Generator
 * 
 * Generates deterministic network manifests for the Tenseuron Protocol
 * Network ID is deterministic hash of name + creator + timestamp
 */

import { createHash } from 'crypto';
import { NetworkManifest, NetworkCreationRequest, SettlementAssetBinding } from './types';

export class NetworkManifestGenerator {
  /**
   * Generate deterministic network ID
   * hash(name + creatorAddress + timestamp)
   */
  static generateNetworkId(
    name: string,
    creatorAddress: string,
    timestamp: number
  ): string {
    const input = `${name.toLowerCase().trim()}:${creatorAddress.toLowerCase()}:${timestamp}`;
    const hash = createHash('sha256').update(input).digest('hex');
    return `0x${hash.substring(0, 40)}`; // 20 bytes, 40 hex chars
  }

  /**
   * Generate network manifest from creation request
   */
  static generateManifest(
    request: NetworkCreationRequest,
    module?: import('./types').AIModule,
    timestamp: number = Date.now()
  ): NetworkManifest {
    const networkId = this.generateNetworkId(
      request.name,
      request.creatorAddress,
      timestamp
    );

    const manifest: NetworkManifest = {
      networkId,
      name: request.name,
      description: request.description,
      category: request.category,
      version: '1.0.0', // Protocol version
      
      // AI Module (Module Layer)
      moduleId: request.moduleId, // Reference to AIModule
      module: module, // Full module definition (optional, can be loaded separately)
      
      creatorAddress: request.creatorAddress,
      creatorSignature: request.creatorSignature,
      createdAt: new Date(timestamp).toISOString(),
      
      taskFormat: {
        inputSchema: request.taskInputSchema,
        outputSchema: request.taskOutputSchema,
        timeout: request.taskTimeout,
      },
      
      scoringLogic: {
        type: request.scoringType,
        hash: request.scoringModuleHash,
        url: request.scoringModuleUrl,
      },
      
      // Evaluation Mode (Hybrid Approach - from request if provided)
      evaluationMode: request.evaluationMode || 'deterministic',
      
      // Deterministic Replay Requirements
      deterministicReplay: request.deterministicReplay || {
        required: true,
        seedRequired: request.riskParameters.nonDeterministic, // Seed required for stochastic tasks
        intermediateHashing: false, // Can be enabled for pipeline tasks
      },
      
      // Statistical Evaluation Config (if mode is statistical)
      statisticalEvaluation: request.statisticalEvaluation || (request.evaluationMode === 'statistical' ? {
        multipleOutputs: true,
        minOutputs: 3,
        weightedScoring: true,
        agreementThreshold: 0.6,
      } : undefined),
      
      // Human-in-the-Loop Config (if mode is human-in-the-loop)
      humanInTheLoop: request.humanInTheLoop || (request.evaluationMode === 'human-in-the-loop' ? {
        enabled: true,
        topN: 3,
        userSelectionWeight: 0.1, // 10% weight for user selection
      } : undefined),
      
      validatorConfig: {
        minValidators: request.minValidators,
        consensusThreshold: request.consensusThreshold,
        disputeWindow: request.disputeWindow,
        stakeRequired: request.stakeRequired,
      },
      
      // Challenge resolution (optional - defaults to validator consensus)
      challengeResolution: request.challengeResolutionMode ? {
        mode: request.challengeResolutionMode,
        oracleAddress: request.oracleAddress,
        oracleType: request.oracleType,
      } : undefined,
      
      settlement: {
        mode: request.settlementMode,
        chain: request.settlementChain || 'polygon', // Auto-determined by protocol (default: Polygon)
        // contractAddress and tokenAddress will be added after deployment
      },
      
      registry: {
        ipfsCid: '', // Will be set after IPFS upload
      },
      
      // Risk Parameters (Protocol-Level Anti-Cheat)
      riskParameters: request.riskParameters,
      
      // Money Flow Configuration (Protocol-Level)
      moneyFlow: request.moneyFlow,
      
      // Penalty Configuration (IMMUTABLE - Protocol-Level Anti-Cheat)
      penaltyConfig: request.penaltyConfig || {
        mechanism: 'none',
      },
      
      // Network Requirements (Flow C - Step 2)
      networkRequirements: request.networkRequirements,
      
      // Tokenomics (optional - only if network needs payment or staking)
      // These settings are used when binding a native token as settlement asset
      tokenomics: request.tokenomics,
    };

    return manifest;
  }

  /**
   * Update manifest with deployment results
   * 
   * IMPORTANT: This ONLY updates deployment-related fields (addresses, IPFS CID).
   * It does NOT allow changing core rules (scoring logic, validator config, task format).
   * 
   * Once a manifest is uploaded to IPFS, it is IMMUTABLE.
   * To change rules, creator must create a new network (new networkId).
   */
  static updateManifestWithDeployment(
    manifest: NetworkManifest,
    contractAddress?: string,
    tokenAddress?: string,
    ipfsCid?: string,
    gitUrl?: string
  ): NetworkManifest {
    const updated = { ...manifest };
    
    if (contractAddress) {
      updated.settlement.contractAddress = contractAddress;
    }
    
    if (tokenAddress) {
      updated.settlement.tokenAddress = tokenAddress;
    }
    
    if (ipfsCid) {
      updated.registry.ipfsCid = ipfsCid;
    }
    
    if (gitUrl) {
      updated.registry.gitUrl = gitUrl;
    }
    
    return updated;
  }

  /**
   * Update manifest with settlement asset binding (Flow C - Step 3)
   * 
   * Binds a settlement asset to the network after network creation.
   * This is a binding, not a link - once bound, tasks/rewards/penalties use it.
   */
  static updateManifestWithSettlementAsset(
    manifest: NetworkManifest,
    binding: {
      bindingType: 'native-token' | 'existing-token' | 'credit-based' | 'hybrid';
      tokenAddress?: string;
      boundAt: string;
      bindingTxHash?: string;
    }
  ): NetworkManifest {
    const updated = { ...manifest };
    
    // Update settlement asset binding
    updated.settlement.settlementAsset = {
      bindingType: binding.bindingType,
      boundAt: binding.boundAt,
      bindingTxHash: binding.bindingTxHash,
    };
    
    // Update token address if provided
    if (binding.tokenAddress) {
      updated.settlement.tokenAddress = binding.tokenAddress;
    }
    
    // If native token was bound, add token config to manifest
    if (binding.bindingType === 'native-token' && binding.tokenAddress) {
      // Token config will be added when binding is processed
      // For now, we just mark that token exists
    }
    
    return updated;
  }

  /**
   * Validate manifest structure
   */
  static validateManifest(manifest: NetworkManifest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!manifest.networkId || !manifest.networkId.startsWith('0x')) {
      errors.push('Invalid networkId: must start with 0x');
    }

    if (!manifest.name || manifest.name.trim().length === 0) {
      errors.push('Name is required');
    }

    if (!manifest.creatorAddress) {
      errors.push('Creator address is required');
    }

    if (!manifest.taskFormat || !manifest.taskFormat.inputSchema || !manifest.taskFormat.outputSchema) {
      errors.push('Task format with input/output schemas is required');
    }

    if (!manifest.scoringLogic || !manifest.scoringLogic.hash || !manifest.scoringLogic.url) {
      errors.push('Scoring logic with hash and URL is required');
    }

    if (!manifest.validatorConfig || manifest.validatorConfig.minValidators < 1) {
      errors.push('Validator config with at least 1 validator is required');
    }

    if (!manifest.settlement || !manifest.settlement.chain) {
      errors.push('Settlement chain is required');
    }

    if (manifest.settlement.mode === 'escrow' && !manifest.settlement.contractAddress) {
      errors.push('Contract address required for escrow mode');
    }

    // Validate risk parameters
    if (!manifest.riskParameters) {
      errors.push('Risk parameters are required');
    } else {
      if (!manifest.riskParameters.payoutCap || parseFloat(manifest.riskParameters.payoutCap) < 0) {
        errors.push('Valid payout cap is required');
      }
      if (manifest.riskParameters.settlementDelay < 0) {
        errors.push('Settlement delay must be non-negative');
      }
      if (!manifest.riskParameters.maxPayoutPerTask || parseFloat(manifest.riskParameters.maxPayoutPerTask) < 0) {
        errors.push('Valid max payout per task is required');
      }
    }

    // Validate money flow configuration
    if (!manifest.moneyFlow) {
      errors.push('Money flow configuration is required');
    } else {
      const split = manifest.moneyFlow.creationFeeSplit;
      const totalSplit = split.creatorReward + split.minerPool + split.purposeBoundSinks + split.burn;
      if (Math.abs(totalSplit - 100) > 0.01) { // Allow small floating point errors
        errors.push(`Creation fee split must total 100% (got ${totalSplit}%)`);
      }
      
      // CRITICAL: Validate validator payment is enabled
      if (!manifest.moneyFlow.validatorPayment || !manifest.moneyFlow.validatorPayment.enabled) {
        errors.push('Validator payment must be enabled (validators must be paid)');
      }
    }

    // Validate penalty configuration
    if (!manifest.penaltyConfig) {
      errors.push('Penalty configuration is required');
    }

    // FLOW C: Token is optional (only exists if settlement asset was bound)
    // Token validation only applies if token exists
    if (manifest.token) {
      if (!manifest.token.design) {
        errors.push('Token design type is required');
      }
      if (!manifest.token.name || !manifest.token.symbol || !manifest.token.totalSupply) {
        errors.push('Token name, symbol, and total supply are required');
      }
    }
    
    // Validate network requirements (Flow C - Step 2)
    if (!manifest.networkRequirements) {
      errors.push('Network requirements declaration is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Calculate manifest hash (for verification)
   */
  static calculateManifestHash(manifest: NetworkManifest): string {
    // Remove fields that change (ipfsCid, gitUrl) for hash calculation
    const { registry, ...stableManifest } = manifest;
    const stableRegistry = { ipfsCid: '', gitUrl: registry.gitUrl };
    const hashable = { ...stableManifest, registry: stableRegistry };
    
    const json = JSON.stringify(hashable, Object.keys(hashable).sort());
    return createHash('sha256').update(json).digest('hex');
  }
}
