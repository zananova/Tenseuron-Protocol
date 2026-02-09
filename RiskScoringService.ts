/**
 * Risk Scoring Service
 * 
 * Protocol-level risk assessment based on network parameters.
 * Makes cheating expensive by pricing risk-enabling parameters.
 * 
 * Core principle: Cheating requires risky parameters → risky parameters cost money.
 */

import { ILogger } from './utils/ILogger';
import { getInvariantChecker } from './InvariantChecker';
import { ValidatorRiskCorrelation } from './types';

/**
 * Risk Parameters
 * These are the parameters that affect network security and cheatability
 */
export interface RiskParameters {
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
  
  // Additional risk factors
  minValidators: number;          // Minimum validators (lower = riskier)
  consensusThreshold: number;     // Consensus threshold (lower = riskier)
  disputeWindow: number;           // Dispute window in seconds (lower = riskier)
  stakeRequired: string;          // Stake required (lower = riskier)
}

/**
 * Risk Score Result
 */
export interface RiskScore {
  totalRisk: number;              // 0-100, higher = riskier
  parameterBreakdown: {
    payoutCapRisk: number;
    settlementDelayRisk: number;
    customScoringRisk: number;
    instantPayoutRisk: number;
    singleValidatorRisk: number;
    nonDeterministicRisk: number;
    validatorSelfSelectRisk: number;
    maxPayoutRisk: number;
    validatorCountRisk: number;
    consensusThresholdRisk: number;
    disputeWindowRisk: number;
    stakeRequiredRisk: number;
  };
  riskCategory: 'safe' | 'moderate' | 'risky' | 'dangerous';
}

/**
 * Required Costs based on Risk
 */
export interface RequiredCosts {
  creationFee: string;            // Base creation fee (in native token)
  creatorReward: string;          // Portion of creation fee to creator
  requiredStake: string;          // Minimum stake required (in native token)
  settlementDelay: number;        // Minimum settlement delay (seconds)
  escrowLockup: number;           // Escrow lockup period (seconds)
  slashingEnabled: boolean;       // Whether slashing is required
  slashingRate: number;           // Slashing rate (0-100, percentage)
  penaltyConfigFee: string;      // Additional fee for custom penalty configuration (0 if using protocol defaults)
}

export class RiskScoringService {
  private logger: ILogger;
  private validatorRiskHistory: Map<string, number[]> = new Map(); // validator -> risk scores over time
  private correlationCache: Map<string, ValidatorRiskCorrelation> = new Map(); // key: validatorA:validatorB

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('RiskScoringService');
  }

  /**
   * Calculate risk score from network parameters
   * Protocol-level: This cannot be bypassed
   */
  calculateRiskScore(params: RiskParameters): RiskScore {
    const breakdown = {
      // Safe parameters (inverse risk - lower payout cap = safer)
      payoutCapRisk: this.calculatePayoutCapRisk(params.payoutCap),
      settlementDelayRisk: this.calculateSettlementDelayRisk(params.settlementDelay),
      taskSchemaRisk: params.taskSchemaFixed ? 0 : 10, // Custom schema = riskier
      
      // Risk-enabling parameters (direct risk)
      customScoringRisk: params.customScoring ? 25 : 0, // Custom scoring = high risk
      instantPayoutRisk: params.instantPayout ? 20 : 0, // Instant payout = high risk
      singleValidatorRisk: params.singleValidator ? 30 : 0, // Single validator = very high risk
      nonDeterministicRisk: params.nonDeterministic ? 25 : 0, // Non-deterministic = high risk
      validatorSelfSelectRisk: params.validatorSelfSelect ? 15 : 0, // Self-selection = moderate risk
      maxPayoutRisk: this.calculateMaxPayoutRisk(params.maxPayoutPerTask),
      
      // Validator configuration risks
      validatorCountRisk: this.calculateValidatorCountRisk(params.minValidators),
      consensusThresholdRisk: this.calculateConsensusThresholdRisk(params.consensusThreshold),
      disputeWindowRisk: this.calculateDisputeWindowRisk(params.disputeWindow),
      stakeRequiredRisk: this.calculateStakeRequiredRisk(params.stakeRequired),
    };

    // Calculate total risk (sum of all risk factors, capped at 100)
    const totalRisk = Math.min(
      Object.values(breakdown).reduce((sum, risk) => sum + risk, 0),
      100
    );

    // Runtime invariant check: risk score must be in [0, 100]
    const invariantChecker = getInvariantChecker();
    invariantChecker.checkRiskScoreBounds(
      'RiskScoringService.calculateRiskScore',
      totalRisk
    );

    // Determine risk category
    let riskCategory: 'safe' | 'moderate' | 'risky' | 'dangerous';
    if (totalRisk < 20) {
      riskCategory = 'safe';
    } else if (totalRisk < 40) {
      riskCategory = 'moderate';
    } else if (totalRisk < 70) {
      riskCategory = 'risky';
    } else {
      riskCategory = 'dangerous';
    }

    return {
      totalRisk,
      parameterBreakdown: {
        payoutCapRisk: breakdown.payoutCapRisk,
        settlementDelayRisk: breakdown.settlementDelayRisk,
        customScoringRisk: breakdown.customScoringRisk,
        instantPayoutRisk: breakdown.instantPayoutRisk,
        singleValidatorRisk: breakdown.singleValidatorRisk,
        nonDeterministicRisk: breakdown.nonDeterministicRisk,
        validatorSelfSelectRisk: breakdown.validatorSelfSelectRisk,
        maxPayoutRisk: breakdown.maxPayoutRisk,
        validatorCountRisk: breakdown.validatorCountRisk,
        consensusThresholdRisk: breakdown.consensusThresholdRisk,
        disputeWindowRisk: breakdown.disputeWindowRisk,
        stakeRequiredRisk: breakdown.stakeRequiredRisk,
      },
      riskCategory,
    };
  }

  /**
   * Calculate required costs based on risk score
   * Protocol-level: This enforces economic friction
   * 
   * @param riskScore Risk assessment result
   * @param maxPayoutPerTask Maximum payout per task
   * @param hasCustomPenaltyConfig Whether user provided custom penalty configuration (adds fee)
   */
  calculateRequiredCosts(
    riskScore: RiskScore, 
    maxPayoutPerTask: string,
    hasCustomPenaltyConfig: boolean = false
  ): RequiredCosts {
    const baseCreationFee = '0.01'; // Base fee in native token (e.g., 0.01 ETH)
    const riskMultiplier = this.getRiskMultiplier(riskScore.totalRisk);
    
    // Creation fee scales with risk
    const creationFee = (parseFloat(baseCreationFee) * riskMultiplier).toString();
    
    // Creator reward: Higher risk networks get smaller creator reward (incentivizes safety)
    const creatorRewardPercentage = Math.max(10, 50 - riskScore.totalRisk * 0.4); // 50% for safe, 10% for dangerous
    const creatorReward = (parseFloat(creationFee) * creatorRewardPercentage / 100).toString();
    
    // Required stake: Scales with risk and max payout
    const maxPayoutNum = parseFloat(maxPayoutPerTask) || 0;
    const stakeMultiplier = Math.max(1, riskScore.totalRisk / 20); // 1x for safe, 5x for dangerous
    const requiredStake = (maxPayoutNum * stakeMultiplier * 10).toString(); // 10x max payout for risky networks
    
    // Settlement delay: Riskier networks require longer delays
    const baseDelay = 3600; // 1 hour base
    const delayMultiplier = Math.max(1, riskScore.totalRisk / 30); // 1x for safe, 3.3x for dangerous
    const settlementDelay = Math.floor(baseDelay * delayMultiplier);
    
    // Escrow lockup: Riskier networks lock funds longer
    const escrowLockup = settlementDelay * 2; // Double the settlement delay
    
    // Slashing: Required for risky networks
    const slashingEnabled = riskScore.totalRisk >= 40;
    const slashingRate = riskScore.totalRisk >= 70 ? 50 : // 50% for dangerous
                        riskScore.totalRisk >= 40 ? 25 : // 25% for risky
                        0; // No slashing for safe/moderate

    // Penalty configuration fee: Custom penalty config costs extra (security fee)
    // Using protocol defaults is free, custom config requires additional fee
    // This incentivizes using secure protocol defaults
    const basePenaltyConfigFee = '0.002'; // Base fee for custom penalty config (0.002 ETH/MATIC/etc)
    const penaltyConfigFee = hasCustomPenaltyConfig ? basePenaltyConfigFee : '0';

    return {
      creationFee,
      creatorReward,
      requiredStake,
      settlementDelay,
      escrowLockup,
      slashingEnabled,
      slashingRate,
      penaltyConfigFee,
    };
  }

  /**
   * Get risk multiplier for fee calculation
   */
  private getRiskMultiplier(riskScore: number): number {
    if (riskScore < 20) return 1.0;      // Safe: 1x base fee
    if (riskScore < 40) return 2.0;      // Moderate: 2x base fee
    if (riskScore < 70) return 5.0;      // Risky: 5x base fee
    return 10.0;                         // Dangerous: 10x base fee
  }

  /**
   * Calculate risk from payout cap
   * Lower cap = safer = lower risk
   */
  private calculatePayoutCapRisk(payoutCap: string): number {
    const cap = parseFloat(payoutCap) || 0;
    if (cap === 0) return 0; // No payout = no risk
    if (cap < 0.001) return 0; // Very low cap = safe
    if (cap < 0.01) return 2;
    if (cap < 0.1) return 5;
    if (cap < 1) return 10;
    return 15; // High cap = riskier
  }

  /**
   * Calculate risk from settlement delay
   * Longer delay = safer = lower risk
   */
  private calculateSettlementDelayRisk(settlementDelay: number): number {
    if (settlementDelay >= 86400) return 0;      // 24+ hours = safe
    if (settlementDelay >= 3600) return 2;       // 1+ hour = low risk
    if (settlementDelay >= 300) return 5;        // 5+ minutes = moderate risk
    if (settlementDelay >= 60) return 10;        // 1+ minute = risky
    return 15;                                   // < 1 minute = very risky
  }

  /**
   * Calculate risk from max payout per task
   * Higher payout = riskier
   */
  private calculateMaxPayoutRisk(maxPayout: string): number {
    const payout = parseFloat(maxPayout) || 0;
    if (payout === 0) return 0;
    if (payout < 0.001) return 0;
    if (payout < 0.01) return 2;
    if (payout < 0.1) return 5;
    if (payout < 1) return 10;
    if (payout < 10) return 15;
    return 20; // Very high payout = very risky
  }

  /**
   * Calculate risk from validator count
   * Fewer validators = riskier
   */
  private calculateValidatorCountRisk(minValidators: number): number {
    if (minValidators >= 5) return 0;      // 5+ validators = safe
    if (minValidators >= 3) return 5;     // 3-4 validators = low risk
    if (minValidators >= 2) return 15;    // 2 validators = moderate risk
    return 30;                            // 1 validator = high risk
  }

  /**
   * Calculate risk from consensus threshold
   * Lower threshold = riskier
   */
  private calculateConsensusThresholdRisk(threshold: number): number {
    if (threshold >= 0.8) return 0;       // 80%+ = safe
    if (threshold >= 0.6) return 3;       // 60-80% = low risk
    if (threshold >= 0.5) return 8;       // 50-60% = moderate risk
    if (threshold >= 0.33) return 15;     // 33-50% = risky
    return 25;                            // < 33% = very risky
  }

  /**
   * Calculate risk from dispute window
   * Shorter window = riskier
   */
  private calculateDisputeWindowRisk(disputeWindow: number): number {
    if (disputeWindow >= 604800) return 0;    // 7+ days = safe
    if (disputeWindow >= 86400) return 2;     // 1+ day = low risk
    if (disputeWindow >= 3600) return 5;     // 1+ hour = moderate risk
    if (disputeWindow >= 300) return 10;     // 5+ minutes = risky
    return 15;                                // < 5 minutes = very risky
  }

  /**
   * Calculate risk from stake required
   * Lower stake = riskier
   */
  private calculateStakeRequiredRisk(stakeRequired: string): number {
    const stake = parseFloat(stakeRequired) || 0;
    if (stake === 0) return 20;           // No stake = high risk
    if (stake < 0.001) return 15;        // Very low stake = risky
    if (stake < 0.01) return 10;         // Low stake = moderate risk
    if (stake < 0.1) return 5;           // Moderate stake = low risk
    return 0;                            // High stake = safe
  }

  /**
   * Validate risk parameters
   * Ensures parameters are within acceptable ranges
   */
  validateRiskParameters(params: RiskParameters): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate payout cap
    const payoutCap = parseFloat(params.payoutCap);
    if (isNaN(payoutCap) || payoutCap < 0) {
      errors.push('Payout cap must be a non-negative number');
    }

    // Validate settlement delay
    if (params.settlementDelay < 0) {
      errors.push('Settlement delay must be non-negative');
    }

    // Validate max payout
    const maxPayout = parseFloat(params.maxPayoutPerTask);
    if (isNaN(maxPayout) || maxPayout < 0) {
      errors.push('Max payout per task must be a non-negative number');
    }

    // Validate validator count
    if (params.minValidators < 1) {
      errors.push('Minimum validators must be at least 1');
    }

    // Validate consensus threshold
    if (params.consensusThreshold < 0 || params.consensusThreshold > 1) {
      errors.push('Consensus threshold must be between 0 and 1');
    }

    // Validate dispute window
    if (params.disputeWindow < 0) {
      errors.push('Dispute window must be non-negative');
    }

    // Validate stake required
    const stake = parseFloat(params.stakeRequired);
    if (isNaN(stake) || stake < 0) {
      errors.push('Stake required must be a non-negative number');
    }

    // Warn about dangerous combinations
    if (params.singleValidator && params.instantPayout && maxPayout > 1) {
      errors.push('WARNING: Single validator + instant payout + high max payout is extremely risky');
    }

    if (params.customScoring && params.nonDeterministic) {
      errors.push('WARNING: Custom scoring + non-deterministic evaluation is very risky');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ========== NEW: Correlation Detection Methods ==========

  /**
   * Track validator risk score over time
   */
  trackValidatorRisk(validatorAddress: string, riskScore: number): void {
    if (!this.validatorRiskHistory.has(validatorAddress)) {
      this.validatorRiskHistory.set(validatorAddress, []);
    }
    
    const history = this.validatorRiskHistory.get(validatorAddress)!;
    history.push(riskScore);
    
    // Keep only last 100 scores
    if (history.length > 100) {
      history.shift();
    }
  }

  /**
   * Detect correlation between two validators
   */
  detectCorrelation(
    validatorA: string,
    validatorB: string
  ): ValidatorRiskCorrelation | null {
    const historyA = this.validatorRiskHistory.get(validatorA);
    const historyB = this.validatorRiskHistory.get(validatorB);
    
    if (!historyA || !historyB || historyA.length < 10 || historyB.length < 10) {
      return null; // Not enough data
    }
    
    // Calculate correlation coefficient
    const correlation = this.calculateCorrelation(historyA, historyB);
    
    // Determine correlation type
    let correlationType: 'positive' | 'negative' | 'none';
    if (correlation > 0.7) {
      correlationType = 'positive';
    } else if (correlation < -0.7) {
      correlationType = 'negative';
    } else {
      correlationType = 'none';
    }
    
    // Determine severity
    let severity: 'low' | 'medium' | 'high' | 'critical';
    const absCorrelation = Math.abs(correlation);
    if (absCorrelation > 0.9) {
      severity = 'critical';
    } else if (absCorrelation > 0.8) {
      severity = 'high';
    } else if (absCorrelation > 0.7) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
    
    const result: ValidatorRiskCorrelation = {
      validatorA,
      validatorB,
      correlationScore: correlation,
      correlationType,
      detectedAt: Date.now(),
      severity,
    };
    
    // Cache result
    const cacheKey = `${validatorA}:${validatorB}`;
    this.correlationCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Calculate correlation coefficient (Pearson)
   */
  private calculateCorrelation(x: number[], y: number[]): number {
    // Align arrays (use shorter length)
    const length = Math.min(x.length, y.length);
    const xSlice = x.slice(-length);
    const ySlice = y.slice(-length);
    
    // Calculate means
    const meanX = xSlice.reduce((a, b) => a + b, 0) / length;
    const meanY = ySlice.reduce((a, b) => a + b, 0) / length;
    
    // Calculate covariance and variances
    let covariance = 0;
    let varianceX = 0;
    let varianceY = 0;
    
    for (let i = 0; i < length; i++) {
      const dx = xSlice[i] - meanX;
      const dy = ySlice[i] - meanY;
      covariance += dx * dy;
      varianceX += dx * dx;
      varianceY += dy * dy;
    }
    
    // Calculate correlation coefficient
    const denominator = Math.sqrt(varianceX * varianceY);
    if (denominator === 0) {
      return 0;
    }
    
    return covariance / denominator;
  }

  /**
   * Get all correlations for a validator
   */
  getCorrelations(validatorAddress: string): ValidatorRiskCorrelation[] {
    const correlations: ValidatorRiskCorrelation[] = [];
    
    for (const [key, correlation] of this.correlationCache.entries()) {
      if (correlation.validatorA === validatorAddress || correlation.validatorB === validatorAddress) {
        correlations.push(correlation);
      }
    }
    
    return correlations;
  }

  /**
   * Check if validator has high correlation with others (potential collusion)
   */
  hasHighCorrelation(validatorAddress: string, threshold: number = 0.8): boolean {
    const correlations = this.getCorrelations(validatorAddress);
    return correlations.some(c => Math.abs(c.correlationScore) > threshold);
  }

  // ========== NEW: Relative Risk Calculation Methods ==========

  /**
   * Calculate relative risk (percentile) instead of absolute risk
   * Prevents inflation and makes risk scores adaptive
   */
  calculateRelativeRisk(
    validatorAddress: string,
    allValidators: string[]
  ): number {
    const validatorRisk = this.validatorRiskHistory.get(validatorAddress);
    if (!validatorRisk || validatorRisk.length === 0) {
      return 0.5; // Default for new validators
    }
    
    // Get average risk for this validator
    const avgRisk = validatorRisk.reduce((a, b) => a + b, 0) / validatorRisk.length;
    
    // Get average risks for all validators
    const allRisks: number[] = [];
    for (const addr of allValidators) {
      const risk = this.validatorRiskHistory.get(addr);
      if (risk && risk.length > 0) {
        const avg = risk.reduce((a, b) => a + b, 0) / risk.length;
        allRisks.push(avg);
      }
    }
    
    if (allRisks.length === 0) {
      return 0.5; // No other validators
    }
    
    // Calculate percentile
    const sortedRisks = allRisks.sort((a, b) => a - b);
    const rank = sortedRisks.findIndex(r => r >= avgRisk);
    const percentile = rank === -1 ? 1.0 : rank / sortedRisks.length;
    
    return percentile;
  }

  /**
   * Calculate network-wide risk distribution
   */
  calculateNetworkRiskDistribution(allValidators: string[]): {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    percentile25: number;
    percentile50: number;
    percentile75: number;
  } {
    const allRisks: number[] = [];
    for (const addr of allValidators) {
      const risk = this.validatorRiskHistory.get(addr);
      if (risk && risk.length > 0) {
        const avg = risk.reduce((a, b) => a + b, 0) / risk.length;
        allRisks.push(avg);
      }
    }
    
    if (allRisks.length === 0) {
      return {
        mean: 0.5,
        stdDev: 0,
        min: 0.5,
        max: 0.5,
        percentile25: 0.5,
        percentile50: 0.5,
        percentile75: 0.5,
      };
    }
    
    const sorted = allRisks.sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const variance = sorted.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / sorted.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean,
      stdDev,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      percentile25: sorted[Math.floor(sorted.length * 0.25)],
      percentile50: sorted[Math.floor(sorted.length * 0.5)],
      percentile75: sorted[Math.floor(sorted.length * 0.75)],
    };
  }
}
