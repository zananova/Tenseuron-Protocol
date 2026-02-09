/**
 * Validator Calibration Service
 * 
 * Implements validator calibration based on estimator quality, not agreement.
 * 
 * Core Principle: Validators are rewarded for:
 * - Estimator stability
 * - Resistance to manipulation
 * - Predictive consistency under resampling
 * 
 * NOT for agreeing with other validators.
 * 
 * This preserves epistemic decentralization by allowing multiple valid interpretations.
 */

import { ILogger } from './utils/ILogger';
import { ValidatorEvaluation, ValidatorMethodConfig } from './EvaluationService';
import { DistributionAnalysis, ContributionScore } from './StatisticalDistributionService';

/**
 * Validator Calibration Metrics
 */
export interface ValidatorCalibrationMetrics {
  validatorAddress: string;
  methodConfig: ValidatorMethodConfig;
  
  // Estimator quality metrics
  stabilityScore: number;           // How stable estimates are across resampling (0-1)
  manipulationResistance: number;   // Resistance to adversarial inputs (0-1)
  predictiveConsistency: number;    // Consistency of predictions over time (0-1)
  
  // Historical performance
  totalEvaluations: number;
  averageStability: number;
  averageConsistency: number;
  
  // Method diversity contribution
  methodUniqueness: number;         // How unique this method is (0-1)
  
  // Overall calibration score
  calibrationScore: number;         // Weighted combination of all metrics (0-1)
  
  // Last updated
  lastUpdated: number;
}

/**
 * Method Diversity Analysis
 */
export interface MethodDiversityAnalysis {
  totalValidators: number;
  uniqueMethods: number;
  methodDistribution: Map<string, number>; // methodId -> count
  diversityScore: number;                  // Shannon entropy of method distribution (0-1)
  requiresDiversity: boolean;              // Whether diversity requirements are met
}

export class ValidatorCalibrationService {
  private logger: ILogger;
  private calibrationMetrics: Map<string, ValidatorCalibrationMetrics> = new Map();
  private historicalEvaluations: Map<string, ValidatorEvaluation[]> = new Map();
  
  // Minimum diversity requirements
  private readonly MIN_METHOD_DIVERSITY = 0.3; // Minimum Shannon entropy
  private readonly MIN_UNIQUE_METHODS = 2;     // Minimum unique methods required

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  /**
   * Calibrate validators based on estimator quality
   * NOT based on agreement with other validators
   */
  calibrateValidators(
    evaluations: ValidatorEvaluation[],
    allDistributions: Map<string, DistributionAnalysis>, // validator -> distribution
    allContributions: Map<string, Map<string, ContributionScore>> // validator -> outputId -> contribution
  ): Map<string, ValidatorCalibrationMetrics> {
    const calibrations = new Map<string, ValidatorCalibrationMetrics>();
    
    // Group evaluations by validator
    const validatorEvaluations = new Map<string, ValidatorEvaluation[]>();
    for (const eval_ of evaluations) {
      if (!validatorEvaluations.has(eval_.validatorAddress)) {
        validatorEvaluations.set(eval_.validatorAddress, []);
      }
      validatorEvaluations.get(eval_.validatorAddress)!.push(eval_);
    }
    
    // Analyze method diversity
    const diversityAnalysis = this.analyzeMethodDiversity(evaluations);
    
    // Calibrate each validator
    for (const [validatorAddress, evals] of validatorEvaluations.entries()) {
      const methodConfig = evals[0]?.methodConfig;
      if (!methodConfig) {
        this.logger.warn('Validator evaluation missing method config', { validatorAddress });
        continue;
      }
      
      const distribution = allDistributions.get(validatorAddress);
      const contributions = allContributions.get(validatorAddress);
      
      if (!distribution || !contributions) {
        this.logger.warn('Validator missing distribution or contributions', { validatorAddress });
        continue;
      }
      
      // Calculate calibration metrics
      const stability = this.calculateStability(validatorAddress, distribution, contributions);
      const manipulationResistance = this.calculateManipulationResistance(validatorAddress, evals);
      const predictiveConsistency = this.calculatePredictiveConsistency(validatorAddress, evals);
      const methodUniqueness = this.calculateMethodUniqueness(methodConfig, diversityAnalysis);
      
      // Get historical metrics
      const historical = this.calibrationMetrics.get(validatorAddress);
      const totalEvaluations = (historical?.totalEvaluations || 0) + evals.length;
      const averageStability = historical
        ? (historical.averageStability * historical.totalEvaluations + stability) / totalEvaluations
        : stability;
      const averageConsistency = historical
        ? (historical.averageConsistency * historical.totalEvaluations + predictiveConsistency) / totalEvaluations
        : predictiveConsistency;
      
      // Overall calibration score (weighted combination)
      const weights = {
        stability: 0.3,
        manipulationResistance: 0.25,
        predictiveConsistency: 0.25,
        methodUniqueness: 0.2,
      };
      
      const calibrationScore = 
        weights.stability * stability +
        weights.manipulationResistance * manipulationResistance +
        weights.predictiveConsistency * predictiveConsistency +
        weights.methodUniqueness * methodUniqueness;
      
      const metrics: ValidatorCalibrationMetrics = {
        validatorAddress,
        methodConfig,
        stabilityScore: stability,
        manipulationResistance,
        predictiveConsistency,
        totalEvaluations,
        averageStability,
        averageConsistency,
        methodUniqueness,
        calibrationScore,
        lastUpdated: Date.now(),
      };
      
      calibrations.set(validatorAddress, metrics);
      this.calibrationMetrics.set(validatorAddress, metrics);
      
      // Store historical evaluations
      const historicalEvals = this.historicalEvaluations.get(validatorAddress) || [];
      historicalEvals.push(...evals);
      this.historicalEvaluations.set(validatorAddress, historicalEvals);
    }
    
    // Check diversity requirements
    if (!diversityAnalysis.requiresDiversity) {
      this.logger.warn('Method diversity requirements not met', {
        diversityScore: diversityAnalysis.diversityScore,
        uniqueMethods: diversityAnalysis.uniqueMethods,
        required: this.MIN_UNIQUE_METHODS,
      });
    }
    
    return calibrations;
  }

  /**
   * Calculate estimator stability
   * How stable are the estimates across resampling?
   */
  private calculateStability(
    validatorAddress: string,
    distribution: DistributionAnalysis,
    contributions: Map<string, ContributionScore>
  ): number {
    // Stability = inverse of variance in distribution estimates
    // Higher stability = more consistent estimates
    
    // 1. Mode stability (how consistent are modes?)
    const modeStabilities = distribution.modes.map(m => m.robustness);
    const avgModeStability = modeStabilities.reduce((a, b) => a + b, 0) / (modeStabilities.length || 1);
    
    // 2. Contribution stability (how consistent are contribution scores?)
    const contributionValues = Array.from(contributions.values()).map(c => c.totalContribution);
    if (contributionValues.length === 0) return 0;
    
    const mean = contributionValues.reduce((a, b) => a + b, 0) / contributionValues.length;
    const variance = contributionValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / contributionValues.length;
    const contributionStability = 1 / (1 + variance); // Inverse variance, normalized
    
    // 3. Overall stability
    return (avgModeStability + contributionStability) / 2;
  }

  /**
   * Calculate manipulation resistance
   * How resistant is the estimator to adversarial inputs?
   */
  private calculateManipulationResistance(
    validatorAddress: string,
    evaluations: ValidatorEvaluation[]
  ): number {
    // Manipulation resistance = how well estimator handles outliers
    
    // 1. Check for suspicious patterns (all high scores, all low scores)
    const scores = evaluations.map(e => e.score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    // High variance = good (not manipulated to give same scores)
    // But too high = suspicious (might be random)
    const scoreDiversity = Math.min(stdDev / 50, 1); // Normalize to [0, 1]
    
    // 2. Check confidence consistency
    const confidences = evaluations.map(e => e.confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const confidenceVariance = confidences.reduce((sum, c) => sum + Math.pow(c - avgConfidence, 2), 0) / confidences.length;
    
    // Low confidence variance = suspicious (might be automated/manipulated)
    const confidenceDiversity = Math.min(Math.sqrt(confidenceVariance) * 2, 1);
    
    // 3. Overall resistance
    return (scoreDiversity + confidenceDiversity) / 2;
  }

  /**
   * Calculate predictive consistency
   * How consistent are predictions over time?
   */
  private calculatePredictiveConsistency(
    validatorAddress: string,
    currentEvaluations: ValidatorEvaluation[]
  ): number {
    const historical = this.historicalEvaluations.get(validatorAddress) || [];
    
    if (historical.length === 0) {
      // First evaluation - assume good consistency
      return 0.7; // Neutral score for new validators
    }
    
    // Compare current evaluations with historical pattern
    const historicalScores = historical.map(e => e.score);
    const currentScores = currentEvaluations.map(e => e.score);
    
    const historicalMean = historicalScores.reduce((a, b) => a + b, 0) / historicalScores.length;
    const currentMean = currentScores.reduce((a, b) => a + b, 0) / currentScores.length;
    
    // Consistency = inverse of deviation from historical pattern
    const deviation = Math.abs(currentMean - historicalMean) / 100; // Normalize to [0, 1]
    const consistency = 1 - Math.min(deviation, 1);
    
    return consistency;
  }

  /**
   * Calculate method uniqueness
   * How unique is this validator's method combination?
   */
  private calculateMethodUniqueness(
    methodConfig: ValidatorMethodConfig,
    diversityAnalysis: MethodDiversityAnalysis
  ): number {
    const methodCount = diversityAnalysis.methodDistribution.get(methodConfig.methodId) || 1;
    const totalValidators = diversityAnalysis.totalValidators;
    
    // Uniqueness = inverse of method frequency
    // More unique = higher score
    const frequency = methodCount / totalValidators;
    const uniqueness = 1 - frequency;
    
    return uniqueness;
  }

  /**
   * Analyze method diversity
   * Check if validators are using diverse methods
   */
  analyzeMethodDiversity(evaluations: ValidatorEvaluation[]): MethodDiversityAnalysis {
    const methodDistribution = new Map<string, number>();
    const validatorMethods = new Set<string>();
    
    for (const eval_ of evaluations) {
      if (!eval_.methodConfig) continue;
      
      const methodId = eval_.methodConfig.methodId;
      methodDistribution.set(methodId, (methodDistribution.get(methodId) || 0) + 1);
      validatorMethods.add(eval_.validatorAddress);
    }
    
    const totalValidators = validatorMethods.size;
    const uniqueMethods = methodDistribution.size;
    
    // Calculate Shannon entropy (diversity metric)
    let entropy = 0;
    for (const count of methodDistribution.values()) {
      const probability = count / evaluations.length;
      if (probability > 0) {
        entropy -= probability * Math.log2(probability);
      }
    }
    
    // Normalize entropy to [0, 1]
    const maxEntropy = Math.log2(uniqueMethods || 1);
    const diversityScore = maxEntropy > 0 ? entropy / maxEntropy : 0;
    
    // Check if diversity requirements are met
    const requiresDiversity = 
      diversityScore >= this.MIN_METHOD_DIVERSITY &&
      uniqueMethods >= this.MIN_UNIQUE_METHODS;
    
    return {
      totalValidators,
      uniqueMethods,
      methodDistribution,
      diversityScore,
      requiresDiversity,
    };
  }

  /**
   * Get validator calibration metrics
   */
  getCalibrationMetrics(validatorAddress: string): ValidatorCalibrationMetrics | null {
    return this.calibrationMetrics.get(validatorAddress) || null;
  }

  /**
   * Get all calibration metrics
   */
  getAllCalibrationMetrics(): Map<string, ValidatorCalibrationMetrics> {
    return new Map(this.calibrationMetrics);
  }

  /**
   * Calculate validator reward multiplier based on calibration
   * Higher calibration = higher reward
   */
  calculateRewardMultiplier(validatorAddress: string): number {
    const metrics = this.calibrationMetrics.get(validatorAddress);
    if (!metrics) return 1.0; // Default multiplier
    
    // Reward multiplier based on calibration score
    // Calibration score 0.5 = 1x multiplier (neutral)
    // Calibration score 1.0 = 2x multiplier (excellent)
    // Calibration score 0.0 = 0.5x multiplier (poor)
    const multiplier = 0.5 + (metrics.calibrationScore * 1.5);
    
    return Math.max(0.1, Math.min(2.0, multiplier)); // Clamp to [0.1, 2.0]
  }

  /**
   * Penalize validators with correlated errors
   * If multiple validators using same method make same mistakes, penalize
   */
  detectCorrelatedErrors(
    evaluations: ValidatorEvaluation[],
    expectedContributions: Map<string, ContributionScore>
  ): Map<string, number> {
    const penalties = new Map<string, number>();
    
    // Group by method
    const methodGroups = new Map<string, ValidatorEvaluation[]>();
    for (const eval_ of evaluations) {
      if (!eval_.methodConfig) continue;
      const methodId = eval_.methodConfig.methodId;
      if (!methodGroups.has(methodId)) {
        methodGroups.set(methodId, []);
      }
      methodGroups.get(methodId)!.push(eval_);
    }
    
    // Check for correlated errors within each method group
    for (const [methodId, methodEvals] of methodGroups.entries()) {
      if (methodEvals.length < 2) continue; // Need at least 2 validators
      
      // Calculate error correlation
      const errors: number[] = [];
      for (const eval_ of methodEvals) {
        const expected = expectedContributions.get(eval_.outputId);
        if (!expected) continue;
        
        // Error = difference between validator's score and expected contribution
        const expectedScore = expected.totalContribution * 100;
        const error = Math.abs(eval_.score - expectedScore) / 100;
        errors.push(error);
      }
      
      // High correlation = all validators make similar errors
      // This suggests method bias or manipulation
      if (errors.length >= 2) {
        const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
        const variance = errors.reduce((sum, e) => sum + Math.pow(e - meanError, 2), 0) / errors.length;
        
        // Low variance = high correlation = suspicious
        if (variance < 0.01 && meanError > 0.1) {
          // Penalize all validators using this method
          for (const eval_ of methodEvals) {
            const currentPenalty = penalties.get(eval_.validatorAddress) || 0;
            penalties.set(eval_.validatorAddress, currentPenalty + 0.1); // 10% penalty
          }
        }
      }
    }
    
    return penalties;
  }
}
