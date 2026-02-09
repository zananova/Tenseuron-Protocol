/**
 * Refactored Protocol Service
 * 
 * Core orchestration service for Tenseuron Protocol with dependency injection
 * Uses interface-based architecture for database-agnostic and runtime-agnostic operation
 */

import { ILogger } from './utils/ILogger';
import {
    NetworkManifest,
    NetworkCreationRequest,
    NetworkDeploymentStatus,
    SupportedChain,
} from './types';
import { NetworkManifestGenerator } from './NetworkManifestGenerator';
import { DecentralizedRegistryService } from './DecentralizedRegistryService';
import { SettlementService } from './SettlementService';
import { ScamDefenseService } from './ScamDefenseService';
import { RiskScoringService, RiskParameters } from './RiskScoringService';
import { MoneyFlowService } from './MoneyFlowService';
import { PenaltyConfigValidator } from './PenaltyConfigValidator';
import {
    INetworkRepository,
    ITaskRepository,
    IValidatorRepository,
    IStorageProvider,
    IBlockchainProvider,
    IAIModuleRepository,
    ICreatorReputationService,
} from './interfaces';

export interface ProtocolServiceDependencies {
    // Core repositories (database-agnostic)
    networkRepo: INetworkRepository;
    taskRepo?: ITaskRepository;
    validatorRepo?: IValidatorRepository;
    aiModuleRepo: IAIModuleRepository;
    creatorReputationService: ICreatorReputationService;

    // Storage and blockchain providers
    storage: IStorageProvider;
    blockchain: IBlockchainProvider;

    // Other services
    decentralizedRegistry: DecentralizedRegistryService;
    settlementService: SettlementService;
    scamDefenseService: ScamDefenseService;
    riskScoringService: RiskScoringService;
    moneyFlowService: MoneyFlowService;
}

export class ProtocolServiceRefactored {
    private logger: ILogger;
    private networkRepo: INetworkRepository;
    private taskRepo?: ITaskRepository;
    private validatorRepo?: IValidatorRepository;
    private aiModuleRepo: IAIModuleRepository;
    private creatorReputationService: ICreatorReputationService;
    private storage: IStorageProvider;
    private blockchain: IBlockchainProvider;
    private decentralizedRegistry: DecentralizedRegistryService;
    private settlementService: SettlementService;
    private scamDefenseService: ScamDefenseService;
    private riskScoringService: RiskScoringService;
    private moneyFlowService: MoneyFlowService;

    constructor(logger: ILogger, dependencies: ProtocolServiceDependencies) {
        this.logger = logger;
        this.networkRepo = dependencies.networkRepo;
        this.taskRepo = dependencies.taskRepo;
        this.validatorRepo = dependencies.validatorRepo;
        this.aiModuleRepo = dependencies.aiModuleRepo;
        this.creatorReputationService = dependencies.creatorReputationService;
        this.storage = dependencies.storage;
        this.blockchain = dependencies.blockchain;
        this.decentralizedRegistry = dependencies.decentralizedRegistry;
        this.settlementService = dependencies.settlementService;
        this.scamDefenseService = dependencies.scamDefenseService;
        this.riskScoringService = dependencies.riskScoringService;
        this.moneyFlowService = dependencies.moneyFlowService;
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
        this.logger.info('Creating new AI Network', {
            name: request.name,
            moduleId: request.moduleId,
        });

        try {
            // Step 1: Load AI Module and pre-fill schemas
            const module = await this.aiModuleRepo.getModuleById(request.moduleId);
            if (!module) {
                throw new Error(`AI Module not found: ${request.moduleId}`);
            }

            if (!module.isActive) {
                throw new Error(`AI Module is not active: ${request.moduleId}`);
            }

            this.logger.info('AI Module loaded', {
                moduleId: module.moduleId,
                name: module.name,
                category: module.category,
            });

            // Pre-fill task schemas from module
            const taskInputSchema = request.taskInputSchema || module.taskInputSchema;
            const taskOutputSchema = request.taskOutputSchema || module.taskOutputSchema;
            const taskTimeout = request.taskTimeout || module.taskTimeout;
            const scoringType = request.scoringType || (module.scoringType as any);
            const scoringModuleHash = request.scoringModuleHash || module.scoringModuleHash || '';
            const scoringModuleUrl = request.scoringModuleUrl || module.scoringModuleUrl || '';
            const evaluationMode = request.evaluationMode || module.evaluationMode;

            // Step 2: Calculate risk score and required costs
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

            // Step 3: Check creator reputation
            const creationCheck = await this.creatorReputationService.canCreateNetwork(
                request.creatorAddress
            );
            if (!creationCheck.allowed) {
                throw new Error(`Network creation not allowed: ${creationCheck.reason}`);
            }

            const reputation = await this.creatorReputationService.getCreatorReputation(
                request.creatorAddress
            );

            // Step 4: Validate inputs
            const { InputValidator } = await import('./InputValidator');
            const inputValidator = new InputValidator(this.logger);
            const inputValidation = await inputValidator.validateNetworkCreationRequest(request);

            if (!inputValidation.valid) {
                throw new Error(`Invalid network creation request: ${inputValidation.errors.join(', ')}`);
            }

            // Step 5: Calculate risk and costs
            const riskScore = this.riskScoringService.calculateRiskScore(riskParams);
            const baseRequiredCosts = this.riskScoringService.calculateRequiredCosts(
                riskScore,
                request.riskParameters.maxPayoutPerTask,
                false
            );

            // Validate penalty configuration
            if (request.penaltyConfig) {
                const penaltyValidator = new PenaltyConfigValidator(this.logger);
                const penaltyValidation = penaltyValidator.validate(request.penaltyConfig);
                if (!penaltyValidation.valid) {
                    throw new Error(
                        `Invalid penalty configuration: ${penaltyValidation.errors.join(', ')}`
                    );
                }
            }

            const hasCustomPenaltyConfig =
                request.penaltyConfig &&
                request.penaltyConfig.mechanism !== 'none' &&
                !this.isDefaultPenaltyConfig(request.penaltyConfig, baseRequiredCosts);

            const requiredCosts = this.riskScoringService.calculateRequiredCosts(
                riskScore,
                request.riskParameters.maxPayoutPerTask,
                hasCustomPenaltyConfig
            );

            // Step 6: Validate money flow
            const moneyFlowValidation = this.moneyFlowService.validateMoneyFlowConfig(
                request.moneyFlow
            );
            if (!moneyFlowValidation.valid) {
                throw new Error(
                    `Invalid money flow configuration: ${moneyFlowValidation.errors.join(', ')}`
                );
            }

            // Step 7: Determine settlement chain
            const settlementChain: SupportedChain = request.token ? 'polygon' : 'polygon';

            // Step 8: Calculate creation fees
            const creationFees = this.scamDefenseService.calculateCreationFees(
                settlementChain,
                requiredCosts
            );

            const estimatedNetworkValue = parseFloat(requiredCosts.requiredStake) * 10;
            const requiredBond = await this.creatorReputationService.calculateRequiredBond(
                request.creatorAddress,
                estimatedNetworkValue.toString(),
                0.01
            );

            const totalFees = parseFloat(creationFees.total) + parseFloat(requiredBond);

            // Step 9: Generate network manifest
            const manifestRequest = {
                ...request,
                moduleId: request.moduleId,
                taskInputSchema,
                taskOutputSchema,
                taskTimeout,
                scoringType,
                scoringModuleHash,
                scoringModuleUrl,
                evaluationMode,
                settlementChain,
            };
            const manifest = NetworkManifestGenerator.generateManifest(manifestRequest, module);

            manifest.riskAssessment = {
                totalRisk: riskScore.totalRisk,
                riskCategory: riskScore.riskCategory,
                requiredCosts: requiredCosts,
            };

            const validation = NetworkManifestGenerator.validateManifest(manifest);
            if (!validation.valid) {
                throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
            }

            // Step 10: Deploy network token (if applicable)
            let tokenAddress: string | undefined;
            let contractAddress: string | undefined;

            const isEarnOnlyToken = request.token?.design === 'earn-only';

            if (request.token && !isEarnOnlyToken) {
                this.logger.info('Deploying network token', {
                    networkId: manifest.networkId,
                    chain: settlementChain,
                });

                tokenAddress = await this.settlementService.deployNetworkToken({
                    networkId: manifest.networkId,
                    chain: settlementChain,
                    token: request.token,
                });

                this.logger.info('Network token deployed', {
                    networkId: manifest.networkId,
                    tokenAddress,
                });
            }

            // Step 11: Deploy settlement contract
            if (request.settlementMode === 'escrow') {
                this.logger.info('Deploying escrow contract', {
                    networkId: manifest.networkId,
                    chain: settlementChain,
                });

                contractAddress = await this.settlementService.deployEscrowContract({
                    networkId: manifest.networkId,
                    chain: settlementChain,
                    disputeWindow: request.disputeWindow,
                    minValidators: request.minValidators,
                    consensusThreshold: Math.round(request.consensusThreshold * 10000),
                    networkToken: tokenAddress || undefined,
                    validatorRegistry: undefined,
                    challengeOracle: request.oracleAddress || undefined,
                    creatorAddress: request.creatorAddress,
                    purposeBoundSinks: this.moneyFlowService.getPurposeBoundSinksAddress(),
                    usageCutEnabled: request.moneyFlow.usageCut.enabled,
                    usageCutPercentage: request.moneyFlow.usageCut.percentage * 100,
                    usageCutMin: request.moneyFlow.usageCut.minCut,
                    usageCutMax: request.moneyFlow.usageCut.maxCut,
                    validatorPaymentEnabled: request.moneyFlow.validatorPayment.enabled,
                    validatorPaymentPercentage: request.moneyFlow.validatorPayment.percentage * 100,
                    validatorPaymentMin: request.moneyFlow.validatorPayment.minPayment,
                    validatorPaymentMax: request.moneyFlow.validatorPayment.maxPayment,
                    penaltyConfig: request.penaltyConfig || {
                        mechanism: requiredCosts.slashingEnabled ? 'slashing' : 'none',
                        slashing: requiredCosts.slashingEnabled
                            ? {
                                enabled: true,
                                rate: requiredCosts.slashingRate,
                                minStakeRequired: request.stakeRequired || '0',
                                cooldownPeriod: 7 * 24 * 60 * 60,
                            }
                            : undefined,
                    },
                });

                this.logger.info('Escrow contract deployed', {
                    networkId: manifest.networkId,
                    contractAddress,
                });
            }

            // Step 12: Update manifest with deployment results
            const updatedManifest = NetworkManifestGenerator.updateManifestWithDeployment(
                manifest,
                contractAddress,
                tokenAddress
            );

            // Step 13: Upload manifest to storage (IPFS/R2/etc)
            const manifestCid = await this.storage.upload(updatedManifest, {
                name: `network-${updatedManifest.networkId}.json`,
                type: 'application/json',
            });

            const finalManifest = NetworkManifestGenerator.updateManifestWithDeployment(
                updatedManifest,
                contractAddress,
                tokenAddress,
                manifestCid
            );

            this.logger.info('Network manifest uploaded to storage', {
                networkId: finalManifest.networkId,
                manifestCid,
                storageType: this.storage.getType(),
            });

            // Step 14: Register network in local index
            await this.decentralizedRegistry.registerNetworkInLocalIndex(finalManifest);

            // Step 15: Store network in database using abstraction layer
            await this.networkRepo.create({
                networkId: finalManifest.networkId,
                name: finalManifest.name,
                description: finalManifest.description,
                category: finalManifest.category,
                creatorAddress: finalManifest.creatorAddress,
                manifestCid,
                contractAddress,
                validatorRegistryAddress: undefined,
                settlementChain,
                status: 'deployed',
                moduleId: request.moduleId,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            this.logger.info('Network stored in database', {
                networkId: finalManifest.networkId,
                databaseType: 'abstraction-layer',
            });

            // Step 16: Create deployment status
            const deploymentStatus: NetworkDeploymentStatus = {
                networkId: finalManifest.networkId,
                status: 'deployed',
                progress: 100,
                steps: [
                    { id: 'manifest', name: 'Generate Manifest', status: 'completed' },
                    {
                        id: 'contract',
                        name: 'Deploy Settlement Contract',
                        status: contractAddress ? 'completed' : 'pending',
                    },
                    {
                        id: 'token',
                        name: 'Deploy Network Token',
                        status: tokenAddress ? 'completed' : 'pending',
                    },
                    { id: 'storage', name: 'Upload to Storage', status: 'completed' },
                    { id: 'registry', name: 'Register Network', status: 'completed' },
                    { id: 'database', name: 'Store in Database', status: 'completed' },
                ],
                contractAddress,
                tokenAddress,
                ipfsCid: manifestCid,
            };

            // Step 17: Initialize reputation
            await this.scamDefenseService.initializeReputation(finalManifest.networkId);
            await this.creatorReputationService.recordNetworkCreation(
                request.creatorAddress,
                finalManifest.networkId
            );

            this.logger.info('Network created successfully', {
                networkId: finalManifest.networkId,
                contractAddress,
                tokenAddress,
                manifestCid,
            });



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
     * Get network manifest by network ID or storage CID
     */
    async getNetworkManifest(networkIdOrCid: string): Promise<NetworkManifest | null> {
        // If it looks like a CID, fetch directly from storage
        if (networkIdOrCid.startsWith('Qm') || networkIdOrCid.startsWith('baf')) {
            try {
                const manifest = await this.storage.download(networkIdOrCid);
                return manifest as NetworkManifest;
            } catch (error) {
                this.logger.warn('Failed to fetch manifest from storage', { cid: networkIdOrCid, error });
            }
        }

        // Otherwise, look up in database
        const network = await this.networkRepo.findById(networkIdOrCid);
        if (!network || !network.manifestCid) {
            this.logger.warn('Network not found in database', { networkId: networkIdOrCid });
            return null;
        }

        // Fetch manifest from storage
        try {
            const manifest = await this.storage.download(network.manifestCid);
            return manifest as NetworkManifest;
        } catch (error) {
            this.logger.error('Failed to fetch manifest from storage', {
                networkId: networkIdOrCid,
                manifestCid: network.manifestCid,
                error,
            });
            return null;
        }
    }

    /**
     * List all networks
     */
    async listNetworks(filters?: {
        status?: 'pending' | 'deploying' | 'deployed' | 'active' | 'graduated';
        category?: string;
        limit?: number;
        offset?: number;
    }): Promise<string[]> {
        const networks = await this.networkRepo.list(filters);
        return networks.map((n) => n.networkId);
    }

    /**
     * Get deployment status for a network
     */
    async getDeploymentStatus(networkId: string): Promise<NetworkDeploymentStatus | null> {
        const network = await this.networkRepo.findById(networkId);
        if (!network) {
            return null;
        }

        // Get task statistics if task repository is available
        let taskStats = {
            totalTasks: 0,
            activeTasks: 0,
            completedTasks: 0,
        };

        if (this.taskRepo) {
            try {
                const allTasks = await this.taskRepo.findByNetwork(networkId);
                taskStats = {
                    totalTasks: allTasks.length,
                    activeTasks: allTasks.filter((t) =>
                        ['submitted', 'mining', 'evaluating'].includes(t.status)
                    ).length,
                    completedTasks: allTasks.filter((t) => t.status === 'paid').length,
                };
            } catch (error) {
                this.logger.warn('Failed to get task statistics', { networkId, error });
            }
        }

        return {
            networkId: network.networkId,
            status: network.status,
            progress: network.status === 'deployed' ? 100 : 50,
            steps: [
                { id: 'manifest', name: 'Generate Manifest', status: 'completed' },
                {
                    id: 'contract',
                    name: 'Deploy Settlement Contract',
                    status: network.contractAddress ? 'completed' : 'pending',
                },
                { id: 'storage', name: 'Upload to Storage', status: 'completed' },
                { id: 'registry', name: 'Register Network', status: 'completed' },
            ],
            contractAddress: network.contractAddress,
            ipfsCid: network.manifestCid,
            taskStats,
        };
    }

    /**
     * Helper: Check if penalty config is default
     */
    private isDefaultPenaltyConfig(config: any, costs: any): boolean {
        if (config.mechanism === 'slashing' && costs.slashingEnabled) {
            return config.slashing?.rate === costs.slashingRate;
        }
        return config.mechanism === 'none' && !costs.slashingEnabled;
    }
}
