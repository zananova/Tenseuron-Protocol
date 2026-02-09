/**
 * Protocol Service
 * 
 * Core orchestration service for Tenseuron Protocol
 * Handles network creation, deployment, and lifecycle
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest, NetworkCreationRequest, NetworkDeploymentStatus, SupportedChain, SettlementAssetBinding } from './types';
import { NetworkManifestGenerator } from './NetworkManifestGenerator';
import { DecentralizedRegistryService } from './DecentralizedRegistryService';
import { RegistryService } from './RegistryService'; // Keep for backward compatibility
import { SettlementService } from './SettlementService';
import { ScamDefenseService } from './ScamDefenseService';
import { RiskScoringService, RiskParameters, RequiredCosts } from './RiskScoringService';
import { MoneyFlowService } from './MoneyFlowService';
import { PenaltyConfigValidator } from './PenaltyConfigValidator';
import { PrismaClient } from '@prisma/client';

export class ProtocolService {
  private logger: ILogger;
  private prisma?: PrismaClient;
  private decentralizedRegistry: DecentralizedRegistryService;
  private registryService: RegistryService; // Legacy, for backward compatibility
  private settlementService: SettlementService;
  private scamDefenseService: ScamDefenseService;
  private riskScoringService: RiskScoringService;
  private moneyFlowService: MoneyFlowService;

  constructor(logger: ILogger, prisma?: PrismaClient) {
    this.logger = logger;
    this.prisma = prisma;
    this.decentralizedRegistry = new DecentralizedRegistryService(logger);
    this.registryService = new RegistryService(logger); // Legacy
    this.settlementService = new SettlementService(logger);
    this.scamDefenseService = new ScamDefenseService(logger, prisma);
    this.riskScoringService = new RiskScoringService(logger);
    this.moneyFlowService = new MoneyFlowService(logger);
  }

  /**
   * Create a new AI Network using the Tenseuron Protocol
   * This is the main entry point for network creation
   */
  async createNetwork(request: NetworkCreationRequest): Promise<{
    networkId: string;
    manifest: NetworkManifest;
    deploymentStatus: NetworkDeploymentStatus;
    creationFees: {
      bond: string;
      deploymentCost: string;
      registryFee: string;
      total: string;
    };
  }> {
    this.logger.info('Creating new AI Network', { name: request.name, moduleId: request.moduleId });

    try {
      // MODULE LAYER: Load AI Module and pre-fill schemas
      const { AIModuleService } = await import('../services/AIModuleService');
      const prisma = this.prisma || new (await import('@prisma/client')).PrismaClient();
      const moduleService = new AIModuleService(prisma, this.logger);

      const module = await moduleService.getModuleById(request.moduleId);
      if (!module) {
        throw new Error(`AI Module not found: ${request.moduleId}`);
      }

      if (!module.isActive) {
        throw new Error(`AI Module is not active: ${request.moduleId}`);
      }

      this.logger.info('AI Module loaded', {
        moduleId: module.moduleId,
        name: module.name,
        category: module.category
      });

      // Pre-fill task schemas from module (use overrides if provided)
      const taskInputSchema = request.taskInputSchema || module.taskInputSchema;
      const taskOutputSchema = request.taskOutputSchema || module.taskOutputSchema;
      const taskTimeout = request.taskTimeout || module.taskTimeout;

      // Pre-fill scoring from module (use overrides if provided)
      const scoringType = request.scoringType || (module.scoringType as ScoringType);
      const scoringModuleHash = request.scoringModuleHash || module.scoringModuleHash || '';
      const scoringModuleUrl = request.scoringModuleUrl || module.scoringModuleUrl || '';

      // Pre-fill evaluation mode from module
      const evaluationMode = request.evaluationMode || module.evaluationMode;

      // Log what was used (module defaults vs overrides)
      this.logger.info('Task schema source', {
        taskInputSchema: request.taskInputSchema ? 'override' : 'module',
        taskOutputSchema: request.taskOutputSchema ? 'override' : 'module',
        taskTimeout: request.taskTimeout ? 'override' : 'module',
        scoringType: request.scoringType ? 'override' : 'module',
        evaluationMode: request.evaluationMode ? 'override' : 'module'
      });

      // Step 0: Calculate risk score and required costs (PROTOCOL-LEVEL)
      const riskParams: RiskParameters = {
        payoutCap: request.riskParameters.payoutCap,
        settlementDelay: request.riskParameters.settlementDelay,
        taskSchemaFixed: request.riskParameters.taskSchemaFixed,
        customScoring: request.riskParameters.customScoring,
        instantPayout: request.riskParameters.instantPayout,
        singleValidator: request.riskParameters.singleValidator,
        nonDeterministic: request.riskParameters.nonDeterministic,
        validatorSelfSelect: request.riskParameters.validatorSelfSelect,
        maxPayoutPerTask: request.riskParameters.maxPayoutPerTask,
        minValidators: request.minValidators,
        consensusThreshold: request.consensusThreshold,
        disputeWindow: request.disputeWindow,
        stakeRequired: request.stakeRequired,
      };

      // ANTI-RUG PULL: Check creator reputation and eligibility
      const { CreatorReputationService } = await import('../services/CreatorReputationService');
      const { RugDetectionService } = await import('../services/RugDetectionService');
      const { PrismaClient } = await import('@prisma/client');

      // const prisma = this.prisma || new PrismaClient();
      const rugDetectionService = new RugDetectionService(this.logger, prisma);
      const creatorReputationService = new CreatorReputationService(this.logger, prisma, rugDetectionService);

      // Check if creator can create network
      const creationCheck = await creatorReputationService.canCreateNetwork(request.creatorAddress);
      if (!creationCheck.allowed) {
        throw new Error(`Network creation not allowed: ${creationCheck.reason}`);
      }

      // Get creator reputation
      const reputation = await creatorReputationService.getCreatorReputation(request.creatorAddress);
      this.logger.info('Creator reputation check', {
        creatorAddress: request.creatorAddress,
        reputation: reputation.reputation,
        bondMultiplier: reputation.bondMultiplier,
        totalSignals: reputation.totalSignals,
      });

      // CRITICAL: Validate all inputs before processing
      const { InputValidator } = await import('./InputValidator');
      const inputValidator = new InputValidator(this.logger, this.prisma);
      const inputValidation = inputValidator.validateNetworkCreationRequest(request);

      if (!inputValidation.valid) {
        throw new Error(`Invalid network creation request: ${inputValidation.errors.join(', ')}`);
      }

      if (inputValidation.warnings.length > 0) {
        this.logger.warn('Network creation request warnings', { warnings: inputValidation.warnings });
      }

      // Validate risk parameters
      const riskValidation = this.riskScoringService.validateRiskParameters(riskParams);
      if (!riskValidation.valid) {
        throw new Error(`Invalid risk parameters: ${riskValidation.errors.join(', ')}`);
      }

      // Calculate risk score first (needed for default penalty config check)
      const riskScore = this.riskScoringService.calculateRiskScore(riskParams);
      const baseRequiredCosts = this.riskScoringService.calculateRequiredCosts(
        riskScore,
        request.riskParameters.maxPayoutPerTask,
        false // Calculate base costs first
      );

      // Validate penalty configuration
      if (request.penaltyConfig) {
        const penaltyValidator = new PenaltyConfigValidator(this.logger);
        const penaltyValidation = penaltyValidator.validate(request.penaltyConfig);
        if (!penaltyValidation.valid) {
          throw new Error(`Invalid penalty configuration: ${penaltyValidation.errors.join(', ')}`);
        }
        if (penaltyValidation.warnings.length > 0) {
          this.logger.warn('Penalty configuration warnings', { warnings: penaltyValidation.warnings });
        }
      }

      // Check if user provided custom penalty configuration (adds security fee)
      // Using protocol defaults is free, custom config costs extra
      const hasCustomPenaltyConfig = request.penaltyConfig &&
        request.penaltyConfig.mechanism !== 'none' &&
        !this.isDefaultPenaltyConfig(request.penaltyConfig, baseRequiredCosts);

      // Recalculate with penalty config fee if custom config provided
      const requiredCosts = this.riskScoringService.calculateRequiredCosts(
        riskScore,
        request.riskParameters.maxPayoutPerTask,
        hasCustomPenaltyConfig
      );

      this.logger.info('Risk assessment completed', {
        totalRisk: riskScore.totalRisk,
        riskCategory: riskScore.riskCategory,
        requiredCreationFee: requiredCosts.creationFee,
        requiredStake: requiredCosts.requiredStake,
        penaltyConfigFee: requiredCosts.penaltyConfigFee,
        hasCustomPenaltyConfig,
      });

      // Validate money flow configuration
      const moneyFlowValidation = this.moneyFlowService.validateMoneyFlowConfig(request.moneyFlow);
      if (!moneyFlowValidation.valid) {
        throw new Error(`Invalid money flow configuration: ${moneyFlowValidation.errors.join(', ')}`);
      }

      // Determine settlement chain automatically based on payment mechanism
      // Protocol rule: Settlement chain is determined by payment mechanism, not creator choice
      // - If network token will be deployed, use token's chain (default: Polygon for low fees)
      // - If no token (native payments), default to Polygon for low fees
      // This ensures miners and validators know which chain they'll be paid on
      // Use 'let' so we can update it after token deployment if needed
      let settlementChain: SupportedChain = request.token ? 'polygon' : 'polygon'; // Default to Polygon for low fees

      this.logger.info('Settlement chain determined automatically', {
        settlementChain,
        hasNetworkToken: !!request.token,
        reason: 'Protocol automatically selects Polygon for low fees (miners/validators will be paid on this chain)'
      });

      // Calculate creation fees based on risk (PROTOCOL-LEVEL PRICING)
      const creationFees = this.scamDefenseService.calculateCreationFees(
        settlementChain,
        requiredCosts
      );

      // ANTI-RUG PULL: Calculate creator bond based on reputation and network value
      // Bond scales with network value and creator reputation (lower rep = higher bond)
      const estimatedNetworkValue = parseFloat(requiredCosts.requiredStake) * 10; // Estimate: 10x stake
      const requiredBond = await creatorReputationService.calculateRequiredBond(
        request.creatorAddress,
        estimatedNetworkValue.toString(),
        0.01 // 1% base bond
      );

      // Add bond to creation fees
      const totalFees = parseFloat(creationFees.total) + parseFloat(requiredBond);

      this.logger.info('Network creation fees calculated (risk-based + bond)', {
        chain: settlementChain,
        creationFee: creationFees.total,
        creatorBond: requiredBond,
        total: totalFees.toString(),
        riskCategory: riskScore.riskCategory,
        creatorReputation: reputation.reputation,
        bondMultiplier: reputation.bondMultiplier,
      });

      // Route creation fees according to money flow config
      const feeRouting = this.moneyFlowService.routeCreationFee(
        creationFees.total,
        request.creatorAddress,
        request.moneyFlow
      );
      this.logger.info('Creation fee routing calculated', {
        creatorReward: feeRouting.creatorReward,
        minerPool: feeRouting.minerPool,
        purposeBoundSinks: feeRouting.purposeBoundSinks,
        burn: feeRouting.burn,
      });

      // FULLY IMPLEMENTED: Require payment verification before network creation in production
      const isProduction = process.env.NODE_ENV === 'production' || process.env.REQUIRE_PAYMENT_VERIFICATION === 'true';

      if (isProduction) {
        // In production, payment verification is REQUIRED
        if (!request.paymentTxHash) {
          throw new Error('Payment verification is required in production. Please provide a payment transaction hash.');
        }

        const paymentVerified = await this.scamDefenseService.verifyCreationPayment(
          '', // networkId not yet generated, will be set after manifest creation
          request.creatorAddress,
          settlementChain, // Use automatically determined chain
          request.paymentTxHash
        );

        if (!paymentVerified) {
          throw new Error('Payment verification failed. Please ensure the transaction is confirmed and sender matches creator address.');
        }

        this.logger.info('Network creation payment verified (production mode)', {
          txHash: request.paymentTxHash,
          creator: request.creatorAddress
        });
      } else {
        // In development/test, payment verification is optional but recommended
        if (request.paymentTxHash) {
          const paymentVerified = await this.scamDefenseService.verifyCreationPayment(
            '', // networkId not yet generated, will be set after manifest creation
            request.creatorAddress,
            settlementChain, // Use automatically determined chain
            request.paymentTxHash
          );

          if (!paymentVerified) {
            throw new Error('Payment verification failed. Please ensure the transaction is confirmed and sender matches creator address.');
          }

          this.logger.info('Network creation payment verified (development mode)', {
            txHash: request.paymentTxHash,
            creator: request.creatorAddress
          });
        } else {
          this.logger.warn('No payment transaction hash provided. Payment verification skipped (development mode). Payment verification is REQUIRED in production.');
        }
      }

      // Step 1: Generate network manifest (with risk assessment embedded)
      // Override settlementChain in request with automatically determined chain
      // Include module-loaded schemas and moduleId
      const manifestRequest = {
        ...request,
        moduleId: request.moduleId, // Include moduleId
        taskInputSchema: taskInputSchema, // Use module-loaded schema
        taskOutputSchema: taskOutputSchema, // Use module-loaded schema
        taskTimeout: taskTimeout, // Use module-loaded timeout
        scoringType: scoringType, // Use module-loaded scoring type
        scoringModuleHash: scoringModuleHash, // Use module-loaded hash
        scoringModuleUrl: scoringModuleUrl, // Use module-loaded URL
        evaluationMode: evaluationMode, // Use module-loaded evaluation mode
        settlementChain: settlementChain // Use automatically determined chain, not creator's choice
      };
      const manifest = NetworkManifestGenerator.generateManifest(manifestRequest, module);

      // Embed risk assessment in manifest (PROTOCOL-LEVEL, IMMUTABLE)
      manifest.riskAssessment = {
        totalRisk: riskScore.totalRisk,
        riskCategory: riskScore.riskCategory,
        requiredCosts: requiredCosts,
      };

      const validation = NetworkManifestGenerator.validateManifest(manifest);

      if (!validation.valid) {
        throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
      }

      this.logger.info('Network manifest generated with risk assessment', {
        networkId: manifest.networkId,
        riskCategory: riskScore.riskCategory
      });

      // Step 2: Deploy network token FIRST (if applicable and not earn-only)
      // For earn-only tokens, we need escrow address, so deploy escrow first
      let tokenAddress: string | undefined;
      let contractAddress: string | undefined;

      // Check if token is earn-only (needs escrow address)
      const isEarnOnlyToken = request.token?.design === 'earn-only';

      if (request.token && !isEarnOnlyToken) {
        // Deploy token first (doesn't need escrow)
        this.logger.info('Deploying network token (before escrow)', {
          networkId: manifest.networkId,
          chain: settlementChain // Use automatically determined chain
        });

        tokenAddress = await this.settlementService.deployNetworkToken({
          networkId: manifest.networkId,
          chain: settlementChain, // Use automatically determined chain
          token: request.token,
        });

        this.logger.info('Network token deployed', {
          networkId: manifest.networkId,
          tokenAddress
        });
      }

      // Step 3: Settlement chain is already determined (Polygon for low fees)
      // Protocol rule: Settlement chain is determined by payment mechanism, not creator choice
      // Token is deployed on the settlement chain we determined earlier
      // No need to change it - we always use Polygon for low fees

      this.logger.info('Settlement chain determined automatically', {
        networkId: manifest.networkId,
        settlementChain,
        hasNetworkToken: !!tokenAddress,
        reason: tokenAddress ? 'Network token chain' : 'Default to Polygon (low fees)'
      });

      // Step 4: Deploy settlement contract (if Mode A)
      if (request.settlementMode === 'escrow') {
        this.logger.info('Deploying escrow contract', {
          networkId: manifest.networkId,
          chain: settlementChain,
          networkToken: tokenAddress || undefined
        });

        // Note: Validator registry can be deployed separately
        // Challenge oracle is optional (0x0 = use validator consensus, default)
        contractAddress = await this.settlementService.deployEscrowContract({
          networkId: manifest.networkId,
          chain: settlementChain,
          disputeWindow: request.disputeWindow,
          minValidators: request.minValidators,
          consensusThreshold: Math.round(request.consensusThreshold * 10000), // Convert 0-1 to basis points (0-10000, e.g., 0.67 = 6700)
          networkToken: tokenAddress || undefined, // Use token if already deployed
          validatorRegistry: undefined, // Can deploy separately
          challengeOracle: request.oracleAddress || undefined, // Optional: 0x0 = validator consensus (default)
          // Money Flow Configuration (Protocol-Level)
          creatorAddress: request.creatorAddress,
          purposeBoundSinks: this.moneyFlowService.getPurposeBoundSinksAddress(),
          usageCutEnabled: request.moneyFlow.usageCut.enabled,
          usageCutPercentage: request.moneyFlow.usageCut.percentage * 100, // Convert percentage to basis points (5% = 500)
          usageCutMin: request.moneyFlow.usageCut.minCut,
          usageCutMax: request.moneyFlow.usageCut.maxCut,
          // Validator Payment Configuration (CRITICAL: Validators must be paid)
          validatorPaymentEnabled: request.moneyFlow.validatorPayment.enabled,
          validatorPaymentPercentage: request.moneyFlow.validatorPayment.percentage * 100, // Convert percentage to basis points (10% = 1000)
          validatorPaymentMin: request.moneyFlow.validatorPayment.minPayment,
          validatorPaymentMax: request.moneyFlow.validatorPayment.maxPayment,
          // Penalty Configuration (IMMUTABLE - Protocol-Level Anti-Cheat)
          penaltyConfig: request.penaltyConfig || {
            mechanism: requiredCosts.slashingEnabled ? 'slashing' : 'none',
            slashing: requiredCosts.slashingEnabled ? {
              enabled: true,
              rate: requiredCosts.slashingRate,
              minStakeRequired: request.stakeRequired || '0',
              cooldownPeriod: 7 * 24 * 60 * 60, // 7 days default
            } : undefined
          }
        });

        this.logger.info('Escrow contract deployed', {
          networkId: manifest.networkId,
          contractAddress
        });
      }

      // FLOW C: No token deployment at network creation
      // Token binding happens separately via bindSettlementAsset()

      // Step 4: Update manifest with deployment results
      const updatedManifest = NetworkManifestGenerator.updateManifestWithDeployment(
        manifest,
        contractAddress,
        tokenAddress
      );

      // Step 5: Upload manifest to IPFS (decentralized, no Pinata dependency)
      const ipfsCid = await this.decentralizedRegistry.uploadManifest(updatedManifest);
      const finalManifest = NetworkManifestGenerator.updateManifestWithDeployment(
        updatedManifest,
        contractAddress,
        tokenAddress,
        ipfsCid
      );

      this.logger.info('Network manifest uploaded to IPFS (decentralized)', {
        networkId: finalManifest.networkId,
        ipfsCid
      });

      // Step 6: Register network in local index (one of many indexes)
      // CRITICAL: This is just ONE index - others can maintain their own
      await this.decentralizedRegistry.registerNetworkInLocalIndex(finalManifest);

      // Step 7: Create deployment status
      const deploymentStatus: NetworkDeploymentStatus = {
        networkId: finalManifest.networkId,
        status: 'deployed',
        progress: 100,
        steps: [
          { id: 'manifest', name: 'Generate Manifest', status: 'completed' },
          { id: 'contract', name: 'Deploy Settlement Contract', status: contractAddress ? 'completed' : 'pending' },
          { id: 'token', name: 'Deploy Network Token', status: tokenAddress ? 'completed' : 'pending' },
          { id: 'ipfs', name: 'Upload to IPFS', status: 'completed' },
          { id: 'registry', name: 'Register Network', status: 'completed' },
        ],
        contractAddress,
        tokenAddress,
        ipfsCid,
      };

      this.logger.info('Network created successfully', {
        networkId: finalManifest.networkId,
        contractAddress,
        tokenAddress,
        ipfsCid,
      });

      // Initialize reputation (starts as unverified)
      await this.scamDefenseService.initializeReputation(finalManifest.networkId);
      this.logger.info('Network reputation initialized', {
        networkId: finalManifest.networkId,
        status: 'unverified'
      });

      // Record network creation in reputation system
      await creatorReputationService.recordNetworkCreation(request.creatorAddress, finalManifest.networkId);

      return {
        networkId: finalManifest.networkId,
        manifest: finalManifest,
        deploymentStatus,
        creationFees: {
          ...creationFees,
          creatorBond: requiredBond,
          total: totalFees.toString(),
        },
      };

    } catch (error) {
      this.logger.error('Failed to create network', error);
      throw error;
    }
  }

  /**
   * Get network manifest by network ID or IPFS CID
   * CRITICAL: Uses decentralized discovery (multiple indexes, client-side verification)
   */
  async getNetworkManifest(networkIdOrCid: string, gitUrl?: string): Promise<NetworkManifest | null> {
    // If it looks like an IPFS CID, fetch directly (bypass indexes)
    if (networkIdOrCid.startsWith('Qm') || networkIdOrCid.startsWith('baf')) {
      const manifest = await this.decentralizedRegistry.fetchManifest(networkIdOrCid, gitUrl);
      if (manifest) {
        return manifest;
      }
      // Fallback to legacy service
      return await this.registryService.fetchManifestWithFallback(networkIdOrCid, gitUrl);
    }

    // Otherwise, search all indexes (decentralized discovery)
    this.logger.info('Looking up network by ID across all indexes', { networkId: networkIdOrCid });

    const discovered = await this.decentralizedRegistry.discoverNetworks();
    const network = discovered.find(n => n.networkId === networkIdOrCid);

    if (network) {
      // Fetch manifest and verify client-side
      const manifest = await this.decentralizedRegistry.fetchManifest(network.ipfsCid, network.gitUrl);
      if (manifest) {
        this.logger.info('Network found via decentralized discovery', {
          networkId: networkIdOrCid,
          foundInIndexes: network.foundInIndexes
        });
        return manifest;
      }
    }

    // Fallback to legacy registry
    const networkEntry = await this.registryService.getNetworkFromIndex(networkIdOrCid);
    if (networkEntry) {
      return await this.registryService.fetchManifestWithFallback(
        networkEntry.ipfsCid,
        networkEntry.gitUrl
      );
    }

    this.logger.warn('Network not found in any index', { networkId: networkIdOrCid });
    return null;
  }

  /**
   * List all networks from all indexes (decentralized)
   */
  async listNetworks(): Promise<string[]> {
    const discovered = await this.decentralizedRegistry.discoverNetworks();
    return discovered.map(n => n.networkId);
  }

  /**
   * Get deployment status for a network
   * FULLY IMPLEMENTED: Queries database and on-chain state for detailed network status
   */
  async getDeploymentStatus(networkId: string): Promise<NetworkDeploymentStatus | null> {
    const manifest = await this.getNetworkManifest(networkId);
    if (!manifest) {
      return null;
    }

    // Query database for detailed network statistics
    let dbStats: {
      totalTasks: number;
      activeTasks: number;
      completedTasks: number;
      totalDeposits: bigint;
      totalPayouts: bigint;
      validatorCount: number;
      minerCount: number;
    } | null = null;

    if (this.prisma) {
      try {
        // Get task statistics
        const [totalTasks, activeTasks, completedTasks] = await Promise.all([
          this.prisma.tenseuronTask.count({
            where: { networkId },
          }),
          this.prisma.tenseuronTask.count({
            where: {
              networkId,
              status: { in: ['submitted', 'mining', 'evaluating'] },
            },
          }),
          this.prisma.tenseuronTask.count({
            where: {
              networkId,
              status: 'paid',
            },
          }),
        ]);

        // Get deposit/payout statistics
        const depositResult = await this.prisma.tenseuronTask.aggregate({
          where: { networkId },
          _sum: { depositAmount: true },
        });

        const payoutResult = await this.prisma.tenseuronTask.aggregate({
          where: {
            networkId,
            status: 'paid',
          },
          _sum: { depositAmount: true },
        });

        // Get validator and miner counts (from evaluations and outputs)
        const [validatorCount, minerCount] = await Promise.all([
          this.prisma.tenseuronTaskEvaluation.groupBy({
            by: ['validatorAddress'],
            where: { task: { networkId } },
          }).then(results => results.length),
          this.prisma.tenseuronTaskOutput.groupBy({
            by: ['minerAddress'],
            where: { task: { networkId } },
          }).then(results => results.length),
        ]);

        dbStats = {
          totalTasks,
          activeTasks,
          completedTasks,
          totalDeposits: BigInt(depositResult._sum.depositAmount || '0'),
          totalPayouts: BigInt(payoutResult._sum.depositAmount || '0'),
          validatorCount,
          minerCount,
        };
      } catch (error) {
        this.logger.warn('Failed to query database for network status', {
          networkId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Query on-chain state for contract verification
    let onChainState: {
      contractDeployed: boolean;
      contractAddress: string | null;
      totalDeposits: string | null;
      totalReleased: string | null;
      validatorCount: number | null;
    } | null = null;

    if (manifest.settlement.contractAddress) {
      try {
        onChainState = await this.queryOnChainNetworkState(networkId, manifest);
      } catch (error) {
        this.logger.debug('Failed to query on-chain state (non-critical)', {
          networkId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Determine deployment status
    const contractAddress = manifest.settlement.contractAddress || onChainState?.contractAddress || null;
    const isDeployed = !!contractAddress;

    // Calculate progress based on deployment steps
    const steps: Array<{ id: string; name: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }> = [
      {
        id: 'manifest_created',
        name: 'manifest_created',
        status: manifest.registry.ipfsCid ? 'completed' : 'pending'
      },
      {
        id: 'contract_deployed',
        name: 'contract_deployed',
        status: isDeployed ? 'completed' : 'pending'
      },
      {
        id: 'token_bound',
        name: 'token_bound',
        status: manifest.settlement.tokenAddress ? 'completed' : 'pending'
      },
      {
        id: 'first_task',
        name: 'first_task',
        status: (dbStats?.totalTasks || 0) > 0 ? 'completed' : 'pending'
      },
    ];

    const progress = steps.filter(s => s.status === 'completed').length * 25; // 25% per step

    return {
      networkId: manifest.networkId,
      status: isDeployed ? 'deployed' : 'pending',
      progress,
      steps,
      contractAddress,
      tokenAddress: manifest.settlement.tokenAddress,
      ipfsCid: manifest.registry.ipfsCid,
      // Additional detailed information
      statistics: dbStats ? {
        totalTasks: dbStats.totalTasks,
        activeTasks: dbStats.activeTasks,
        completedTasks: dbStats.completedTasks,
        totalDeposits: dbStats.totalDeposits.toString(),
        totalPayouts: dbStats.totalPayouts.toString(),
        validatorCount: dbStats.validatorCount,
        minerCount: dbStats.minerCount,
      } : undefined,
      onChainState: onChainState ? {
        contractDeployed: onChainState.contractDeployed,
        totalDeposits: onChainState.totalDeposits,
        totalReleased: onChainState.totalReleased,
        validatorCount: onChainState.validatorCount,
      } : undefined,
    };
  }

  /**
   * Query on-chain network state from EscrowContract
   * FULLY IMPLEMENTED: Queries contract for detailed state
   */
  private async queryOnChainNetworkState(
    networkId: string,
    manifest: NetworkManifest
  ): Promise<{
    contractDeployed: boolean;
    contractAddress: string | null;
    totalDeposits: string | null;
    totalReleased: string | null;
    validatorCount: number | null;
  }> {
    const contractAddress = manifest.settlement.contractAddress;
    if (!contractAddress) {
      return {
        contractDeployed: false,
        contractAddress: null,
        totalDeposits: null,
        totalReleased: null,
        validatorCount: null,
      };
    }

    try {
      const provider = this.getProvider(manifest.settlement.chain);
      if (!provider) {
        throw new Error(`Provider not available for chain: ${manifest.settlement.chain}`);
      }

      // EscrowContract ABI for querying state
      const contractABI = [
        'function getValidatorCount() external view returns (uint256)',
        'function totalDeposits() external view returns (uint256)',
        'function totalReleased() external view returns (uint256)',
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);

      // Query contract state
      const [validatorCount, totalDeposits, totalReleased] = await Promise.all([
        contract.getValidatorCount().catch(() => null),
        contract.totalDeposits().catch(() => null),
        contract.totalReleased().catch(() => null),
      ]);

      return {
        contractDeployed: true,
        contractAddress,
        totalDeposits: totalDeposits ? totalDeposits.toString() : null,
        totalReleased: totalReleased ? totalReleased.toString() : null,
        validatorCount: validatorCount ? Number(validatorCount) : null,
      };
    } catch (error) {
      this.logger.error('Failed to query on-chain network state', {
        networkId,
        contractAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        contractDeployed: false,
        contractAddress,
        totalDeposits: null,
        totalReleased: null,
        validatorCount: null,
      };
    }
  }

  /**
   * Get provider for blockchain
   */
  private getProvider(chain: string): any {
    const rpcUrls: Record<string, string> = {
      ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      optimism: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    };

    const rpcUrl = rpcUrls[chain];
    if (!rpcUrl) {
      return null;
    }

    try {
      const { ethers } = require('ethers');
      return new ethers.JsonRpcProvider(rpcUrl);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if penalty configuration matches protocol defaults
   * Used to determine if penalty config fee should apply
   */
  private isDefaultPenaltyConfig(
    penaltyConfig: NetworkManifest['penaltyConfig'] | undefined,
    requiredCosts: RequiredCosts
  ): boolean {
    if (!penaltyConfig) return true;

    const defaultMechanism = requiredCosts.slashingEnabled ? 'slashing' : 'none';

    if (penaltyConfig.mechanism !== defaultMechanism) {
      return false;
    }

    if (penaltyConfig.mechanism === 'slashing' && penaltyConfig.slashing) {
      const defaultSlashing = {
        enabled: requiredCosts.slashingEnabled,
        rate: requiredCosts.slashingRate,
        minStakeRequired: '0',
        cooldownPeriod: 7 * 24 * 60 * 60, // 7 days default
      };

      if (penaltyConfig.slashing.enabled !== defaultSlashing.enabled ||
        penaltyConfig.slashing.rate !== defaultSlashing.rate ||
        penaltyConfig.slashing.minStakeRequired !== defaultSlashing.minStakeRequired ||
        penaltyConfig.slashing.cooldownPeriod !== defaultSlashing.cooldownPeriod) {
        return false;
      }
    }

    if (penaltyConfig.mechanism === 'none') {
      return true;
    }

    // Any other mechanism or config is considered custom
    if (penaltyConfig.reputation?.enabled ||
      penaltyConfig.temporaryBan?.enabled ||
      penaltyConfig.warningSystem?.enabled ||
      penaltyConfig.hybrid) {
      return false;
    }

    return true;
  }

  /**
   * Bind settlement asset to network (Flow C - Step 3)
   * Uses tokenomics from network creation if available
   */
  async bindSettlementAsset(networkId: string, binding: SettlementAssetBinding): Promise<{
    tokenAddress?: string;
    bindingTxHash?: string;
    manifest: NetworkManifest;
  }> {
    this.logger.info('Binding settlement asset to network', { networkId, bindingType: binding.bindingType });

    // Get network manifest
    const manifest = await this.getNetworkManifest(networkId);
    if (!manifest) {
      throw new Error('Network not found');
    }

    // Verify creator
    if (manifest.creatorAddress.toLowerCase() !== binding.creatorAddress.toLowerCase()) {
      throw new Error('Only the network creator can bind settlement assets');
    }

    let tokenAddress: string | undefined;
    const settlementChain = manifest.settlement.chain;

    // Handle native token binding
    if (binding.bindingType === 'native-token' && binding.nativeToken) {
      // Use tokenomics from network manifest if available, otherwise use binding data
      const tokenomics = manifest.tokenomics || {};

      const tokenConfig = {
        name: binding.nativeToken.name || `${manifest.name} Token`,
        symbol: binding.nativeToken.symbol,
        totalSupply: binding.nativeToken.totalSupply || tokenomics.totalSupply?.toString() || '10000000',
        design: binding.nativeToken.design || 'standard',
        params: {
          ...binding.nativeToken.params,
          // Merge tokenomics if available
          ...(tokenomics.initialPrice && { initialPrice: tokenomics.initialPrice }),
          ...(tokenomics.presaleAllocation && { presaleAllocation: tokenomics.presaleAllocation }),
          ...(tokenomics.liquidityAllocation && { liquidityAllocation: tokenomics.liquidityAllocation }),
          ...(tokenomics.teamAllocation && { teamAllocation: tokenomics.teamAllocation }),
          ...(tokenomics.marketingAllocation && { marketingAllocation: tokenomics.marketingAllocation }),
          ...(tokenomics.vestingPeriod && { vestingPeriod: tokenomics.vestingPeriod }),
          ...(tokenomics.lockupPeriod && { lockupPeriod: tokenomics.lockupPeriod }),
        },
      };

      this.logger.info('Deploying native token for network', { networkId, symbol: tokenConfig.symbol });
      tokenAddress = await this.settlementService.deployNetworkToken({
        networkId,
        chain: settlementChain,
        token: tokenConfig,
      });
      this.logger.info('Native token deployed', { networkId, tokenAddress });

      // Deploy creator token vesting contract and lock creator allocation
      // Use custom team address if provided, otherwise use creator address
      if (tokenomics.teamAllocation && tokenomics.teamAllocation > 0) {
        const totalSupply = BigInt(tokenConfig.totalSupply);
        const creatorAllocation = (totalSupply * BigInt(tokenomics.teamAllocation)) / BigInt(100);

        // Get team allocation address (custom or default to creator)
        const teamAddress = tokenomics.distributionAddresses?.team || manifest.creatorAddress;

        // Validate team address if provided
        if (tokenomics.distributionAddresses?.team) {
          const { ethers } = await import('ethers');
          if (!ethers.isAddress(teamAddress)) {
            throw new Error(`Invalid team allocation address: ${teamAddress}`);
          }
        }

        this.logger.info('Deploying creator token vesting contract', {
          networkId,
          creatorAllocation: creatorAllocation.toString(),
          teamAllocationPercent: tokenomics.teamAllocation,
          teamAddress
        });

        // Get graduation oracle address (protocol-controlled)
        const graduationOracle = process.env.GRADUATION_ORACLE_ADDRESS || '0x0000000000000000000000000000000000000000';

        // Deploy vesting contract for team allocation
        const vestingAddress = await this.settlementService.deployCreatorTokenVesting({
          networkId,
          creator: teamAddress, // Use team address (custom or creator)
          networkToken: tokenAddress,
          vestedAmount: creatorAllocation.toString(),
          chain: settlementChain,
          graduationOracle,
        });

        this.logger.info('Creator token vesting deployed', {
          networkId,
          vestingAddress,
          creatorAllocation: creatorAllocation.toString(),
          teamAddress
        });

        // Store vesting address temporarily for manifest update
        (manifest as any).__vestingAddress = vestingAddress;
      }

      // Validate other custom addresses if provided
      if (tokenomics.distributionAddresses) {
        const { ethers } = await import('ethers');
        const addresses = tokenomics.distributionAddresses;

        if (addresses.marketing && !ethers.isAddress(addresses.marketing)) {
          throw new Error(`Invalid marketing allocation address: ${addresses.marketing}`);
        }
        if (addresses.liquidity && !ethers.isAddress(addresses.liquidity)) {
          throw new Error(`Invalid liquidity allocation address: ${addresses.liquidity}`);
        }
        if (addresses.presale && !ethers.isAddress(addresses.presale)) {
          throw new Error(`Invalid presale allocation address: ${addresses.presale}`);
        }
      }
    } else if (binding.bindingType === 'existing-token' && binding.existingToken) {
      tokenAddress = binding.existingToken.tokenAddress;
      this.logger.info('Binding existing token', { networkId, tokenAddress, chain: binding.existingToken.chain });
    } else if (binding.bindingType === 'credit-based') {
      this.logger.info('Binding credit-based settlement', { networkId });
      // No token address for credit-based
    } else if (binding.bindingType === 'hybrid') {
      throw new Error('Hybrid binding not yet supported');
    }

    // Update manifest with binding
    let updatedManifest = NetworkManifestGenerator.updateManifestWithSettlementAsset(
      manifest,
      {
        bindingType: binding.bindingType,
        tokenAddress,
        boundAt: new Date().toISOString(),
        bindingTxHash: binding.bindingTxHash,
      }
    );

    // Add creator token vesting info if native token was deployed
    if (binding.bindingType === 'native-token' && tokenAddress && manifest.tokenomics?.teamAllocation) {
      const totalSupply = BigInt(binding.nativeToken?.totalSupply || manifest.tokenomics.totalSupply?.toString() || '10000000');
      const creatorAllocation = (totalSupply * BigInt(manifest.tokenomics.teamAllocation)) / BigInt(100);

      // Get vesting address from the deployment above (stored temporarily)
      const vestingAddress = (manifest as any).__vestingAddress;

      if (vestingAddress) {
        updatedManifest.creatorTokenVesting = {
          contractAddress: vestingAddress,
          totalVested: creatorAllocation.toString(),
          unlockedAmount: '0', // Start at 0% (Sandbox level)
        };
        delete (manifest as any).__vestingAddress; // Clean up temp field
      }
    }

    // Re-upload to IPFS
    const newIpfsCid = await this.decentralizedRegistry.uploadManifest(updatedManifest);
    const finalManifest = NetworkManifestGenerator.updateManifestWithDeployment(
      updatedManifest,
      updatedManifest.settlement.contractAddress,
      updatedManifest.settlement.tokenAddress,
      newIpfsCid
    );

    // Update local index
    await this.decentralizedRegistry.registerNetworkInLocalIndex(finalManifest);

    this.logger.info('Settlement asset bound successfully', { networkId, bindingType: binding.bindingType, tokenAddress });

    return {
      tokenAddress,
      bindingTxHash: binding.bindingTxHash,
      manifest: finalManifest,
    };
  }
}
