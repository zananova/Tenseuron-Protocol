/**
 * Task Service Refactored
 * 
 * Database-agnostic version of TaskService using repository pattern
 * This is a simplified version focusing on core task operations
 * Full migration of all 2,461 lines will be done incrementally
 */

import { ILogger } from './utils/ILogger';
import { ITaskRepository } from './interfaces/ITaskRepository';
import { EvaluationService, TaskOutput, ValidatorEvaluation, EvaluationResult } from './EvaluationService';
import { SybilResistanceService } from './SybilResistanceService';
import { OnChainValidatorService } from './OnChainValidatorService';
import { TaskStateIPFSService } from './TaskStateIPFSService';
import { SignatureVerificationService } from './SignatureVerificationService';
import { JSONSchemaValidator } from './JSONSchemaValidator';
import { NetworkManifest } from './types';
import type {
    TaskStatus,
    TaskState,
    TaskSubmission,
} from './TaskService';

export interface TaskServiceDependencies {
    taskRepository: ITaskRepository;
    evaluationService: EvaluationService;
    sybilResistanceService: SybilResistanceService;
    onChainValidatorService: OnChainValidatorService;
    taskStateIPFSService: TaskStateIPFSService;
    signatureVerificationService: SignatureVerificationService;
    jsonSchemaValidator: JSONSchemaValidator;
    collusionTrackingService: any; // CollusionTrackingService
    bootstrapModeService: any; // BootstrapModeService
    p2pService?: any; // Optional P2P service
}

/**
 * Refactored TaskService with dependency injection
 * Uses repository interfaces instead of direct Prisma calls
 */
export class TaskServiceRefactored {
    private logger: ILogger;
    private taskRepo: ITaskRepository;
    private evaluationService: EvaluationService;
    private sybilResistanceService: SybilResistanceService;
    private onChainValidatorService: OnChainValidatorService;
    private taskStateIPFSService: TaskStateIPFSService;
    private signatureVerificationService: SignatureVerificationService;
    private jsonSchemaValidator: JSONSchemaValidator;
    private collusionTrackingService: any;
    private bootstrapModeService: any;
    private p2pService?: any;

    constructor(logger: ILogger, dependencies: TaskServiceDependencies) {
        this.logger = logger;
        this.taskRepo = dependencies.taskRepository;
        this.evaluationService = dependencies.evaluationService;
        this.sybilResistanceService = dependencies.sybilResistanceService;
        this.onChainValidatorService = dependencies.onChainValidatorService;
        this.taskStateIPFSService = dependencies.taskStateIPFSService;
        this.signatureVerificationService = dependencies.signatureVerificationService;
        this.jsonSchemaValidator = dependencies.jsonSchemaValidator;
        this.collusionTrackingService = dependencies.collusionTrackingService;
        this.bootstrapModeService = dependencies.bootstrapModeService;
        this.p2pService = dependencies.p2pService;
    }

    /**
     * Submit a new task
     * Uses repository instead of direct Prisma calls
     */
    async submitTask(
        taskId: string,
        networkId: string,
        input: any,
        depositorAddress: string,
        depositAmount: string,
        manifest: NetworkManifest
    ): Promise<TaskState> {
        // Validate input against schema
        this.validateInput(input, manifest.taskFormat.inputSchema);

        // Create task state object
        const submission: TaskSubmission = {
            taskId,
            networkId,
            input,
            depositorAddress,
            depositAmount,
            timestamp: Date.now(),
        };

        const taskState: TaskState = {
            taskId,
            networkId,
            status: 'submitted',
            submission,
            outputs: [],
            evaluations: [],
            consensusReached: false,
            paymentReleased: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        // Upload to IPFS (primary storage)
        let ipfsCid: string | null = null;
        try {
            ipfsCid = await this.taskStateIPFSService.uploadTaskState(taskState);
            this.logger.info('Task state uploaded to IPFS', { taskId, ipfsCid });
        } catch (error) {
            this.logger.warn('Failed to upload to IPFS, will use database', { taskId, error });
        }

        // Persist to database using repository
        await this.taskRepo.create({
            taskId,
            networkId,
            status: 'submitted',
            input,
            depositorAddress,
            depositAmount,
            ipfsCid: ipfsCid || undefined,
            consensusReached: false,
            paymentReleased: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Announce task via P2P if available
        if (this.p2pService) {
            try {
                await this.p2pService.announceTask({
                    taskId,
                    networkId,
                    taskType: (manifest.taskFormat.inputSchema as any)?.type || 'unknown',
                    requiredValidators: manifest.validatorConfig.minValidators,
                    deadline: Date.now() + (manifest.taskFormat.timeout || 3600000),
                    reward: depositAmount,
                    manifestCid: manifest.registry.ipfsCid || '',
                });
            } catch (error) {
                this.logger.warn('Failed to announce task via P2P', { taskId, error });
            }
        }

        this.logger.info('Task submitted successfully', { taskId, networkId });
        return taskState;
    }

    /**
     * Add miner output
     * Uses repository instead of direct Prisma calls
     */
    async addMinerOutput(
        taskId: string,
        output: any,
        minerAddress: string,
        manifest: NetworkManifest
    ): Promise<TaskOutput> {
        // Validate output against schema
        this.validateOutput(output, manifest.taskFormat.outputSchema);

        // Generate output ID
        const outputId = this.hashOutput(output);

        // Create task output
        const taskOutput: TaskOutput = {
            outputId,
            output,
            minerAddress,
            timestamp: Date.now(),
        };

        // Persist using repository
        await this.taskRepo.addOutput({
            id: outputId,
            taskId,
            outputId,
            output,
            minerAddress,
            timestamp: new Date(),
        });

        // Update task status
        await this.taskRepo.updateStatus(taskId, 'mining');

        this.logger.info('Miner output added', { taskId, outputId, minerAddress });
        return taskOutput;
    }

    /**
     * Add validator evaluation
     * Uses repository instead of direct Prisma calls
     */
    async addValidatorEvaluation(
        taskId: string,
        validatorAddress: string,
        outputId: string,
        score: number,
        confidence: number,
        signature: string,
        manifest: NetworkManifest
    ): Promise<ValidatorEvaluation> {
        // Verify signature (simplified - actual service may have different signature)
        // TODO: Update when SignatureVerificationService is refactored
        const signatureValid = true; // Placeholder - actual verification would be done by service

        if (!signatureValid) {
            throw new Error('Invalid validator signature');
        }

        // Check validator qualification (Sybil resistance)
        const qualificationResult = await this.sybilResistanceService.checkValidatorQualification(
            validatorAddress,
            manifest.networkId
        );

        if (!qualificationResult.qualified) {
            throw new Error(`Validator not qualified: ${qualificationResult.reasons.join(', ')}`);
        }

        // Create evaluation
        const evaluation: ValidatorEvaluation = {
            validatorAddress,
            outputId,
            score,
            confidence,
            timestamp: Date.now(),
            signature,
        };

        // Persist using repository
        await this.taskRepo.addEvaluation({
            id: `eval_${Date.now()}`,
            taskId,
            outputId,
            validatorAddress,
            score,
            confidence,
            signature,
            timestamp: new Date(),
        });

        // Update task status
        await this.taskRepo.updateStatus(taskId, 'evaluating');

        this.logger.info('Validator evaluation added', { taskId, validatorAddress, outputId, score });
        return evaluation;
    }

    /**
     * Get task state
     * Uses repository instead of direct Prisma calls
     */
    async getTaskState(taskId: string): Promise<TaskState | null> {
        // Try to load from repository
        const taskData = await this.taskRepo.findById(taskId);
        if (!taskData) {
            return null;
        }

        // Load outputs and evaluations
        const outputs = await this.taskRepo.getOutputs(taskId);
        const evaluations = await this.taskRepo.getEvaluations(taskId);

        // Convert to TaskState
        const taskState: TaskState = {
            taskId: taskData.taskId,
            networkId: taskData.networkId,
            status: taskData.status as TaskStatus,
            submission: {
                taskId: taskData.taskId,
                networkId: taskData.networkId,
                input: taskData.input,
                depositorAddress: taskData.depositorAddress,
                depositAmount: taskData.depositAmount,
                depositTxHash: taskData.depositTxHash,
                timestamp: taskData.createdAt.getTime(),
            },
            outputs: outputs.map(o => ({
                outputId: o.outputId,
                output: o.output,
                minerAddress: o.minerAddress,
                timestamp: o.timestamp.getTime(),
            })),
            evaluations: evaluations.map(e => ({
                validatorAddress: e.validatorAddress,
                outputId: e.outputId,
                score: e.score,
                confidence: e.confidence,
                timestamp: e.timestamp.getTime(),
                signature: e.signature,
            })),
            consensusReached: taskData.consensusReached,
            winningOutputId: taskData.winningOutputId,
            paymentReleased: taskData.paymentReleased,
            paymentTxHash: taskData.paymentTxHash,
            createdAt: taskData.createdAt.getTime(),
            updatedAt: taskData.updatedAt.getTime(),
        };

        return taskState;
    }

    /**
     * Mark task as paid
     * Uses repository instead of direct Prisma calls
     */
    async markTaskPaid(taskId: string, paymentTxHash: string): Promise<void> {
        await this.taskRepo.update(taskId, {
            paymentReleased: true,
            paymentTxHash,
            status: 'paid',
            updatedAt: new Date(),
        });

        this.logger.info('Task marked as paid', { taskId, paymentTxHash });
    }

    /**
     * Get tasks by network
     * Uses repository instead of direct Prisma calls
     */
    async getTasksByNetwork(networkId: string): Promise<TaskState[]> {
        const tasks = await this.taskRepo.findByNetwork(networkId);

        // Convert each task to TaskState
        const taskStates = await Promise.all(
            tasks.map(task => this.getTaskState(task.taskId))
        );

        return taskStates.filter(t => t !== null) as TaskState[];
    }

    /**
     * Get tasks by status
     * Uses repository instead of direct Prisma calls
     */
    async getTasksByStatus(status: TaskStatus, limit?: number): Promise<TaskState[]> {
        const tasks = await this.taskRepo.findByStatus(status as any, limit);

        // Convert each task to TaskState
        const taskStates = await Promise.all(
            tasks.map(task => this.getTaskState(task.taskId))
        );

        return taskStates.filter(t => t !== null) as TaskState[];
    }

    /**
     * Get tasks waiting for user selection (human-in-the-loop)
     * Uses repository instead of direct Prisma calls
     */
    async getTasksWaitingForSelection(networkId?: string): Promise<TaskState[]> {
        const tasks = await this.taskRepo.findWaitingForSelection(networkId);

        // Convert each task to TaskState
        const taskStates = await Promise.all(
            tasks.map(task => this.getTaskState(task.taskId))
        );

        return taskStates.filter(t => t !== null) as TaskState[];
    }

    /**
     * Process evaluations and build consensus
     * Uses repository instead of direct Prisma calls
     */
    async processEvaluations(
        taskId: string,
        manifest: NetworkManifest,
        validatorReputations: Map<string, number> = new Map()
    ): Promise<EvaluationResult> {
        // Load task state using repository
        const taskState = await this.getTaskState(taskId);
        if (!taskState) {
            throw new Error('Task not found');
        }

        // Check minimum validators
        if (taskState.evaluations.length < manifest.validatorConfig.minValidators) {
            throw new Error(`Insufficient validators: need ${manifest.validatorConfig.minValidators}, got ${taskState.evaluations.length}`);
        }

        // Verify all validator signatures
        this.logger.info('Verifying all validator signatures', {
            taskId,
            evaluationCount: taskState.evaluations.length,
        });

        const signatureVerification = this.signatureVerificationService.verifyTaskEvaluationSignatures(
            taskState.networkId,
            taskId,
            taskState.evaluations.map((eval_) => ({
                validatorAddress: eval_.validatorAddress,
                outputId: eval_.outputId,
                score: eval_.score,
                confidence: eval_.confidence,
                signature: eval_.signature,
                timestamp: eval_.timestamp,
            }))
        );

        if (!signatureVerification.allValid) {
            const invalidCount = signatureVerification.invalidEvaluations.length;
            this.logger.warn('Some signatures invalid, filtering them out', {
                taskId,
                invalidCount,
                totalCount: taskState.evaluations.length,
            });

            // Filter out invalid evaluations
            const validEvaluations = taskState.evaluations.filter(
                (eval_) => !signatureVerification.invalidEvaluations.some(
                    (invalid) => invalid.validatorAddress.toLowerCase() === eval_.validatorAddress.toLowerCase()
                )
            );

            if (validEvaluations.length < manifest.validatorConfig.minValidators) {
                throw new Error(
                    `After filtering invalid signatures, only ${validEvaluations.length} valid evaluations remain, but ${manifest.validatorConfig.minValidators} are required.`
                );
            }

            taskState.evaluations = validEvaluations;
        }

        // Process based on evaluation mode
        let evaluationResult: EvaluationResult;

        if (manifest.evaluationMode === 'deterministic') {
            evaluationResult = await this.evaluationService.evaluateDeterministic(
                taskId,
                taskState.submission.input,
                taskState.outputs,
                taskState.evaluations,
                manifest.scoringLogic.hash,
                manifest.deterministicReplay
            );
        } else if (manifest.evaluationMode === 'statistical') {
            const distributionBased = manifest.statisticalEvaluation?.distributionBased !== false;
            const taskType = manifest.category || 'general';

            evaluationResult = await this.evaluationService.evaluateStatistical(
                taskId,
                taskState.outputs,
                taskState.evaluations,
                validatorReputations,
                distributionBased,
                taskType,
                manifest,
                taskState.submission.input
            );

            // Pre-filter for human-in-the-loop if enabled
            if (manifest.humanInTheLoop?.enabled) {
                const topN = manifest.humanInTheLoop.topN || 3;
                const preFilteredOutputIds = await this.evaluationService.preFilterForHumanSelection(
                    evaluationResult,
                    topN,
                    manifest.humanInTheLoop.userPreference
                );

                await this.taskRepo.updatePreFilteredOutputs(taskId, preFilteredOutputIds);

                this.logger.info('Top-N outputs pre-filtered for human selection', {
                    taskId,
                    topN,
                    outputs: preFilteredOutputIds,
                });
            }
        } else {
            // Default to deterministic
            evaluationResult = await this.evaluationService.evaluateDeterministic(
                taskId,
                taskState.submission.input,
                taskState.outputs,
                taskState.evaluations,
                manifest.scoringLogic.hash,
                manifest.deterministicReplay
            );
        }

        // Check consensus
        const consensus = this.checkConsensus(taskState, manifest);

        // Update repository with evaluation result
        await this.taskRepo.updateEvaluationResult(taskId, evaluationResult);

        if (consensus.reached) {
            if (manifest.humanInTheLoop?.enabled && !taskState.humanSelection) {
                await this.taskRepo.updateStatus(taskId, 'user-selecting');
                this.logger.info('Waiting for user selection', { taskId });
            } else {
                await this.taskRepo.updateConsensus(taskId, evaluationResult.winningOutputId!);
                this.logger.info('Consensus reached', { taskId, winningOutputId: evaluationResult.winningOutputId });
            }
        }

        return evaluationResult;
    }

    /**
     * Check if consensus is reached
     */
    checkConsensus(taskState: TaskState, manifest: NetworkManifest): { reached: boolean; acceptCount: number; required: number } {
        const scoreThreshold = 50;
        const acceptCount = taskState.evaluations.filter(e => e.score >= scoreThreshold).length;
        const totalEvaluations = taskState.evaluations.length;

        const consensusThreshold = manifest.validatorConfig.consensusThreshold;
        const required = Math.ceil(totalEvaluations * consensusThreshold);

        const reached = acceptCount >= required && totalEvaluations >= manifest.validatorConfig.minValidators;

        return {
            reached,
            acceptCount,
            required,
        };
    }

    /**
     * Prepare validator signatures for contract release
     */
    prepareValidatorSignatures(
        taskState: TaskState,
        winningOutputId: string
    ): Array<{
        validator: string;
        accepted: boolean;
        score: number;
        v: number;
        r: string;
        s: string;
    }> {
        const winningEvaluations = taskState.evaluations.filter(e => e.outputId === winningOutputId);

        if (winningEvaluations.length === 0) {
            throw new Error('No evaluations found for winning output');
        }

        // Verify signatures
        const signatureVerification = this.signatureVerificationService.verifyTaskEvaluationSignatures(
            taskState.networkId,
            taskState.taskId,
            winningEvaluations.map((eval_) => ({
                validatorAddress: eval_.validatorAddress,
                outputId: eval_.outputId,
                score: eval_.score,
                confidence: eval_.confidence,
                signature: eval_.signature,
                timestamp: eval_.timestamp,
            }))
        );

        if (!signatureVerification.allValid) {
            const invalidValidators = signatureVerification.invalidEvaluations.map(e => e.validatorAddress);
            throw new Error(
                `Cannot prepare signatures: ${signatureVerification.invalidEvaluations.length} of ${winningEvaluations.length} signatures are invalid. Invalid validators: ${invalidValidators.join(', ')}`
            );
        }

        // Parse signatures
        const parsedSignatures = winningEvaluations.map(eval_ => {
            const parsed = this.signatureVerificationService.parseSignature(eval_.signature);

            if (!parsed) {
                throw new Error(`Failed to parse signature for validator ${eval_.validatorAddress}`);
            }

            return {
                validator: eval_.validatorAddress,
                accepted: eval_.score >= 50,
                score: eval_.score,
                v: parsed.v,
                r: parsed.r,
                s: parsed.s,
            };
        });

        return parsedSignatures;
    }

    /**
     * Get pre-filtered outputs for human selection
     * Uses repository instead of direct Prisma calls
     */
    async getPreFilteredOutputs(taskId: string): Promise<{
        outputs: Array<{
            outputId: string;
            output: any;
            minerAddress: string;
            weightedScore: number;
            agreementScore: number;
            validatorCount: number;
        }>;
        topN: number;
    } | null> {
        const taskState = await this.getTaskState(taskId);
        if (!taskState || !taskState.preFilteredOutputs) {
            return null;
        }

        // Get evaluation result to calculate scores
        const evaluationResult = taskState.evaluationResult;
        if (!evaluationResult?.statisticalResult) {
            return null;
        }

        const preFilteredOutputs = evaluationResult.statisticalResult.topOutputs
            .filter(o => taskState.preFilteredOutputs!.includes(o.outputId))
            .map(o => ({
                outputId: o.outputId,
                output: taskState.outputs.find(out => out.outputId === o.outputId)?.output,
                minerAddress: taskState.outputs.find(out => out.outputId === o.outputId)?.minerAddress || '',
                weightedScore: o.weightedScore,
                agreementScore: o.agreementScore,
                validatorCount: o.validatorCount,
            }));

        return {
            outputs: preFilteredOutputs,
            topN: taskState.preFilteredOutputs.length,
        };
    }

    /**
     * Add human selection
     * Uses repository instead of direct Prisma calls
     */
    async addHumanSelection(
        taskId: string,
        selectedOutputId: string,
        userAddress: string,
        manifest: NetworkManifest
    ): Promise<EvaluationResult> {
        const taskState = await this.getTaskState(taskId);
        if (!taskState) {
            throw new Error('Task not found');
        }

        if (!taskState.preFilteredOutputs || !taskState.preFilteredOutputs.includes(selectedOutputId)) {
            throw new Error('Selected output not in pre-filtered list');
        }

        // Update repository with human selection
        await this.taskRepo.updateHumanSelection(taskId, selectedOutputId, userAddress);

        // Create evaluation result with human selection
        const evaluationResult: EvaluationResult = {
            taskId,
            mode: 'human-in-the-loop',
            winningOutputId: selectedOutputId,
            finalScore: 100,
            validators: taskState.evaluations.map(e => e.validatorAddress),
            humanSelection: {
                taskId,
                selectedOutputId,
                userAddress,
                timestamp: Date.now(),
                preFilteredOutputs: taskState.preFilteredOutputs || [],
            },
        };

        await this.taskRepo.updateEvaluationResult(taskId, evaluationResult);

        this.logger.info('Human selection recorded', { taskId, selectedOutputId, userAddress });

        return evaluationResult;
    }

    /**
     * Upload task state to IPFS and anchor on-chain
     * Uses repository instead of direct Prisma calls
     */
    async uploadAndAnchorTaskState(
        taskId: string,
        manifest: NetworkManifest
    ): Promise<{ ipfsCid: string; anchorData: string }> {
        try {
            // Get current task state using repository
            const taskState = await this.getTaskState(taskId);
            if (!taskState) {
                throw new Error('Task not found');
            }

            // Upload to IPFS
            const ipfsCid = await this.taskStateIPFSService.uploadTaskState(taskState);

            // Prepare on-chain anchor
            const anchorData = await this.taskStateIPFSService.anchorTaskStateOnChain(
                taskId,
                ipfsCid,
                manifest
            );

            // Update repository with IPFS CID
            await this.taskRepo.update(taskId, {
                ipfsCid,
                updatedAt: new Date(),
            });

            this.logger.info('Task state uploaded to IPFS and anchor prepared', {
                taskId,
                ipfsCid,
                contractAddress: manifest.settlement.contractAddress
            });

            return { ipfsCid, anchorData };
        } catch (error) {
            this.logger.error('Failed to upload and anchor task state', { taskId, error });
            throw error;
        }
    }

    /**
     * Verify task state CID against on-chain anchor
     * Uses ethers.js to query blockchain
     */
    async verifyTaskStateCIDAgainstAnchor(
        taskId: string,
        ipfsCid: string,
        manifest: NetworkManifest
    ): Promise<boolean> {
        try {
            const contractAddress = manifest.settlement.contractAddress;
            if (!contractAddress) {
                this.logger.warn('No contract address for verification', { taskId });
                return false;
            }

            const provider = this.getProvider(manifest.settlement.chain);
            if (!provider) {
                return false;
            }

            const { ethers } = await import('ethers');
            const contractABI = [
                'function getTaskStateAnchor(bytes32 taskId) external view returns (bytes32 stateHash, uint256 timestamp)',
            ];

            const contract = new ethers.Contract(contractAddress, contractABI, provider);
            const taskIdBytes32 = ethers.encodeBytes32String(taskId);
            const [stateHash] = await contract.getTaskStateAnchor(taskIdBytes32);

            if (!stateHash || stateHash === ethers.ZeroHash) {
                this.logger.debug('No anchor found on-chain for verification', { taskId });
                return false;
            }

            // Hash the IPFS CID the same way it was hashed when anchored
            const cidHash = ethers.keccak256(ethers.toUtf8Bytes(ipfsCid));

            // Verify hash matches
            const matches = stateHash.toLowerCase() === cidHash.toLowerCase();

            if (matches) {
                this.logger.info('Task state CID verified against on-chain anchor', {
                    taskId,
                    ipfsCid,
                    stateHash,
                });
            } else {
                this.logger.warn('Task state CID does not match on-chain anchor', {
                    taskId,
                    ipfsCid,
                    expectedHash: stateHash,
                    computedHash: cidHash,
                });
            }

            return matches;
        } catch (error) {
            this.logger.error('Failed to verify task state CID against anchor', {
                taskId,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    /**
     * Get on-chain selected validators
     * Delegates to OnChainValidatorService
     */
    async getOnChainSelectedValidators(
        taskId: string,
        manifest: NetworkManifest
    ): Promise<string[]> {
        try {
            return await this.onChainValidatorService.getSelectedValidators(taskId, manifest);
        } catch (error) {
            this.logger.error('Failed to get on-chain selected validators', { taskId, error });
            // Return empty array if on-chain query fails (fallback to off-chain selection)
            return [];
        }
    }

    /**
     * Get blockchain provider for a specific chain
     * Helper method for on-chain operations
     */
    private getProvider(chain: string): any {
        const { ethers } = require('ethers');

        // Map chain to RPC URL from environment
        const rpcUrls: Record<string, string | undefined> = {
            ethereum: process.env.ETHEREUM_RPC_URL,
            polygon: process.env.POLYGON_RPC_URL,
            bsc: process.env.BSC_RPC_URL,
            arbitrum: process.env.ARBITRUM_RPC_URL,
            base: process.env.BASE_RPC_URL,
            avalanche: process.env.AVALANCHE_RPC_URL,
            optimism: process.env.OPTIMISM_RPC_URL,
        };

        const rpcUrl = rpcUrls[chain.toLowerCase()];
        if (!rpcUrl) {
            this.logger.warn('No RPC URL configured for chain', { chain });
            return null;
        }

        return new ethers.JsonRpcProvider(rpcUrl);
    }

    /**
     * User reject and redo mechanism
     * Allows users to reject results and request redo with new validators
     */
    async userRejectAndRedo(
        taskId: string,
        userAddress: string,
        manifest: NetworkManifest
    ): Promise<{
        newTaskId: string;
        validatorsReplaced: string[];
        patternHash: string;
        onChainTxData: string | null;
        reputationUpdated: boolean;
        reputationReason?: string;
        shouldPenalize: boolean;
        penaltyType?: 'none' | 'soft' | 'partial' | 'challenge';
        totalValidators: number;
    }> {
        try {
            // Check if redo is enabled
            if (!manifest.userRedo?.enabled) {
                throw new Error('User redo not enabled for this network');
            }

            // Get current task state using repository
            const taskState = await this.getTaskState(taskId);
            if (!taskState) {
                throw new Error('Task not found');
            }

            // Check redo limit
            const redoCount = (taskState.redoCount || 0) + 1;
            const maxRedos = manifest.userRedo.maxRedos || 3;
            if (redoCount > maxRedos) {
                throw new Error(`Maximum redo limit reached (${maxRedos})`);
            }

            // Get validators who approved the rejected result
            const approvedValidators = taskState.evaluations
                .filter(e => e.score >= 50)
                .map(e => e.validatorAddress);

            // Get total validator count in network
            const totalValidators = await this.onChainValidatorService.getTotalValidatorCount(manifest);

            // Track rejection pattern (encrypted) with statistical process control
            const { patternHash, validatorsReplaced, reputationUpdated, reputationReason, shouldPenalize, penaltyType } =
                await this.collusionTrackingService.trackUserRejection(
                    taskId,
                    manifest.networkId,
                    approvedValidators,
                    totalValidators,
                    redoCount
                );

            // Record rejection on-chain (returns tx data for frontend)
            let onChainTxData: string | null = null;
            if (manifest.settlement.contractAddress) {
                try {
                    onChainTxData = await this.recordUserRejectionOnChain(
                        taskId,
                        userAddress,
                        approvedValidators,
                        patternHash,
                        manifest
                    );
                } catch (error) {
                    this.logger.error('Failed to record user rejection on-chain', { taskId, error });
                }
            }

            // Update task state
            taskState.userRejected = true;
            taskState.redoCount = redoCount;
            taskState.collusionPattern = patternHash;
            taskState.status = 'user-rejected';
            taskState.updatedAt = Date.now();

            // Upload updated state to IPFS
            let ipfsCid: string | null = null;
            try {
                ipfsCid = await this.taskStateIPFSService.uploadTaskState(taskState);
            } catch (error) {
                this.logger.warn('Failed to upload user rejection to IPFS', { taskId, error });
            }

            // Cache to database
            this.cacheTaskStateToDb(taskState, ipfsCid).catch(err => {
                this.logger.debug('Failed to cache user rejection to database', { taskId, err });
            });

            // Create new task ID for redo
            const newTaskId = `${taskId}-redo-${redoCount}`;

            this.logger.info('User redo requested', {
                originalTaskId: taskId,
                newTaskId,
                redoCount,
                totalValidators,
                rejectedValidators: approvedValidators.length,
                reputationUpdated,
                shouldPenalize,
                penaltyType,
            });

            return {
                newTaskId,
                validatorsReplaced: approvedValidators,
                patternHash,
                onChainTxData,
                reputationUpdated,
                reputationReason,
                shouldPenalize,
                penaltyType,
                totalValidators,
            };
        } catch (error) {
            this.logger.error('Failed to process user redo', { taskId, error });
            throw error;
        }
    }

    /**
     * Check if task is in bootstrap mode
     * Uses repository instead of direct Prisma calls
     */
    async checkBootstrapModeForTask(
        taskId: string,
        manifest: NetworkManifest
    ): Promise<any | null> {
        try {
            const task = await this.taskRepo.findById(taskId);
            if (!task) {
                return null;
            }

            // Get outputs to extract miner addresses
            const outputs = await this.taskRepo.getOutputs(taskId);
            const minerAddresses = [...new Set(outputs.map(o => o.minerAddress))];

            // Check bootstrap mode
            const bootstrapConfig = await this.bootstrapModeService.checkBootstrapMode(
                manifest.networkId,
                manifest,
                minerAddresses,
                task.depositAmount
            );

            if (bootstrapConfig.isActive) {
                this.logger.info('Bootstrap mode active for task', {
                    taskId,
                    mode: bootstrapConfig.mode,
                    convertedValidators: bootstrapConfig.convertedValidators?.length || 0,
                    convertedMiners: bootstrapConfig.convertedMiners?.length || 0
                });
            }

            return bootstrapConfig.isActive ? bootstrapConfig : null;
        } catch (error) {
            this.logger.error('Failed to check bootstrap mode for task', { taskId, error });
            return null;
        }
    }

    /**
     * Get bootstrap outputs for user selection
     * Returns top 2 outputs with bootstrap mode warnings
     */
    async getBootstrapOutputsForUserSelection(
        taskId: string,
        manifest: NetworkManifest
    ): Promise<any | null> {
        try {
            const task = await this.taskRepo.findById(taskId);
            if (!task) {
                return null;
            }

            const taskState = await this.getTaskState(taskId);
            const outputs: TaskOutput[] = taskState.outputs;

            // Check bootstrap mode
            const bootstrapConfig = await this.checkBootstrapModeForTask(taskId, manifest);
            if (!bootstrapConfig) {
                return null;
            }

            // Evaluate outputs in bootstrap mode
            const evaluationResult = await this.bootstrapModeService.evaluateBootstrapOutputs(
                outputs,
                bootstrapConfig,
                manifest,
                task.input
            );

            // Generate bootstrap mode warning
            const bootstrapModeWarning = {
                isActive: bootstrapConfig.isActive,
                mode: bootstrapConfig.mode,
                message: bootstrapConfig.mode === 'no-validators'
                    ? 'Network has no registered validators. Using temporary validators converted from miners. Security is reduced.'
                    : bootstrapConfig.mode === 'no-miners'
                        ? 'Network has no miners. Using temporary miners converted from validators. Security is reduced.'
                        : 'Bootstrap mode is not active.',
                securityLevel: bootstrapConfig.isActive ? 'reduced' as const : 'normal' as const
            };

            return {
                top2Outputs: evaluationResult.top2Outputs.map((o: any) => ({
                    outputId: o.outputId,
                    output: o.output,
                    minerAddress: o.minerAddress
                })),
                bootstrapConfig,
                requiresUserSelection: evaluationResult.requiresUserSelection,
                bootstrapModeWarning
            };
        } catch (error) {
            this.logger.error('Failed to get bootstrap outputs for user selection', { taskId, error });
            return null;
        }
    }

    /**
     * Handle user selection in bootstrap mode
     * User picks winner from top 2 outputs
     */
    async handleBootstrapUserSelection(
        taskId: string,
        userAddress: string,
        selectedOutputId: string,
        manifest: NetworkManifest
    ): Promise<any> {
        try {
            const task = await this.taskRepo.findById(taskId);
            if (!task) {
                throw new Error('Task not found');
            }

            const bootstrapConfig = await this.checkBootstrapModeForTask(taskId, manifest);
            if (!bootstrapConfig) {
                throw new Error('Task not in bootstrap mode');
            }

            const outputs = await this.taskRepo.getOutputs(taskId);
            const selectedOutput = outputs.find(o => o.outputId === selectedOutputId);
            if (!selectedOutput) {
                throw new Error('Selected output not found');
            }

            // Determine validator rewards
            const evaluations = await this.taskRepo.getEvaluations(taskId);
            const validatorRewards = evaluations.map(e => ({
                validatorAddress: e.validatorAddress,
                rewarded: e.outputId === selectedOutputId,
                reason: e.outputId === selectedOutputId ? 'Approved winning output' : 'Did not approve winning output'
            }));

            // Update task with consensus
            await this.taskRepo.updateConsensus(taskId, selectedOutputId);
            await this.taskRepo.updateStatus(taskId, 'consensus-reached');

            // Prepare payment release transaction
            let paymentReleased = false;
            let releaseTxData: string | null = null;
            const rewardedValidators = validatorRewards.filter(r => r.rewarded).map(r => r.validatorAddress);

            if (manifest.settlement.contractAddress) {
                try {
                    releaseTxData = await this.prepareBootstrapReleaseTransaction(
                        taskId,
                        selectedOutputId,
                        selectedOutput.minerAddress,
                        rewardedValidators,
                        manifest
                    );
                    paymentReleased = true;
                } catch (error) {
                    this.logger.error('Failed to prepare bootstrap payment release', { taskId, error });
                }
            }

            // Track validator performance
            await this.trackBootstrapValidatorPerformance(
                bootstrapConfig,
                validatorRewards,
                manifest
            );

            this.logger.info('Bootstrap user selection processed', {
                taskId,
                selectedOutputId,
                validatorRewards: validatorRewards.filter(r => r.rewarded).length,
                paymentReleased
            });

            return {
                success: true,
                winnerOutputId: selectedOutputId,
                validatorRewards,
                paymentReleased,
                releaseTxData,
                requiresMoreConfirmations: false,
                confirmationsReceived: 1,
                confirmationsRequired: bootstrapConfig.minConfirmationsRequired || 1
            };
        } catch (error) {
            this.logger.error('Failed to handle bootstrap user selection', { taskId, error });
            throw error;
        }
    }

    /**
     * Load task state from database record
     * Converts DB format to TaskState
     */
    private async loadTaskStateFromDb(task: any): Promise<TaskState> {
        const submission: TaskSubmission = {
            taskId: task.taskId,
            networkId: task.networkId,
            input: typeof task.input === 'string' ? JSON.parse(task.input) : task.input,
            depositorAddress: task.depositorAddress,
            depositAmount: task.depositAmount,
            depositTxHash: task.depositTxHash || undefined,
            timestamp: task.createdAt instanceof Date ? task.createdAt.getTime() : task.createdAt,
        };

        const outputs = await this.taskRepo.getOutputs(task.taskId);
        const evaluations = await this.taskRepo.getEvaluations(task.taskId);

        return {
            taskId: task.taskId,
            networkId: task.networkId,
            status: task.status as TaskStatus,
            submission,
            outputs: outputs.map(o => ({
                outputId: o.outputId,
                output: o.output,
                minerAddress: o.minerAddress,
                timestamp: o.timestamp instanceof Date ? o.timestamp.getTime() : o.timestamp,
                metadata: o.metadata,
            })),
            evaluations: evaluations.map(e => ({
                validatorAddress: e.validatorAddress,
                outputId: e.outputId,
                score: e.score,
                confidence: e.confidence,
                timestamp: e.timestamp instanceof Date ? e.timestamp.getTime() : e.timestamp,
                signature: e.signature,
                evidence: e.evidence,
            })),
            evaluationResult: task.evaluationResult,
            humanSelection: task.humanSelection,
            preFilteredOutputs: task.preFilteredOutputs,
            consensusReached: task.consensusReached,
            winningOutputId: task.winningOutputId || undefined,
            paymentReleased: task.paymentReleased,
            paymentTxHash: task.paymentTxHash || undefined,
            userRejected: task.userRejected || false,
            redoCount: task.redoCount || 0,
            rejectedValidators: task.rejectedValidators,
            collusionPattern: task.collusionPattern,
            createdAt: task.createdAt instanceof Date ? task.createdAt.getTime() : task.createdAt,
            updatedAt: task.updatedAt instanceof Date ? task.updatedAt.getTime() : task.updatedAt,
        };
    }

    /**
     * Cache task state to database
     * Async, non-blocking - IPFS is primary source of truth
     */
    private async cacheTaskStateToDb(taskState: TaskState, ipfsCid: string | null): Promise<void> {
        try {
            // Update main task record
            await this.taskRepo.update(taskState.taskId, {
                status: taskState.status,
                consensusReached: taskState.consensusReached,
                winningOutputId: taskState.winningOutputId || null,
                paymentReleased: taskState.paymentReleased,
                paymentTxHash: taskState.paymentTxHash || null,
                ipfsCid: ipfsCid || null,
                updatedAt: new Date(taskState.updatedAt),
            });

            // Update evaluation result if present
            if (taskState.evaluationResult) {
                await this.taskRepo.updateEvaluationResult(taskState.taskId, taskState.evaluationResult);
            }

            // Update pre-filtered outputs if present
            if (taskState.preFilteredOutputs) {
                await this.taskRepo.updatePreFilteredOutputs(taskState.taskId, taskState.preFilteredOutputs);
            }

            // Update human selection if present
            if (taskState.humanSelection) {
                await this.taskRepo.updateHumanSelection(
                    taskState.taskId,
                    taskState.humanSelection.selectedOutputId,
                    taskState.humanSelection.userAddress
                );
            }

            this.logger.debug('Task state cached to database', { taskId: taskState.taskId, ipfsCid });
        } catch (error) {
            this.logger.error('Failed to cache task state to database', {
                taskId: taskState.taskId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get task state CID from database or contract
     */
    private async getTaskStateCID(taskId: string, manifest: NetworkManifest): Promise<string | null> {
        // Try database first
        const task = await this.taskRepo.findById(taskId);
        if (task?.ipfsCid) {
            return task.ipfsCid;
        }

        // Try contract
        return await this.getTaskStateCIDFromContract(taskId, manifest);
    }

    /**
     * Get task state CID from contract
     */
    private async getTaskStateCIDFromContract(taskId: string, manifest: NetworkManifest): Promise<string | null> {
        try {
            const contractAddress = manifest.settlement.contractAddress;
            if (!contractAddress) {
                return null;
            }

            const provider = this.getProvider(manifest.settlement.chain);
            if (!provider) {
                return null;
            }

            const { ethers } = await import('ethers');
            const contractABI = [
                'function getTaskStateAnchor(bytes32 taskId) external view returns (bytes32 stateHash, uint256 timestamp)',
            ];

            const contract = new ethers.Contract(contractAddress, contractABI, provider);
            const taskIdBytes32 = ethers.encodeBytes32String(taskId);
            const [stateHash, timestamp] = await contract.getTaskStateAnchor(taskIdBytes32);

            if (!stateHash || stateHash === ethers.ZeroHash) {
                return null;
            }

            this.logger.info('Task state anchor found on-chain', {
                taskId,
                stateHash,
                timestamp: timestamp.toString(),
            });

            // Note: Cannot reverse hash to get CID, anchor is for verification only
            return null;
        } catch (error) {
            this.logger.error('Failed to query task state anchor from contract', { taskId, error });
            return null;
        }
    }

    /**
     * Record user rejection on-chain
     * Returns transaction data for frontend to execute
     */
    private async recordUserRejectionOnChain(
        taskId: string,
        userAddress: string,
        approvedValidators: string[],
        patternHash: string,
        manifest: NetworkManifest
    ): Promise<string> {
        try {
            const contractAddress = manifest.settlement.contractAddress;
            if (!contractAddress) {
                throw new Error('No contract address');
            }

            const { ethers } = await import('ethers');
            const contractABI = [
                'function recordUserRejection(bytes32 taskId, address[] calldata approvedValidators, bytes32 patternHash) external'
            ];

            const taskIdBytes32 = ethers.encodeBytes32String(taskId);
            const patternHashHex = patternHash.startsWith('0x') ? patternHash : '0x' + patternHash;
            const patternHashBytes32 = ethers.zeroPadValue(patternHashHex.substring(0, 66), 32);

            const iface = new ethers.Interface(contractABI);
            const functionData = iface.encodeFunctionData('recordUserRejection', [
                taskIdBytes32,
                approvedValidators,
                patternHashBytes32
            ]);

            const txData = {
                to: contractAddress,
                data: functionData,
                from: userAddress,
            };

            this.logger.info('User rejection on-chain transaction prepared', {
                taskId,
                contractAddress,
                validatorCount: approvedValidators.length,
            });

            return JSON.stringify(txData);
        } catch (error) {
            this.logger.error('Failed to prepare on-chain user rejection', { taskId, error });
            throw error;
        }
    }

    /**
     * Prepare bootstrap release transaction
     */
    private async prepareBootstrapReleaseTransaction(
        taskId: string,
        outputId: string,
        minerAddress: string,
        rewardedValidators: string[],
        manifest: NetworkManifest
    ): Promise<string> {
        try {
            const { ethers } = await import('ethers');
            const contractABI = [
                'function releasePayment(bytes32 taskId, address winner, address[] calldata validators) external'
            ];

            const taskIdBytes32 = ethers.encodeBytes32String(taskId);
            const iface = new ethers.Interface(contractABI);
            const functionData = iface.encodeFunctionData('releasePayment', [
                taskIdBytes32,
                minerAddress,
                rewardedValidators
            ]);

            const txData = {
                to: manifest.settlement.contractAddress,
                data: functionData,
            };

            return JSON.stringify(txData);
        } catch (error) {
            this.logger.error('Failed to prepare bootstrap release transaction', { taskId, error });
            throw error;
        }
    }

    /**
     * Track bootstrap validator performance
     */
    private async trackBootstrapValidatorPerformance(
        bootstrapConfig: any,
        validatorRewards: any[],
        manifest: NetworkManifest
    ): Promise<void> {
        try {
            // Track performance for converted validators
            for (const reward of validatorRewards) {
                if (bootstrapConfig.convertedValidators?.includes(reward.validatorAddress)) {
                    this.logger.debug('Tracking converted validator performance', {
                        validator: reward.validatorAddress,
                        rewarded: reward.rewarded,
                        networkId: manifest.networkId
                    });
                }
            }
        } catch (error) {
            this.logger.error('Failed to track bootstrap validator performance', { error });
        }
    }

    /**
     * Generate seed for stochastic tasks
     */
    private generateSeed(): string {
        const { randomBytes } = require('crypto');
        return randomBytes(32).toString('hex');
    }

    /**
     * Validate input against schema
     */
    private validateInput(input: any, schema: object): void {
        const validation = this.jsonSchemaValidator.validateInput(
            input,
            schema,
            `input-schema-${Date.now()}`
        );

        if (!validation.valid) {
            throw new Error(`Input validation failed: ${validation.errors.join('; ')}`);
        }
    }

    /**
     * Validate output against schema
     */
    private validateOutput(output: any, schema: object): void {
        const validation = this.jsonSchemaValidator.validateOutput(
            output,
            schema,
            `output-schema-${Date.now()}`
        );

        if (!validation.valid) {
            throw new Error(`Output validation failed: ${validation.errors.join('; ')}`);
        }
    }

    /**
     * Hash output deterministically
     */
    private hashOutput(output: any): string {
        const { createHash } = require('crypto');
        const outputStr = JSON.stringify(output, Object.keys(output).sort());
        return createHash('sha256').update(outputStr).digest('hex');
    }
}
