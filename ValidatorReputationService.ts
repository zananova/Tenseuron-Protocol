/**
 * Validator Reputation Service
 * 
 * Implements reputation tracking and updates for validators.
 * 
 * Core Principle: "Option 1 - Rejection without Slashing"
 * - Invalid evaluations are rejected (no payment)
 * - No funds are taken from validators
 * - Reputation is updated based on performance
 * - Low reputation = lower future rewards (soft enforcement)
 * - Very low reputation = temporary ban (no slashing)
 * 
 * This service tracks:
 * - Validation accuracy
 * - Consistency
 * - Reliability
 * - Failure patterns
 */

import { ILogger } from './utils/ILogger';
import { ValidatorEvaluation } from './EvaluationService';
import { RiskVector, TaskConditionedReputation, NetworkState } from './types';
import { AdversarialTestResult } from './AdversarialTestingService';
import { getInvariantChecker } from './InvariantChecker';

/**
 * Validator Reputation Metrics
 */
export interface ValidatorReputationMetrics {
  validatorAddress: string;
  
  // Reputation score (0-100)
  reputation: number;
  
  // Performance metrics
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  rejectedValidations: number;  // Invalid evaluations (rejected, no payment)
  
  // Accuracy metrics
  accuracy: number;              // successfulValidations / totalValidations (0-1)
  consistency: number;          // How consistent evaluations are (0-1)
  
  // Failure tracking
  consecutiveFailures: number;  // Consecutive failed/rejected validations
  totalFailures: number;        // Total failures (for ban threshold)
  
  // Status
  isBanned: boolean;
  banUntil?: number;            // Unix timestamp when ban expires
  banReason?: string;
  
  // Timestamps
  lastValidation: number;
  lastFailure: number;
  createdAt: number;
  updatedAt: number;
  
  // NEW: Multi-dimensional risk vector
  riskVector?: RiskVector;
  
  // NEW: Task-conditioned reputation (per network/task type)
  taskConditionedReputations?: Map<string, TaskConditionedReputation>; // key: networkId:taskType
  
  // NEW: Surprisal tracking (for unpredictability)
  surprisalHistory: number[];   // History of surprisal scores (entropy)
  averageSurprisal: number;    // Average surprisal (0-1)
  
  // NEW: Temporal decay factor
  temporalDecay: number;         // Decay factor (0-1, lower = more decay)
  lastDecayUpdate: number;      // Last time decay was applied
}

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  shouldReject: boolean;        // Whether to reject (no payment)
  reputationPenalty?: number;   // Reputation points to deduct (0-100)
  shouldBan?: boolean;          // Whether to apply temporary ban
  banDuration?: number;         // Ban duration in seconds
}

/**
 * Reputation Update Result
 */
export interface ReputationUpdateResult {
  validatorAddress: string;
  oldReputation: number;
  newReputation: number;
  reputationChange: number;
  wasRejected: boolean;
  wasBanned: boolean;
  banUntil?: number;
}

/**
 * Validator Reputation Service
 */
export class ValidatorReputationService {
  private logger: ILogger;
  private reputationMetrics: Map<string, ValidatorReputationMetrics> = new Map();
  
  // Configuration
  private readonly DEFAULT_REPUTATION = 50;        // Starting reputation (neutral)
  private readonly MIN_REPUTATION = 0;             // Minimum reputation
  private readonly MAX_REPUTATION = 100;           // Maximum reputation
  
  // Reputation changes
  private readonly SUCCESS_BOOST = 1;              // Reputation increase per successful validation
  private readonly FAILURE_PENALTY = 5;             // Reputation decrease per failed validation
  private readonly REJECTION_PENALTY = 10;         // Reputation decrease per rejected validation
  
  // Ban thresholds
  private readonly BAN_THRESHOLD_REPUTATION = 20;   // Ban if reputation drops below this
  private readonly BAN_THRESHOLD_FAILURES = 5;     // Ban after N consecutive failures
  private readonly DEFAULT_BAN_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  
  // Recovery
  private readonly RECOVERY_RATE = 0.1;            // Reputation recovery per successful validation (10%)
  
  // NEW: Temporal decay configuration
  private readonly TEMPORAL_DECAY_RATE = 0.95;     // Decay factor per day (0.95 = 5% decay per day)
  private readonly DECAY_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // Update decay every 24 hours
  
  // NEW: Surprisal configuration
  private readonly MIN_SURPRISAL = 0.3;            // Minimum surprisal to avoid penalty (0-1)
  private readonly SURPRISAL_HISTORY_SIZE = 100;  // Keep last N surprisal scores
  
  // NEW: Risk vector weights (for aggregation)
  private readonly RISK_VECTOR_WEIGHTS = {
    exploration: 0.2,
    consistency: 0.2,
    reliability: 0.2,
    diversity: 0.15,
    surprisal: 0.15,
    temporalStability: 0.05,
    adversarialResistance: 0.05,
  };
  
  constructor(logger?: Logger) {
    this.logger = logger || new Logger('ValidatorReputationService');
  }

  /**
   * Validate evaluation and determine if it should be rejected
   * 
   * Option 1: Rejection without slashing
   * - Invalid evaluations are rejected (no payment)
   * - No funds are taken
   * - Reputation is penalized
   */
  validateEvaluation(
    evaluation: ValidatorEvaluation,
    consensusResult: {
      accepted: boolean;
      consensusReached: boolean;
      majorityScore: number;
    }
  ): ValidationResult {
    // Check if evaluation is valid
    const isValid = this.isEvaluationValid(evaluation, consensusResult);
    
    if (!isValid) {
      // REJECT (Option 1: No slashing, just rejection)
      return {
        valid: false,
        reason: 'Evaluation does not match consensus or is invalid',
        shouldReject: true,
        reputationPenalty: this.REJECTION_PENALTY,
      };
    }
    
    // Check if validator agreed with consensus
    const agreedWithConsensus = this.agreedWithConsensus(evaluation, consensusResult);
    
    if (!agreedWithConsensus) {
      // Failed validation (disagreed with consensus)
      return {
        valid: true,
        reason: 'Evaluation disagreed with consensus',
        shouldReject: false,  // Still paid, but reputation penalty
        reputationPenalty: this.FAILURE_PENALTY,
      };
    }
    
    // Successful validation
    return {
      valid: true,
      shouldReject: false,
      // Reputation boost handled separately in updateReputation()
    };
  }

  /**
   * Check if evaluation is valid
   */
  private isEvaluationValid(
    evaluation: ValidatorEvaluation,
    consensusResult: {
      accepted: boolean;
      consensusReached: boolean;
      majorityScore: number;
    }
  ): boolean {
    // Basic validation checks
    if (!evaluation.validatorAddress) return false;
    if (!evaluation.outputId) return false;
    if (evaluation.score < 0 || evaluation.score > 100) return false;
    if (evaluation.confidence < 0 || evaluation.confidence > 1) return false;
    if (!evaluation.signature) return false;
    
    // If consensus reached, check if evaluation is reasonable
    if (consensusResult.consensusReached) {
      const scoreDifference = Math.abs(evaluation.score - consensusResult.majorityScore);
      // If score difference is too large, might be invalid
      if (scoreDifference > 50) {
        return false; // Suspicious evaluation
      }
    }
    
    return true;
  }

  /**
   * Check if validator agreed with consensus
   */
  private agreedWithConsensus(
    evaluation: ValidatorEvaluation,
    consensusResult: {
      accepted: boolean;
      consensusReached: boolean;
      majorityScore: number;
    }
  ): boolean {
    if (!consensusResult.consensusReached) {
      return true; // No consensus, can't determine agreement
    }
    
    // Check if evaluation score is close to majority score
    const scoreDifference = Math.abs(evaluation.score - consensusResult.majorityScore);
    const threshold = 10; // Within 10 points is considered agreement
    
    return scoreDifference <= threshold;
  }

  /**
   * Update validator reputation based on validation result
   * 
   * Option 1: Rejection without slashing
   * - Successful validations → reputation increase
   * - Failed validations → reputation decrease
   * - Rejected validations → reputation decrease (no payment)
   * - Very low reputation → temporary ban (no slashing)
   */
  async updateReputation(
    validatorAddress: string,
    validationResult: ValidationResult,
    wasSuccessful: boolean
  ): Promise<ReputationUpdateResult> {
    // Get current reputation metrics
    let metrics = this.reputationMetrics.get(validatorAddress);
    
    if (!metrics) {
      // Initialize new validator
      metrics = this.initializeValidator(validatorAddress);
    }
    
    const oldReputation = metrics.reputation;
    let newReputation = oldReputation;
    let wasRejected = false;
    let wasBanned = false;
    let banUntil: number | undefined;
    
    // Update based on validation result
    if (validationResult.shouldReject) {
      // REJECTED (Option 1: No payment, no slashing)
      wasRejected = true;
      metrics.rejectedValidations++;
      metrics.totalFailures++;
      metrics.consecutiveFailures++;
      
      // Apply reputation penalty
      if (validationResult.reputationPenalty) {
        newReputation = Math.max(
          this.MIN_REPUTATION,
          newReputation - validationResult.reputationPenalty
        );
      }
      
      this.logger.warn('Validator evaluation rejected (no payment, no slashing)', {
        validatorAddress,
        reason: validationResult.reason,
        reputationPenalty: validationResult.reputationPenalty,
        oldReputation,
        newReputation,
      });
    } else if (wasSuccessful) {
      // SUCCESSFUL
      metrics.successfulValidations++;
      metrics.consecutiveFailures = 0; // Reset consecutive failures
      
      // Apply reputation boost
      newReputation = Math.min(
        this.MAX_REPUTATION,
        newReputation + this.SUCCESS_BOOST
      );
      
      // Recovery: If reputation was low, apply recovery rate
      if (oldReputation < 50) {
        const recovery = (50 - oldReputation) * this.RECOVERY_RATE;
        newReputation = Math.min(
          this.MAX_REPUTATION,
          newReputation + recovery
        );
      }
    } else {
      // FAILED (disagreed with consensus, but still paid)
      metrics.failedValidations++;
      metrics.totalFailures++;
      metrics.consecutiveFailures++;
      
      // Apply reputation penalty
      if (validationResult.reputationPenalty) {
        newReputation = Math.max(
          this.MIN_REPUTATION,
          newReputation - validationResult.reputationPenalty
        );
      }
    }
    
    // Update metrics
    metrics.reputation = newReputation;
    metrics.totalValidations++;
    metrics.accuracy = metrics.successfulValidations / metrics.totalValidations;
    metrics.lastValidation = Date.now();

    // Runtime invariant check: reputation must be in [0, 100]
    const invariantChecker = getInvariantChecker();
    invariantChecker.checkReputationBounds(
      'ValidatorReputationService.updateReputation',
      newReputation
    );
    
    if (!wasSuccessful) {
      metrics.lastFailure = Date.now();
    }
    
    // Check if should ban
    if (this.shouldBan(metrics, validationResult)) {
      wasBanned = true;
      const banDuration = validationResult.banDuration || this.DEFAULT_BAN_DURATION;
      banUntil = Date.now() + banDuration;
      
      metrics.isBanned = true;
      metrics.banUntil = banUntil;
      metrics.banReason = validationResult.reason || 'Low reputation or repeated failures';
      
      this.logger.warn('Validator temporarily banned (no slashing)', {
        validatorAddress,
        reason: metrics.banReason,
        banUntil: new Date(banUntil).toISOString(),
        reputation: newReputation,
      });
    }
    
    // Update timestamps
    metrics.updatedAt = Date.now();
    
    // Store updated metrics
    this.reputationMetrics.set(validatorAddress, metrics);
    
    return {
      validatorAddress,
      oldReputation,
      newReputation,
      reputationChange: newReputation - oldReputation,
      wasRejected,
      wasBanned,
      banUntil,
    };
  }

  /**
   * Check if validator should be banned
   */
  private shouldBan(
    metrics: ValidatorReputationMetrics,
    validationResult: ValidationResult
  ): boolean {
    // Already banned
    if (metrics.isBanned) {
      if (metrics.banUntil && Date.now() < metrics.banUntil) {
        return false; // Still banned
      }
      // Ban expired, check if should re-ban
      metrics.isBanned = false;
      metrics.banUntil = undefined;
    }
    
    // Check ban thresholds
    if (metrics.reputation < this.BAN_THRESHOLD_REPUTATION) {
      return true; // Reputation too low
    }
    
    if (metrics.consecutiveFailures >= this.BAN_THRESHOLD_FAILURES) {
      return true; // Too many consecutive failures
    }
    
    if (validationResult.shouldBan) {
      return true; // Explicit ban requested
    }
    
    return false;
  }

  /**
   * Initialize new validator
   */
  private initializeValidator(validatorAddress: string): ValidatorReputationMetrics {
    const now = Date.now();
    
    return {
      validatorAddress,
      reputation: this.DEFAULT_REPUTATION,
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      rejectedValidations: 0,
      accuracy: 0,
      consistency: 1, // Start with perfect consistency
      consecutiveFailures: 0,
      totalFailures: 0,
      isBanned: false,
      lastValidation: now,
      lastFailure: 0,
      createdAt: now,
      updatedAt: now,
      // NEW: Initialize multi-dimensional risk vector
      riskVector: {
        exploration: 0.5,
        consistency: 0.5,
        reliability: 0.5,
        diversity: 0.5,
        surprisal: 0.5,
        temporalStability: 0.5,
        adversarialResistance: 0.5,
      },
      taskConditionedReputations: new Map(),
      surprisalHistory: [],
      averageSurprisal: 0.5,
      temporalDecay: 1.0, // Start with no decay
      lastDecayUpdate: now,
    };
  }

  /**
   * Get validator reputation
   */
  getReputation(validatorAddress: string): ValidatorReputationMetrics | null {
    return this.reputationMetrics.get(validatorAddress) || null;
  }

  /**
   * Get reputation multiplier for reward calculation
   * 
   * High reputation → 1.0x-2.0x multiplier
   * Medium reputation → 0.5x-1.0x multiplier
   * Low reputation → 0.1x-0.5x multiplier
   * Very low reputation → 0x (banned)
   */
  getReputationMultiplier(validatorAddress: string): number {
    const metrics = this.reputationMetrics.get(validatorAddress);
    
    if (!metrics) {
      return 0.5; // Default for new validators
    }
    
    // Check if banned
    if (metrics.isBanned) {
      if (metrics.banUntil && Date.now() < metrics.banUntil) {
        return 0; // Banned, no rewards
      }
      // Ban expired
      metrics.isBanned = false;
      metrics.banUntil = undefined;
    }
    
    // Calculate multiplier based on reputation
    // Linear mapping: 0-100 reputation → 0.1-2.0 multiplier
    const reputation = metrics.reputation;
    
    if (reputation >= 80) {
      // High reputation: 1.0x - 2.0x
      return 1.0 + ((reputation - 80) / 20) * 1.0; // 1.0 to 2.0
    } else if (reputation >= 50) {
      // Medium reputation: 0.5x - 1.0x
      return 0.5 + ((reputation - 50) / 30) * 0.5; // 0.5 to 1.0
    } else if (reputation >= 20) {
      // Low reputation: 0.1x - 0.5x
      return 0.1 + ((reputation - 20) / 30) * 0.4; // 0.1 to 0.5
    } else {
      // Very low reputation: 0x (effectively banned)
      return 0;
    }
  }

  /**
   * Check if validator is eligible to validate
   */
  isEligible(validatorAddress: string): boolean {
    const metrics = this.reputationMetrics.get(validatorAddress);
    
    if (!metrics) {
      return true; // New validators are eligible
    }
    
    // Check if banned
    if (metrics.isBanned) {
      if (metrics.banUntil && Date.now() < metrics.banUntil) {
        return false; // Still banned
      }
      // Ban expired
      metrics.isBanned = false;
      metrics.banUntil = undefined;
      return true;
    }
    
    // Check reputation threshold
    if (metrics.reputation < this.BAN_THRESHOLD_REPUTATION) {
      return false; // Reputation too low
    }
    
    return true;
  }

  /**
   * Get all validator reputations
   */
  getAllReputations(): Map<string, ValidatorReputationMetrics> {
    return new Map(this.reputationMetrics);
  }

  /**
   * Reset validator reputation (for testing/admin)
   */
  resetReputation(validatorAddress: string): void {
    this.reputationMetrics.delete(validatorAddress);
    this.logger.info('Validator reputation reset', { validatorAddress });
  }

  // ========== NEW: Multi-Dimensional Risk Vector Methods ==========

  /**
   * Get multi-dimensional risk vector for validator
   */
  getRiskVector(validatorAddress: string): RiskVector | null {
    const metrics = this.reputationMetrics.get(validatorAddress);
    return metrics?.riskVector || null;
  }

  /**
   * Update risk vector based on validation result
   */
  updateRiskVector(
    validatorAddress: string,
    validationResult: {
      wasSuccessful: boolean;
      outputDiversity?: number;      // Diversity of outputs evaluated
      surprisal?: number;            // Surprisal score for this validation
      adversarialTestResult?: AdversarialTestResult; // Result from adversarial test
    },
    networkState?: NetworkState
  ): RiskVector {
    let metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics) {
      metrics = this.initializeValidator(validatorAddress);
    }

    if (!metrics.riskVector) {
      metrics.riskVector = {
        exploration: 0.5,
        consistency: 0.5,
        reliability: 0.5,
        diversity: 0.5,
        surprisal: 0.5,
        temporalStability: 0.5,
        adversarialResistance: 0.5,
      };
    }

    const riskVector = metrics.riskVector;
    const alpha = 0.1; // Learning rate

    // Update reliability (success rate)
    if (validationResult.wasSuccessful) {
      riskVector.reliability = Math.min(1.0, riskVector.reliability + alpha * 0.1);
    } else {
      riskVector.reliability = Math.max(0.0, riskVector.reliability - alpha * 0.2);
    }

    // Update diversity
    if (validationResult.outputDiversity !== undefined) {
      riskVector.diversity = alpha * validationResult.outputDiversity + (1 - alpha) * riskVector.diversity;
    }

    // Update surprisal
    if (validationResult.surprisal !== undefined) {
      // Add to history
      metrics.surprisalHistory.push(validationResult.surprisal);
      if (metrics.surprisalHistory.length > this.SURPRISAL_HISTORY_SIZE) {
        metrics.surprisalHistory.shift();
      }
      // Update average
      metrics.averageSurprisal = metrics.surprisalHistory.reduce((a, b) => a + b, 0) / metrics.surprisalHistory.length;
      riskVector.surprisal = metrics.averageSurprisal;
    }

    // Update adversarial resistance
    if (validationResult.adversarialTestResult) {
      if (validationResult.adversarialTestResult.passed) {
        riskVector.adversarialResistance = Math.min(1.0, riskVector.adversarialResistance + alpha * 0.2);
      } else {
        riskVector.adversarialResistance = Math.max(0.0, riskVector.adversarialResistance - alpha * 0.3);
      }
    }

    // Update exploration (based on network state)
    if (networkState) {
      // If network needs exploration, reward it
      if (networkState.explorationBias > 0.5) {
        riskVector.exploration = Math.min(1.0, riskVector.exploration + alpha * 0.1);
      }
    }

    // Update temporal stability (consistency over time)
    riskVector.temporalStability = this.calculateTemporalStability(metrics);

    // Update consistency (variance in scores)
    riskVector.consistency = metrics.consistency;

    metrics.riskVector = riskVector;
    this.reputationMetrics.set(validatorAddress, metrics);

    // Runtime invariant check: risk vector dimensions must be in [0, 1]
    const invariantChecker = getInvariantChecker();
    invariantChecker.checkRiskVectorBounds(
      'ValidatorReputationService.updateRiskVector',
      riskVector
    );

    return riskVector;
  }

  /**
   * Calculate temporal stability (consistency over time)
   */
  private calculateTemporalStability(metrics: ValidatorReputationMetrics): number {
    // Simple heuristic: more validations = more stable
    if (metrics.totalValidations < 10) {
      return 0.5; // Not enough data
    }
    
    // Stability increases with successful validations
    const successRate = metrics.successfulValidations / metrics.totalValidations;
    return successRate;
  }

  /**
   * Calculate effective weight from risk vector
   * Uses non-linear aggregation to prevent single-metric optimization
   */
  calculateEffectiveWeight(riskVector: RiskVector, networkState?: NetworkState): number {
    // Non-linear aggregation: geometric mean of key dimensions
    const keyDimensions = [
      riskVector.reliability,
      riskVector.surprisal,
      riskVector.adversarialResistance,
    ];
    
    const geometricMean = Math.pow(
      keyDimensions.reduce((a, b) => a * b, 1),
      1 / keyDimensions.length
    );
    
    // Apply network state bias
    let weight = geometricMean;
    if (networkState) {
      if (networkState.explorationBias > 0.5) {
        // Reward exploration
        weight = weight * (0.8 + 0.2 * riskVector.exploration);
      } else {
        // Reward reliability
        weight = weight * (0.8 + 0.2 * riskVector.reliability);
      }
    }
    
    return Math.max(0.0, Math.min(1.0, weight));
  }

  // ========== NEW: Task-Conditioned Reputation Methods ==========

  /**
   * Get task-conditioned reputation
   */
  getTaskConditionedReputation(
    validatorAddress: string,
    networkId: string,
    taskType: string
  ): TaskConditionedReputation | null {
    const metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics || !metrics.taskConditionedReputations) {
      return null;
    }
    
    const key = `${networkId}:${taskType}`;
    return metrics.taskConditionedReputations.get(key) || null;
  }

  /**
   * Update task-conditioned reputation
   */
  updateTaskConditionedReputation(
    validatorAddress: string,
    networkId: string,
    taskType: string,
    wasSuccessful: boolean
  ): TaskConditionedReputation {
    let metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics) {
      metrics = this.initializeValidator(validatorAddress);
    }

    if (!metrics.taskConditionedReputations) {
      metrics.taskConditionedReputations = new Map();
    }

    const key = `${networkId}:${taskType}`;
    let taskRep = metrics.taskConditionedReputations.get(key);

    if (!taskRep) {
      // Initialize new task-conditioned reputation
      taskRep = {
        validatorAddress,
        networkId,
        taskType,
        reputation: this.DEFAULT_REPUTATION,
        riskVector: {
          exploration: 0.5,
          consistency: 0.5,
          reliability: 0.5,
          diversity: 0.5,
          surprisal: 0.5,
          temporalStability: 0.5,
          adversarialResistance: 0.5,
        },
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        lastActivity: Date.now(),
        temporalDecay: 1.0,
      };
    }

    // Update reputation
    if (wasSuccessful) {
      taskRep.reputation = Math.min(100, taskRep.reputation + this.SUCCESS_BOOST);
      taskRep.successfulTasks++;
    } else {
      taskRep.reputation = Math.max(0, taskRep.reputation - this.FAILURE_PENALTY);
      taskRep.failedTasks++;
    }

    taskRep.totalTasks++;
    taskRep.lastActivity = Date.now();

    // Apply temporal decay
    const daysSinceActivity = (Date.now() - taskRep.lastActivity) / (24 * 60 * 60 * 1000);
    taskRep.temporalDecay = Math.pow(this.TEMPORAL_DECAY_RATE, daysSinceActivity);

    metrics.taskConditionedReputations.set(key, taskRep);
    this.reputationMetrics.set(validatorAddress, metrics);

    return taskRep;
  }

  // ========== NEW: Surprisal Calculation Methods ==========

  /**
   * Calculate surprisal (unpredictability) for validator
   * Higher surprisal = more unpredictable = better (prevents conservative farming)
   */
  calculateSurprisal(
    validatorAddress: string,
    output: any,
    taskType: string
  ): number {
    const metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics) {
      return 0.5; // Default surprisal for new validators
    }

    // Simple surprisal calculation: entropy of output distribution
    // In practice, this would use more sophisticated methods
    const outputHash = this.hashOutput(output);
    const hashEntropy = this.calculateEntropy(outputHash);
    
    // Normalize to 0-1
    return Math.min(1.0, hashEntropy / 8.0); // Assuming 8 bits of entropy max
  }

  /**
   * Check if surprisal is too low (predictable = bad)
   */
  isSurprisalTooLow(validatorAddress: string): boolean {
    const metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics) {
      return false;
    }

    return metrics.averageSurprisal < this.MIN_SURPRISAL;
  }

  /**
   * Apply surprisal penalty to reputation
   */
  applySurprisalPenalty(validatorAddress: string): number {
    const metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics || !this.isSurprisalTooLow(validatorAddress)) {
      return 0;
    }

    // Penalty proportional to how low surprisal is
    const penalty = (this.MIN_SURPRISAL - metrics.averageSurprisal) * 10;
    return Math.max(0, Math.min(20, penalty)); // Cap at 20 points
  }

  // ========== NEW: Temporal Decay Methods ==========

  /**
   * Apply temporal decay to reputation
   * Reputation decays over time unless reinforced
   */
  applyTemporalDecay(validatorAddress: string): void {
    const metrics = this.reputationMetrics.get(validatorAddress);
    if (!metrics) {
      return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - metrics.lastDecayUpdate;

    if (timeSinceLastUpdate < this.DECAY_UPDATE_INTERVAL) {
      return; // Too soon to update
    }

    // Calculate decay
    const daysSinceUpdate = timeSinceLastUpdate / (24 * 60 * 60 * 1000);
    const decayFactor = Math.pow(this.TEMPORAL_DECAY_RATE, daysSinceUpdate);
    
    metrics.temporalDecay = decayFactor;
    metrics.lastDecayUpdate = now;

    // Apply decay to reputation (soft decay, not hard)
    // Only decay if no recent activity
    const daysSinceActivity = (now - metrics.lastValidation) / (24 * 60 * 60 * 1000);
    if (daysSinceActivity > 7) {
      // Decay reputation if inactive for 7+ days
      const decayAmount = (1 - decayFactor) * 5; // Max 5 points decay
      metrics.reputation = Math.max(this.MIN_REPUTATION, metrics.reputation - decayAmount);
    }

    this.reputationMetrics.set(validatorAddress, metrics);
  }

  // ========== Helper Methods ==========

  private hashOutput(output: any): string {
    const str = JSON.stringify(output);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private calculateEntropy(hash: string): number {
    // Simple entropy calculation based on character distribution
    const charCounts = new Map<string, number>();
    for (const char of hash) {
      charCounts.set(char, (charCounts.get(char) || 0) + 1);
    }
    
    let entropy = 0;
    const length = hash.length;
    for (const count of charCounts.values()) {
      const p = count / length;
      entropy -= p * Math.log2(p);
    }
    
    return entropy;
  }
}
