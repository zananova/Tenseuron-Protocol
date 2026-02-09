/**
 * Evaluation Service
 * 
 * Implements hybrid evaluation approach:
 * 1. Deterministic Core (replayable, verifiable)
 * 2. Statistical/Probabilistic Edges (multiple outputs, weighted scoring)
 * 3. Human-in-the-loop (optional, controlled)
 * 
 * First Principles:
 * - Verification > Reputation
 * - Determinism where possible, consensus where not
 * - Cost > Rules (risky evaluation costs more)
 */

import { ILogger } from './utils/ILogger';
import { createHash } from 'crypto';
import { 
  StatisticalDistributionService, 
  MonteCarloOutput, 
  ContributionScore,
  UserPreference,
  ValidatorMethodConfig,
  EmbeddingMethod,
  ClusteringAlgorithm
} from './StatisticalDistributionService';
import {
  DeterministicReplayService,
  ReplayValidationResult,
} from './DeterministicReplayService';

/**
 * Evaluation Mode
 */
export type EvaluationMode = 
  | 'deterministic'      // Pure deterministic (code, math, proofs)
  | 'statistical'        // Statistical consensus (images, text, creative)
  | 'human-in-the-loop'; // Human selection from top-N

/**
 * Task Output (from miner)
 */
/**
 * Replay Bundle for Deterministic Tasks
 * Contains all information needed to replay execution exactly
 */
export interface ReplayBundle {
  taskInputHash: string;        // Hash of task input
  modelId: string;              // Model identifier
  modelVersionHash: string;     // Hash of model version/weights
  inferenceParameters: {        // Inference parameters
    temperature: number;         // Must be 0 for deterministic
    maxTokens?: number;
    topP?: number;
    topK?: number;
    [key: string]: any;         // Other parameters
  };
  randomSeed: string;           // Fixed random seed (required for deterministic)
  executionEnvHash: string;     // Hash of execution environment
}

/**
 * Execution Environment
 * Describes the execution environment for reproducibility
 */
export interface ExecutionEnvironment {
  os: string;                   // Operating system
  runtime: string;               // Runtime (e.g., Python 3.11, Node.js 20)
  modelBinary: string;          // Model binary identifier/hash
  inferenceLibrary: string;     // Inference library (e.g., transformers, torch)
  inferenceLibraryVersion: string; // Version of inference library
  dependencies?: {               // Optional: dependency versions
    [key: string]: string;
  };
}

/**
 * Intermediate Step Hash
 * Hash of intermediate state during generation
 */
export interface IntermediateStepHash {
  stepIndex: number;            // Step index (0, 1, 2, ...)
  stepHash: string;             // Hash of step state
  stepType?: string;            // Type of step (token, AST, reasoning, etc.)
}

/**
 * Step Trace Hash
 * Root hash of all intermediate step hashes
 */
export interface StepTraceHash {
  traceHash: string;            // H(h1 || h2 || ... || hn)
  stepHashes: IntermediateStepHash[]; // Individual step hashes
}

export interface TaskOutput {
  outputId: string;           // Deterministic hash of output
  output: any;                 // The actual output
  minerAddress: string;       // Miner who produced this
  timestamp: number;          // When produced
  metadata?: {
    seed?: string;            // Fixed seed (for stochastic tasks)
    intermediateHashes?: string[]; // Hashes of intermediate steps (legacy)
    executionProof?: string;  // Proof of execution (if available)
    
    // NEW: Deterministic replay bundle
    replayBundle?: ReplayBundle;
    stepTraceHash?: StepTraceHash; // Intermediate step hashes
    executionEnv?: ExecutionEnvironment; // Execution environment
  };
}

/**
 * Validator Evaluation
 */
export interface ValidatorEvaluation {
  validatorAddress: string;
  outputId: string;           // Which output they evaluated
  score: number;              // Score (0-100)
  confidence: number;         // Confidence level (0-1)
  timestamp: number;
  signature: string;          // Signature of evaluation
  evidence?: string;          // Evidence for score (optional)
  
  // NEW: Validator method configuration (for distribution-based evaluation)
  methodConfig?: ValidatorMethodConfig;
  
  // NEW: Distribution analysis results from this validator
  distributionAnalysis?: import('./StatisticalDistributionService').DistributionAnalysis;
  contributions?: import('./StatisticalDistributionService').ContributionScore[];
}

/**
 * Statistical Evaluation Result
 */
export interface StatisticalEvaluation {
  outputId: string;
  weightedScore: number;      // Weighted average score
  agreementScore: number;     // How much validators agree (0-1)
  validatorCount: number;     // Number of validators who evaluated
  confidence: number;         // Overall confidence (0-1)
  evaluations: ValidatorEvaluation[];
}

/**
 * Extended Statistical Result (with distribution analysis)
 */
export interface ExtendedStatisticalResult {
  topOutputs: StatisticalEvaluation[];
  consensusOutput?: string;   // Top output by contribution (not consensus)
  distributionAnalysis?: import('./StatisticalDistributionService').DistributionAnalysis;
  contributions?: import('./StatisticalDistributionService').ContributionScore[];
}

/**
 * Human-in-the-Loop Selection
 */
export interface HumanSelection {
  taskId: string;
  selectedOutputId: string;  // User-selected output
  userAddress: string;        // User who selected
  timestamp: number;
  preFilteredOutputs: string[]; // Top-N outputs from validators
}

/**
 * Evaluation Result
 */
export interface EvaluationResult {
  taskId: string;
  mode: EvaluationMode;
  
  // Deterministic result
  deterministicResult?: {
    outputId: string;
    score: number;
    replayable: boolean;
    replayHash: string;       // Hash of inputs + seed for replay
  };
  
  // Statistical result
  statisticalResult?: {
    topOutputs: StatisticalEvaluation[];
    consensusOutput?: string; // Best output by consensus (or contribution for distribution-based)
    distributionAnalysis?: import('./StatisticalDistributionService').DistributionAnalysis;
    contributions?: import('./StatisticalDistributionService').ContributionScore[];
  };
  
  // Human-in-the-loop result
  humanSelection?: HumanSelection;
  
  // Final decision
  winningOutputId: string;
  finalScore: number;
  validators: string[];       // Validators who participated
}

import {
  ValidatorReputationService,
  ValidationResult as ReputationValidationResult,
} from './ValidatorReputationService';
import { AdversarialTestingService } from './AdversarialTestingService';
import { RiskScoringService } from './RiskScoringService';
import { NetworkState, RiskVector, NetworkManifest } from './types';
import { NetworkStateCalculator } from './NetworkStateCalculator';

export class EvaluationService {
  private logger: ILogger;
  private statisticalDistributionService?: StatisticalDistributionService;
  private validatorCalibrationService?: ValidatorCalibrationService;
  private deterministicReplayService?: DeterministicReplayService;
  private validatorReputationService?: ValidatorReputationService;
  private adversarialTestingService?: AdversarialTestingService;
  private riskScoringService?: RiskScoringService;
  private networkStateCalculator?: NetworkStateCalculator;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('EvaluationService');
    // Initialize statistical distribution service (only used for non-deterministic tasks)
    this.statisticalDistributionService = new StatisticalDistributionService(this.logger);
    // Initialize validator calibration service (for epistemic decentralization)
    // Initialize validator reputation service (Option 1: Rejection without slashing)
    this.validatorReputationService = new ValidatorReputationService(this.logger);
    // Initialize deterministic replay service (only used for deterministic tasks)
    this.deterministicReplayService = new DeterministicReplayService(this.logger);
    this.validatorCalibrationService = new ValidatorCalibrationService(this.logger);
    // Initialize adversarial testing service (for risk score gaming prevention)
    this.adversarialTestingService = new AdversarialTestingService(undefined, this.logger);
    // Initialize risk scoring service (for correlation detection and relative risk)
    this.riskScoringService = new RiskScoringService(this.logger);
    // Initialize network state calculator (for adaptive risk weighting)
    this.networkStateCalculator = new NetworkStateCalculator(this.logger);
  }

  /**
   * Validate and filter evaluations using reputation service
   * 
   * Option 1: Rejection without slashing
   * - Invalid evaluations are rejected (no payment)
   * - Reputation is updated
   * - No funds are taken
   */
  private async validateAndFilterEvaluations(
    evaluations: ValidatorEvaluation[],
    consensusResult: {
      accepted: boolean;
      consensusReached: boolean;
      majorityScore: number;
    }
  ): Promise<{
    validEvaluations: ValidatorEvaluation[];
    rejectedEvaluations: Array<{ evaluation: ValidatorEvaluation; reason: string }>;
    reputationUpdates: Map<string, ReputationValidationResult>;
  }> {
    if (!this.validatorReputationService) {
      // If reputation service not available, return all as valid
      return {
        validEvaluations: evaluations,
        rejectedEvaluations: [],
        reputationUpdates: new Map(),
      };
    }

    const validEvaluations: ValidatorEvaluation[] = [];
    const rejectedEvaluations: Array<{ evaluation: ValidatorEvaluation; reason: string }> = [];
    const reputationUpdates = new Map<string, ReputationValidationResult>();

    for (const evaluation of evaluations) {
      // Validate evaluation
      const validationResult = this.validatorReputationService.validateEvaluation(
        evaluation,
        consensusResult
      );

      // Check if should reject
      if (validationResult.shouldReject) {
        // REJECT (Option 1: No payment, no slashing)
        rejectedEvaluations.push({
          evaluation,
          reason: validationResult.reason || 'Invalid evaluation',
        });

        // Update reputation
        const updateResult = await this.validatorReputationService.updateReputation(
          evaluation.validatorAddress,
          validationResult,
          false // Not successful
        );

        reputationUpdates.set(evaluation.validatorAddress, updateResult);

        this.logger.warn('Validator evaluation rejected (no payment, no slashing)', {
          validatorAddress: evaluation.validatorAddress,
          outputId: evaluation.outputId,
          reason: validationResult.reason,
          reputationChange: updateResult.reputationChange,
        });
      } else {
        // Valid evaluation
        validEvaluations.push(evaluation);

        // Update reputation (success or failure)
        const wasSuccessful = validationResult.valid && !validationResult.reputationPenalty;
        const updateResult = await this.validatorReputationService.updateReputation(
          evaluation.validatorAddress,
          validationResult,
          wasSuccessful
        );

        // NEW: Update risk vector
        if (this.validatorReputationService) {
          const surprisal = this.validatorReputationService.calculateSurprisal(
            evaluation.validatorAddress,
            evaluation,
            manifest?.taskFormat?.inputSchema?.type || 'general' // Use task type from manifest if available
          );
          
          this.validatorReputationService.updateRiskVector(
            evaluation.validatorAddress,
            {
              wasSuccessful,
              surprisal,
            }
          );
        }

        // NEW: Track risk for correlation detection
        if (this.riskScoringService) {
          const riskScore = updateResult.newReputation / 100; // Normalize to 0-1
          this.riskScoringService.trackValidatorRisk(
            evaluation.validatorAddress,
            riskScore
          );
        }

        // NEW: Check for adversarial test injection
        if (this.adversarialTestingService && wasSuccessful) {
          const metrics = this.validatorReputationService.getReputation(
            evaluation.validatorAddress
          );
          const reputationChange = updateResult.reputationChange;
          const isCorrelated = this.riskScoringService?.hasHighCorrelation(
            evaluation.validatorAddress,
            0.8
          ) || false;
          
          const shouldTest = this.adversarialTestingService.shouldInjectTest(
            evaluation.validatorAddress,
            updateResult.newReputation,
            reputationChange,
            isCorrelated
          );
          
          if (shouldTest.isAdversarial && shouldTest.testType) {
            // Inject adversarial test (would be handled in next evaluation cycle)
            this.logger.info('Adversarial test scheduled', {
              validatorAddress: evaluation.validatorAddress,
              testType: shouldTest.testType,
            });
          }
        }

        reputationUpdates.set(evaluation.validatorAddress, updateResult);
      }
    }

    return {
      validEvaluations,
      rejectedEvaluations,
      reputationUpdates,
    };
  }

  /**
   * Evaluate deterministic task
   * Pure replayable evaluation (code, math, proofs)
   * 
   * Uses DeterministicReplayService to validate replay bundles.
   * Option 1: Rejection without slashing - invalid submissions are rejected (no payment).
   */
  async evaluateDeterministic(
    taskId: string,
    input: any,
    outputs: TaskOutput[],
    evaluations: ValidatorEvaluation[],
    scoringModuleHash: string,
    deterministicReplayConfig?: {
      required?: boolean;
      seedRequired?: boolean;
      intermediateHashing?: boolean;
      executionEnvRequired?: boolean;
    }
  ): Promise<EvaluationResult> {
    // For deterministic tasks, all outputs should be identical if correct
    // Validators verify by replaying using the replay bundle
    
    if (!this.deterministicReplayService) {
      throw new Error('DeterministicReplayService not initialized');
    }

    // Validate replay for each output
    const validOutputs: TaskOutput[] = [];
    const invalidOutputs: Array<{ outputId: string; reason: string }> = [];

    for (const output of outputs) {
      // Check if replay bundle is provided
      if (!output.metadata?.replayBundle) {
        if (deterministicReplayConfig?.required) {
          invalidOutputs.push({
            outputId: output.outputId,
            reason: 'Replay bundle required but not provided',
          });
          continue;
        }
        // If replay not required, skip validation
        validOutputs.push(output);
        continue;
      }

      // Validate replay
      // Get execution environment and task input from output metadata
      const executionEnv = output.metadata?.executionEnv;
      const taskInput = input; // Use the actual task input passed to this method
      
      const replayValidation = await this.deterministicReplayService.validateReplay(
        output.output,
        output.outputId,
        output.metadata.replayBundle,
        output.metadata.stepTraceHash,
        executionEnv,
        taskInput
      );

      if (!replayValidation.valid) {
        // REJECT (Option 1: No slashing, just rejection)
        invalidOutputs.push({
          outputId: output.outputId,
          reason: replayValidation.reason || 'Replay validation failed',
        });
        this.logger.warn('Output rejected due to replay validation failure', {
          taskId,
          outputId: output.outputId,
          reason: replayValidation.reason,
        });
        continue;
      }

      // Valid output
      validOutputs.push(output);
    }

    // If no valid outputs, return rejection
    if (validOutputs.length === 0) {
      this.logger.warn('All outputs rejected for deterministic task', {
        taskId,
        totalOutputs: outputs.length,
        invalidOutputs: invalidOutputs.length,
      });

      return {
        taskId,
        mode: 'deterministic',
        deterministicResult: {
          outputId: '',
          score: 0,
          replayable: false,
          replayHash: '',
        },
        winningOutputId: '',
        finalScore: 0,
        validators: evaluations.map(e => e.validatorAddress),
      };
    }

    // Group evaluations by output (only for valid outputs and valid evaluations)
    const outputEvaluations = new Map<string, ValidatorEvaluation[]>();
    for (const eval_ of filteredEvaluations) {
      if (validOutputs.some(o => o.outputId === eval_.outputId)) {
        if (!outputEvaluations.has(eval_.outputId)) {
          outputEvaluations.set(eval_.outputId, []);
        }
        outputEvaluations.get(eval_.outputId)!.push(eval_);
      }
    }

    // Find output with highest consensus (from valid outputs only)
    let bestOutputId = '';
    let bestScore = 0;
    let bestReplayHash = '';

    for (const [outputId, evals] of outputEvaluations.entries()) {
      const avgScore = evals.reduce((sum, e) => sum + e.score, 0) / evals.length;
      const consensus = evals.length / evaluations.length; // How many validators agree

      // For deterministic tasks, consensus matters more than score
      if (consensus > 0.5 && avgScore > bestScore) {
        bestOutputId = outputId;
        bestScore = avgScore;
        
        // Generate replay hash (input + seed + scoring module)
        const output = validOutputs.find(o => o.outputId === outputId);
        const seed = output?.metadata?.seed || '';
        bestReplayHash = this.generateReplayHash(input, seed, scoringModuleHash);
      }
    }

    return {
      taskId,
      mode: 'deterministic',
      deterministicResult: {
        outputId: bestOutputId,
        score: bestScore,
        replayable: true,
        replayHash: bestReplayHash,
      },
      winningOutputId: bestOutputId,
      finalScore: bestScore,
      validators: filteredEvaluations.map(e => e.validatorAddress),
    };
  }

  /**
   * Calculate consensus for reputation validation
   */
  private calculateConsensus(evaluations: ValidatorEvaluation[]): {
    accepted: boolean;
    consensusReached: boolean;
    majorityScore: number;
  } {
    if (evaluations.length === 0) {
      return {
        accepted: false,
        consensusReached: false,
        majorityScore: 0,
      };
    }

    // Calculate average score
    const avgScore = evaluations.reduce((sum, e) => sum + e.score, 0) / evaluations.length;
    
    // Check if consensus reached (simple majority threshold)
    const consensusThreshold = 0.5;
    const consensusReached = evaluations.length >= 2; // At least 2 validators

    return {
      accepted: avgScore >= 50, // Average score >= 50 is considered accepted
      consensusReached,
      majorityScore: avgScore,
    };
  }

  /**
   * Evaluate statistical/probabilistic task
   * 
   * For non-deterministic tasks: Uses Monte Carlo distribution-based evaluation
   * For deterministic tasks: Falls back to consensus-based (should not happen)
   * 
   * This method is ONLY called when evaluationMode === 'statistical' (non-deterministic)
   */
  async evaluateStatistical(
    taskId: string,
    outputs: TaskOutput[],
    evaluations: ValidatorEvaluation[],
    validatorReputations: Map<string, number>, // Validator address -> reputation (0-1)
    distributionBased: boolean = true, // Use Monte Carlo approach by default
    taskType: string = 'general',
    manifest?: NetworkManifest,
    taskInput?: any
  ): Promise<EvaluationResult> {
    // Check if we should use distribution-based evaluation
    if (distributionBased && this.statisticalDistributionService) {
      const result = await this.evaluateStatisticalDistribution(
        taskId,
        outputs,
        evaluations,
        validatorReputations,
        taskType
      );
      
      // Calculate aggregated distribution for network state
      const aggregatedDistribution = this.aggregateDistributions(
        result.aggregatedContributionsMap ? new Map() : new Map() // Will be calculated from validator distributions
      );
      
      // Update network state in result if needed
      return result;
    }
    
    // Fallback to consensus-based evaluation (legacy, for backward compatibility)
    return await this.evaluateStatisticalConsensus(
      taskId,
      outputs,
      evaluations,
      validatorReputations,
      manifest,
      taskInput
    );
  }

  /**
   * Distribution-based evaluation (Monte Carlo approach)
   * ONLY used for non-deterministic tasks
   * 
   * Supports validator pluralism: each validator can use different methods
   */
  private async evaluateStatisticalDistribution(
    taskId: string,
    outputs: TaskOutput[],
    evaluations: ValidatorEvaluation[],
    validatorReputations: Map<string, number>,
    taskType: string
  ): Promise<EvaluationResult> {
    if (!this.statisticalDistributionService || !this.validatorCalibrationService) {
      throw new Error('StatisticalDistributionService or ValidatorCalibrationService not initialized');
    }

    this.logger.info('Using Monte Carlo distribution-based evaluation with validator pluralism', { 
      taskId, 
      outputCount: outputs.length,
      validatorCount: evaluations.length 
    });

    // Convert TaskOutput to MonteCarloOutput
    const monteCarloOutputs: MonteCarloOutput[] = outputs.map(o => ({
      outputId: o.outputId,
      output: o.output,
      minerAddress: o.minerAddress,
      timestamp: o.timestamp,
      generationParams: {
        seed: o.metadata?.seed,
        temperature: (o.metadata as any)?.temperature,
        model: (o.metadata as any)?.model,
        promptStyle: (o.metadata as any)?.promptStyle,
      },
      intent: (o.metadata as any)?.intent,
    }));

    // Group evaluations by validator to get their method configs
    const validatorMethods = new Map<string, ValidatorMethodConfig>();
    for (const eval_ of evaluations) {
      if (eval_.methodConfig) {
        validatorMethods.set(eval_.validatorAddress, eval_.methodConfig);
      }
    }

    // If no validators have method configs, use defaults (backward compatibility)
    const hasMethodConfigs = validatorMethods.size > 0;
    
    // Process each validator's evaluation with their chosen method
    const validatorDistributions = new Map<string, DistributionAnalysis>();
    const validatorContributions = new Map<string, Map<string, ContributionScore>>();
    
    if (hasMethodConfigs) {
      // Validator pluralism: each validator uses their own method
      for (const [validatorAddress, methodConfig] of validatorMethods.entries()) {
        try {
          // 1. Embed outputs using validator's chosen method
          // Get embedding config from manifest (custom embeddings with user-provided API keys)
          const embeddingConfig = manifest.statisticalEvaluation?.embeddingConfig;
          
          const embeddings = await this.statisticalDistributionService.embedOutputs(
            monteCarloOutputs,
            taskType,
            methodConfig.embeddingMethod,
            embeddingConfig
          );

          // 2. Estimate distribution using validator's chosen algorithm
          const distribution = await this.statisticalDistributionService.estimateDistribution(
            embeddings,
            monteCarloOutputs,
            methodConfig.clusteringAlgorithm
          );

          // 3. Calculate contributions using validator's chosen weights
          const contributions = await this.statisticalDistributionService.calculateContributions(
            monteCarloOutputs,
            distribution,
            embeddings,
            methodConfig.contributionWeights
          );

          validatorDistributions.set(validatorAddress, distribution);
          validatorContributions.set(validatorAddress, contributions);
        } catch (error) {
          this.logger.warn('Validator method evaluation failed', {
            validatorAddress,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else {
      // Fallback: use default method (backward compatibility)
      // Get embedding config from manifest (custom embeddings with user-provided API keys)
      const embeddingConfig = manifest.statisticalEvaluation?.embeddingConfig;
      
      const embeddings = await this.statisticalDistributionService.embedOutputs(
        monteCarloOutputs,
        taskType,
        embeddingConfig?.provider === 'openai' ? 'openai' : 
        embeddingConfig?.provider === 'xenova' ? 'sentence-transformers' : 
        'hash-based',
        embeddingConfig
      );

      const distribution = await this.statisticalDistributionService.estimateDistribution(
        embeddings,
        monteCarloOutputs,
        'simple'
      );

      const contributions = await this.statisticalDistributionService.calculateContributions(
        monteCarloOutputs,
        distribution,
        embeddings
      );

      // Assign to all validators (for backward compatibility)
      for (const eval_ of evaluations) {
        validatorDistributions.set(eval_.validatorAddress, distribution);
        validatorContributions.set(eval_.validatorAddress, contributions);
      }
    }

    // 4. Calibrate validators based on estimator quality (NOT agreement)
    const calibrations = this.validatorCalibrationService.calibrateValidators(
      evaluations,
      validatorDistributions,
      validatorContributions
    );

    // 5. Aggregate contributions across validators (weighted by calibration)
    const aggregatedContributions = this.aggregateContributions(
      validatorContributions,
      calibrations
    );

    // 6. Convert aggregated contributions to statistical results format
    const statisticalResults: StatisticalEvaluation[] = Array.from(aggregatedContributions.values())
      .map(contrib => {
        // Find evaluations for this output
        const outputEvals = evaluations.filter(e => e.outputId === contrib.outputId);
        
        // Calculate weighted score based on aggregated contribution
        const weightedScore = contrib.totalContribution * 100; // Normalize to 0-100
        
        // Method diversity score (not agreement score)
        const methodDiversity = this.calculateMethodDiversityScore(outputEvals, calibrations);
        
        // Confidence based on calibration quality, not agreement
        const avgCalibration = outputEvals.length > 0
          ? outputEvals.reduce((sum, e) => {
              const cal = calibrations.get(e.validatorAddress);
              return sum + (cal?.calibrationScore || 0.5);
            }, 0) / outputEvals.length
          : 0.5;

        return {
          outputId: contrib.outputId,
          weightedScore,
          agreementScore: methodDiversity, // Actually method diversity, not agreement
          validatorCount: outputEvals.length,
          confidence: avgCalibration, // Based on calibration, not agreement
          evaluations: outputEvals,
        };
      })
      .sort((a, b) => b.weightedScore - a.weightedScore);

    // 7. Top output by aggregated contribution (not consensus)
    const topOutput = statisticalResults[0];

    // 8. Aggregate distribution (average across validators)
    const aggregatedDistribution = this.aggregateDistributions(validatorDistributions);

    return {
      taskId,
      mode: 'statistical',
      statisticalResult: {
        topOutputs: statisticalResults,
        consensusOutput: topOutput?.outputId || '', // Top by contribution, not consensus
        // NEW: Include aggregated distribution analysis and calibrations
        distributionAnalysis: aggregatedDistribution,
        contributions: Array.from(aggregatedContributions.values()),
        validatorCalibrations: Array.from(calibrations.values()),
        // Store for human-in-the-loop preference-based pre-filtering
        aggregatedContributionsMap: aggregatedContributions, // Keep Map for preference sampling
        monteCarloOutputs: monteCarloOutputs, // Keep for preference sampling
      } as any, // Extended type
      winningOutputId: topOutput?.outputId || '',
      finalScore: topOutput?.weightedScore || 0,
      validators: Array.from(new Set(evaluations.map(e => e.validatorAddress))),
    };
  }

  /**
   * Pre-filter top-N outputs for human-in-the-loop using user preference
   * 
   * If user preference is specified, uses StatisticalDistributionService.sampleByPreference()
   * Otherwise, uses top-N by total contribution score
   */
  async preFilterForHumanSelection(
    evaluationResult: EvaluationResult,
    topN: number,
    userPreference?: {
      type?: 'safe' | 'novel' | 'diverse' | 'balanced';
      customPreference?: {
        alpha: number;
        beta: number;
        gamma: number;
      };
    }
  ): Promise<string[]> {
    if (!evaluationResult.statisticalResult) {
      throw new Error('Pre-filtering requires statistical evaluation result');
    }

    // If user preference is specified, use preference-based sampling
    if (userPreference && this.statisticalDistributionService) {
      const statisticalResult = evaluationResult.statisticalResult as any;
      const contributions = statisticalResult.aggregatedContributionsMap as Map<string, ContributionScore>;
      const monteCarloOutputs = statisticalResult.monteCarloOutputs as MonteCarloOutput[];

      if (contributions && monteCarloOutputs) {
        // Build user preference vector
        let preferenceVector: { alpha: number; beta: number; gamma: number };
        
        if (userPreference.customPreference) {
          // Use custom preference
          const { alpha, beta, gamma } = userPreference.customPreference;
          const sum = alpha + beta + gamma;
          // Normalize to sum to 1
          preferenceVector = {
            alpha: alpha / sum,
            beta: beta / sum,
            gamma: gamma / sum,
          };
        } else {
          // Use pre-defined preference types
          switch (userPreference.type) {
            case 'safe':
              preferenceVector = { alpha: 0.7, beta: 0.15, gamma: 0.15 }; // High robustness
              break;
            case 'novel':
              preferenceVector = { alpha: 0.2, beta: 0.7, gamma: 0.1 }; // High novelty
              break;
            case 'diverse':
              preferenceVector = { alpha: 0.2, beta: 0.2, gamma: 0.6 }; // High diversity
              break;
            case 'balanced':
            default:
              preferenceVector = { alpha: 0.4, beta: 0.3, gamma: 0.3 }; // Balanced
              break;
          }
        }

        const userPreferenceObj: UserPreference = {
          userId: 'system', // System-level preference for pre-filtering
          preferenceVector,
          normalized: true,
        };

        // Sample outputs by preference
        const preferenceBasedOutputs = await this.statisticalDistributionService.sampleByPreference(
          monteCarloOutputs,
          contributions,
          userPreferenceObj
        );

        // Return top-N from preference-based sampling
        return preferenceBasedOutputs.slice(0, topN);
      }
    }

    // Fallback: Use top-N by total contribution score
    const topOutputs = evaluationResult.statisticalResult.topOutputs
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, topN);

    return topOutputs.map(o => o.outputId);
  }

  /**
   * Aggregate contributions across validators (weighted by calibration)
   */
  private aggregateContributions(
    validatorContributions: Map<string, Map<string, ContributionScore>>,
    calibrations: Map<string, ValidatorCalibrationMetrics>
  ): Map<string, ContributionScore> {
    const aggregated = new Map<string, ContributionScore>();
    
    // Collect all output IDs
    const allOutputIds = new Set<string>();
    for (const contributions of validatorContributions.values()) {
      for (const outputId of contributions.keys()) {
        allOutputIds.add(outputId);
      }
    }
    
    // Aggregate each output's contribution across validators
    for (const outputId of allOutputIds) {
      let totalRobustness = 0;
      let totalNovelty = 0;
      let totalDiversity = 0;
      let totalWeight = 0;
      let constraintValid = true;
      
      for (const [validatorAddress, contributions] of validatorContributions.entries()) {
        const contrib = contributions.get(outputId);
        if (!contrib) continue;
        
        const calibration = calibrations.get(validatorAddress);
        const weight = calibration?.calibrationScore || 0.5; // Weight by calibration quality
        
        totalRobustness += contrib.robustnessContribution * weight;
        totalNovelty += contrib.noveltyContribution * weight;
        totalDiversity += contrib.diversityContribution * weight;
        totalWeight += weight;
        
        if (!contrib.constraintValid) {
          constraintValid = false;
        }
      }
      
      if (totalWeight > 0) {
        const aggregatedContrib: ContributionScore = {
          outputId,
          robustnessContribution: totalRobustness / totalWeight,
          noveltyContribution: totalNovelty / totalWeight,
          diversityContribution: totalDiversity / totalWeight,
          constraintValid,
          totalContribution: (totalRobustness + totalNovelty + totalDiversity) / totalWeight,
        };
        
        aggregated.set(outputId, aggregatedContrib);
      }
    }
    
    return aggregated;
  }

  /**
   * Aggregate distributions across validators
   */
  private aggregateDistributions(
    validatorDistributions: Map<string, DistributionAnalysis>
  ): DistributionAnalysis {
    if (validatorDistributions.size === 0) {
      return {
        modes: [],
        entropy: 0,
        coverage: 0,
        diversity: 0,
        stabilityScore: 0,
        modeCount: 0,
      };
    }
    
    // Average metrics across validators
    let totalEntropy = 0;
    let totalCoverage = 0;
    let totalDiversity = 0;
    let totalStability = 0;
    let totalModes = 0;
    
    for (const distribution of validatorDistributions.values()) {
      totalEntropy += distribution.entropy;
      totalCoverage += distribution.coverage;
      totalDiversity += distribution.diversity;
      totalStability += distribution.stabilityScore;
      totalModes += distribution.modeCount;
    }
    
    const count = validatorDistributions.size;
    
    return {
      modes: [], // Modes are validator-specific, don't aggregate
      entropy: totalEntropy / count,
      coverage: totalCoverage / count,
      diversity: totalDiversity / count,
      stabilityScore: totalStability / count,
      modeCount: Math.round(totalModes / count),
    };
  }

  /**
   * Calculate method diversity score (replaces agreement score)
   */
  private calculateMethodDiversityScore(
    evaluations: ValidatorEvaluation[],
    calibrations: Map<string, ValidatorCalibrationMetrics>
  ): number {
    if (evaluations.length === 0) return 0;
    
    // Count unique methods
    const methods = new Set<string>();
    for (const eval_ of evaluations) {
      if (eval_.methodConfig) {
        methods.add(eval_.methodConfig.methodId);
      }
    }
    
    // Diversity = number of unique methods / total validators
    // Higher diversity = better (epistemic decentralization)
    return methods.size / evaluations.length;
  }

  /**
   * Consensus-based evaluation (legacy, for backward compatibility)
   * Used when distributionBased = false
   * 
   * Option 1: Rejection without slashing - invalid evaluations are rejected
   */
  private async evaluateStatisticalConsensus(
    taskId: string,
    outputs: TaskOutput[],
    evaluations: ValidatorEvaluation[],
    validatorReputations: Map<string, number>,
    manifest?: NetworkManifest,
    taskInput?: any,
    aggregatedDistribution?: DistributionAnalysis
  ): Promise<EvaluationResult> {
    // Validate and filter evaluations using reputation service
    const consensusResult = this.calculateConsensus(evaluations);
    const { validEvaluations, rejectedEvaluations, reputationUpdates } = 
      await this.validateAndFilterEvaluations(evaluations, consensusResult);

    // Log rejected evaluations
    if (rejectedEvaluations.length > 0) {
      this.logger.warn('Evaluations rejected in statistical consensus (no payment, no slashing)', {
        taskId,
        rejectedCount: rejectedEvaluations.length,
        totalCount: evaluations.length,
      });
    }

    // Use only valid evaluations
    const filteredEvaluations = validEvaluations;
    // Group evaluations by output (only valid evaluations)
    const outputEvaluations = new Map<string, ValidatorEvaluation[]>();
    for (const eval_ of filteredEvaluations) {
      if (!outputEvaluations.has(eval_.outputId)) {
        outputEvaluations.set(eval_.outputId, []);
      }
      outputEvaluations.get(eval_.outputId)!.push(eval_);
    }

    // Calculate statistical evaluation for each output
    const statisticalResults: StatisticalEvaluation[] = [];

    for (const [outputId, evals] of outputEvaluations.entries()) {
      // Weighted score (by validator reputation)
      let weightedSum = 0;
      let totalWeight = 0;
      
      for (const eval_ of evals) {
        // NEW: Calculate effective weight using multi-dimensional risk vector
        let effectiveWeight = 1.0;
        
        if (this.validatorReputationService) {
          // Get base reputation multiplier
          const baseMultiplier = this.validatorReputationService.getReputationMultiplier(
            eval_.validatorAddress
          );
          
          // Get multi-dimensional risk vector
          const riskVector = this.validatorReputationService.getRiskVector(eval_.validatorAddress);
          
          if (riskVector) {
            // Calculate effective weight from risk vector (non-linear aggregation)
            // Network state for adaptive risk weighting - NOW CALCULATED FROM ACTUAL DATA
            const networkState = this.networkStateCalculator
              ? this.networkStateCalculator.calculateNetworkState(
                  manifest || {} as NetworkManifest,
                  aggregatedDistribution, // May be undefined in consensus mode
                  outputs.map(o => o.output),
                  taskInput
                )
              : {
                  // Fallback if calculator not available
                  currentEntropy: 0.5,
                  modeCollapseDetected: false,
                  taskDifficulty: 0.5,
                  networkAge: 0,
                  maturity: 'early' as const,
                  explorationBias: 0.5,
                  reliabilityBias: 0.5,
                };
            
            effectiveWeight = this.validatorReputationService.calculateEffectiveWeight(
              riskVector,
              networkState
            );
            
            // Apply surprisal penalty if too predictable
            if (this.validatorReputationService.isSurprisalTooLow(eval_.validatorAddress)) {
              const surprisalPenalty = this.validatorReputationService.applySurprisalPenalty(
                eval_.validatorAddress
              );
              effectiveWeight = Math.max(0.0, effectiveWeight - surprisalPenalty / 100);
            }
          } else {
            // Fallback to base multiplier
            effectiveWeight = baseMultiplier;
          }
          
          // Apply temporal decay
          this.validatorReputationService.applyTemporalDecay(eval_.validatorAddress);
          
          // Apply relative risk (percentile-based)
          if (this.riskScoringService) {
            const allValidators = Array.from(validatorReputations.keys());
            const relativeRisk = this.riskScoringService.calculateRelativeRisk(
              eval_.validatorAddress,
              allValidators
            );
            // Adjust weight based on relative risk (higher percentile = higher weight)
            effectiveWeight = effectiveWeight * relativeRisk;
          }
        }
        
        // Use reputation from map if available, otherwise use effective weight
        const baseReputation = validatorReputations.get(eval_.validatorAddress) || 0.5;
        const reputation = baseReputation * effectiveWeight; // Apply effective weight
        
        const weight = reputation * eval_.confidence;
        weightedSum += eval_.score * weight;
        totalWeight += weight;
      }

      const weightedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

      // Agreement score (how much validators agree)
      const scores = evals.map(e => e.score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
      const stdDev = Math.sqrt(variance);
      const agreementScore = 1 - Math.min(stdDev / 100, 1); // Normalize to 0-1

      // Overall confidence
      const avgConfidence = evals.reduce((sum, e) => sum + e.confidence, 0) / evals.length;
      const confidence = agreementScore * avgConfidence;

      statisticalResults.push({
        outputId,
        weightedScore,
        agreementScore,
        validatorCount: evals.length,
        confidence,
        evaluations: evals,
      });
    }

    // Sort by weighted score * confidence
    statisticalResults.sort((a, b) => 
      (b.weightedScore * b.confidence) - (a.weightedScore * a.confidence)
    );

    // Consensus output (top result)
    const consensusOutput = statisticalResults[0]?.outputId || '';

    return {
      taskId,
      mode: 'statistical',
      statisticalResult: {
        topOutputs: statisticalResults,
        consensusOutput,
      },
      winningOutputId: consensusOutput,
      finalScore: statisticalResults[0]?.weightedScore || 0,
      validators: filteredEvaluations.map(e => e.validatorAddress),
    };
  }

  /**
   * Evaluate with human-in-the-loop
   * Validators pre-filter top-N, user selects final output
   * 
   * Uses contribution-based scoring from StatisticalDistributionService
   */
  evaluateHumanInTheLoop(
    taskId: string,
    statisticalResult: EvaluationResult,
    humanSelection: HumanSelection,
    topN: number = 3,
    userSelectionWeight: number = 0.1 // Default 10% boost from user selection
  ): EvaluationResult {
    // Get pre-filtered outputs (should match what was shown to user)
    const preFilteredIds = humanSelection.preFilteredOutputs || [];
    
    // Verify user selected from pre-filtered outputs
    if (!preFilteredIds.includes(humanSelection.selectedOutputId)) {
      throw new Error('User selection must be from validator pre-filtered outputs');
    }

    // Get contribution score for selected output (from distribution-based evaluation)
    const statisticalResultExtended = statisticalResult.statisticalResult as any;
    const contributions = statisticalResultExtended.contributions as ContributionScore[] | undefined;
    const aggregatedContributionsMap = statisticalResultExtended.aggregatedContributionsMap as Map<string, ContributionScore> | undefined;
    
    // Find contribution score for selected output
    let baseContribution = 0;
    let contributionScore: ContributionScore | undefined;
    
    if (aggregatedContributionsMap) {
      contributionScore = aggregatedContributionsMap.get(humanSelection.selectedOutputId);
      baseContribution = contributionScore?.totalContribution || 0;
    } else if (contributions) {
      contributionScore = contributions.find(c => c.outputId === humanSelection.selectedOutputId);
      baseContribution = contributionScore?.totalContribution || 0;
    }
    
    // Fallback to weighted score if contribution not available
    if (baseContribution === 0) {
      const topOutputs = statisticalResult.statisticalResult?.topOutputs || [];
      const selectedOutput = topOutputs.find(o => o.outputId === humanSelection.selectedOutputId);
      baseContribution = (selectedOutput?.weightedScore || 0) / 100; // Normalize from 0-100 to 0-1
    }
    
    // Convert contribution to score (0-100 scale)
    const baseScore = baseContribution * 100;
    
    // User selection adds confidence boost (but not absolute authority)
    // The weight is passed as parameter (from manifest.humanInTheLoop.userSelectionWeight)
    // This ensures user choice influences reward but doesn't override validator consensus
    // Pattern: Validators pre-filter → User selects → Reward calculated
    const userBoost = baseScore * userSelectionWeight;
    const finalScore = Math.min(baseScore + userBoost, 100);
    
    // CRITICAL: User selection is input to reward, NOT absolute authority
    // - Validators pre-filter to top-N (only valid outputs)
    // - User selects from validator-approved outputs only
    // - User choice adds boost but doesn't override validator consensus
    // - This prevents user-only judging while allowing preference input
    // - Uses contribution-based scoring (robustness, novelty, diversity) not just agreement

    this.logger.info('Human-in-the-loop evaluation complete', {
      taskId,
      selectedOutputId: humanSelection.selectedOutputId,
      baseContribution,
      baseScore,
      userBoost,
      finalScore,
      contributionBreakdown: contributionScore ? {
        robustness: contributionScore.robustnessContribution,
        novelty: contributionScore.noveltyContribution,
        diversity: contributionScore.diversityContribution,
      } : undefined,
    });

    return {
      taskId,
      mode: 'human-in-the-loop',
      statisticalResult: statisticalResult.statisticalResult,
      humanSelection,
      winningOutputId: humanSelection.selectedOutputId,
      finalScore,
      validators: statisticalResult.validators,
    };
  }

  /**
   * Generate replay hash for deterministic tasks
   * Hash(input + seed + scoringModuleHash)
   */
  private generateReplayHash(input: any, seed: string, scoringModuleHash: string): string {
    const inputStr = JSON.stringify(input, Object.keys(input).sort());
    const combined = `${inputStr}:${seed}:${scoringModuleHash}`;
    return createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Verify intermediate step hashes
   * For pipeline tasks, verify each step is hashed correctly
   */
  verifyPipelineHashes(
    output: TaskOutput,
    expectedSteps: string[]
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const hashes = output.metadata?.intermediateHashes || [];

    if (hashes.length !== expectedSteps.length) {
      errors.push(`Expected ${expectedSteps.length} intermediate hashes, got ${hashes.length}`);
    }

    // Verify each step hash
    for (let i = 0; i < Math.min(hashes.length, expectedSteps.length); i++) {
      const expectedHash = createHash('sha256')
        .update(JSON.stringify(expectedSteps[i]))
        .digest('hex');
      
      if (hashes[i] !== expectedHash) {
        errors.push(`Step ${i} hash mismatch`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Calculate agreement metrics
   * Measures how much validators agree on outputs
   */
  calculateAgreementMetrics(
    evaluations: ValidatorEvaluation[]
  ): {
    overallAgreement: number;      // 0-1, how much validators agree
    outputAgreement: Map<string, number>; // Per-output agreement
    validatorConsensus: Map<string, number>; // Per-validator consensus with others
  } {
    // Group by output
    const outputGroups = new Map<string, ValidatorEvaluation[]>();
    for (const eval_ of evaluations) {
      if (!outputGroups.has(eval_.outputId)) {
        outputGroups.set(eval_.outputId, []);
      }
      outputGroups.get(eval_.outputId)!.push(eval_);
    }

    // Calculate per-output agreement
    const outputAgreement = new Map<string, number>();
    for (const [outputId, evals] of outputGroups.entries()) {
      const scores = evals.map(e => e.score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
      const stdDev = Math.sqrt(variance);
      const agreement = 1 - Math.min(stdDev / 100, 1);
      outputAgreement.set(outputId, agreement);
    }

    // Calculate overall agreement
    const agreements = Array.from(outputAgreement.values());
    const overallAgreement = agreements.reduce((a, b) => a + b, 0) / agreements.length;

    // Calculate per-validator consensus (how much they agree with others)
    const validatorConsensus = new Map<string, number>();
    for (const eval_ of evaluations) {
      const outputEvals = outputGroups.get(eval_.outputId) || [];
      const otherEvals = outputEvals.filter(e => e.validatorAddress !== eval_.validatorAddress);
      
      if (otherEvals.length > 0) {
        const otherScores = otherEvals.map(e => e.score);
        const otherMean = otherScores.reduce((a, b) => a + b, 0) / otherScores.length;
        const deviation = Math.abs(eval_.score - otherMean);
        const consensus = 1 - Math.min(deviation / 100, 1);
        validatorConsensus.set(eval_.validatorAddress, consensus);
      } else {
        validatorConsensus.set(eval_.validatorAddress, 0.5); // Neutral if no other validators
      }
    }

    return {
      overallAgreement,
      outputAgreement,
      validatorConsensus,
    };
  }
}
