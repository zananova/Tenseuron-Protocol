/**
 * Adversarial Testing Service
 * 
 * Implements adversarial test generation and injection to detect risk score gaming.
 * 
 * Core Principle: "Test, don't trust"
 * - Randomly inject adversarial tests (5-10% of tasks)
 * - Higher rate for high-reputation validators (they should be more robust)
 * - Higher rate for rapid reputation growth (detect farming)
 * - Higher rate for correlated behavior clusters (detect collusion)
 * 
 * Adversarial tests are:
 * - Known-bad outputs (should be rejected)
 * - Edge cases (should be handled correctly)
 * - Distribution shifts (should adapt)
 * - Manipulation attempts (should be detected)
 */

import { ILogger } from './utils/ILogger';
import { TaskOutput } from './types';

/**
 * Adversarial Test Type
 */
export type AdversarialTestType = 
  | 'known-bad-output'      // Output that should be rejected
  | 'edge-case'              // Edge case that should be handled
  | 'distribution-shift'     // Distribution shift that should be detected
  | 'manipulation-attempt'   // Attempted manipulation that should be caught
  | 'correlation-test';      // Test for correlated behavior

/**
 * Adversarial Test Result
 */
export interface AdversarialTestResult {
  testType: AdversarialTestType;
  passed: boolean;
  expectedBehavior: string;
  actualBehavior: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskPenalty?: number;      // Reputation penalty if failed (0-100)
  riskBoost?: number;        // Reputation boost if passed (0-100)
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
  rapidGrowthThreshold: number;      // Reputation increase per task for "rapid growth" (default: 2)
}

/**
 * Adversarial Testing Service
 */
export class AdversarialTestingService {
  private logger: ILogger;
  private config: AdversarialTestConfig;
  private testHistory: Map<string, AdversarialTestResult[]> = new Map(); // validator -> test results

  constructor(
    config?: Partial<AdversarialTestConfig>,
    logger?: Logger
  ) {
    this.logger = logger || new Logger('AdversarialTestingService');
    this.config = {
      globalRate: 0.075,              // 7.5% baseline
      perActorJitter: 0.05,            // ±5% jitter
      highReputationMultiplier: 1.5,    // 1.5x for high reputation
      rapidGrowthMultiplier: 2.0,      // 2.0x for rapid growth
      correlationMultiplier: 3.0,      // 3.0x for correlated behavior
      minReputationForHighRate: 80,    // 80+ reputation = high rate
      rapidGrowthThreshold: 2,         // +2 reputation per task = rapid growth
      ...config,
    };
  }

  /**
   * Determine if this task should be an adversarial test
   * 
   * Returns: { isAdversarial: boolean, testType?: AdversarialTestType }
   */
  shouldInjectTest(
    validatorAddress: string,
    validatorReputation: number,
    reputationChange: number,
    isCorrelated: boolean = false
  ): { isAdversarial: boolean; testType?: AdversarialTestType } {
    // Calculate base rate with jitter
    let rate = this.config.globalRate;
    
    // Add per-actor jitter (randomized, but consistent per actor)
    const jitterSeed = this.hashAddress(validatorAddress);
    const jitter = (jitterSeed % 100) / 1000 * this.config.perActorJitter * 2 - this.config.perActorJitter;
    rate += jitter;
    
    // Apply multipliers
    if (validatorReputation >= this.config.minReputationForHighRate) {
      rate *= this.config.highReputationMultiplier;
    }
    
    if (reputationChange >= this.config.rapidGrowthThreshold) {
      rate *= this.config.rapidGrowthMultiplier;
    }
    
    if (isCorrelated) {
      rate *= this.config.correlationMultiplier;
    }
    
    // Cap at 20% (safety limit)
    rate = Math.min(rate, 0.20);
    
    // Random decision
    const random = Math.random();
    const isAdversarial = random < rate;
    
    if (isAdversarial) {
      // Select test type (weighted by severity)
      const testType = this.selectTestType(validatorReputation, isCorrelated);
      
      this.logger.debug('Adversarial test injected', {
        validatorAddress,
        rate,
        testType,
        reputation: validatorReputation,
        reputationChange,
        isCorrelated,
      });
      
      return { isAdversarial: true, testType };
    }
    
    return { isAdversarial: false };
  }

  /**
   * Generate adversarial test output
   */
  generateAdversarialTest(
    testType: AdversarialTestType,
    taskInput: any,
    taskType: string = 'general'
  ): { output: TaskOutput; expectedBehavior: string } {
    switch (testType) {
      case 'known-bad-output':
        return this.generateKnownBadOutput(taskInput, taskType);
      
      case 'edge-case':
        return this.generateEdgeCase(taskInput, taskType);
      
      case 'distribution-shift':
        return this.generateDistributionShift(taskInput, taskType);
      
      case 'manipulation-attempt':
        return this.generateManipulationAttempt(taskInput, taskType);
      
      case 'correlation-test':
        return this.generateCorrelationTest(taskInput, taskType);
      
      default:
        // Fallback to known-bad-output
        return this.generateKnownBadOutput(taskInput, taskType);
    }
  }

  /**
   * Evaluate adversarial test result
   */
  evaluateTestResult(
    validatorAddress: string,
    testType: AdversarialTestType,
    expectedBehavior: string,
    actualBehavior: string,
    validatorResponse: {
      score: number;
      confidence: number;
      reasoning?: string;
    }
  ): AdversarialTestResult {
    // Determine if test passed based on test type
    const passed = this.checkTestPassed(testType, expectedBehavior, actualBehavior, validatorResponse);
    
    // Determine severity
    const severity = this.determineSeverity(testType, passed);
    
    // Calculate risk penalty/boost
    let riskPenalty: number | undefined;
    let riskBoost: number | undefined;
    
    if (!passed) {
      // Failed test → reputation penalty
      riskPenalty = this.calculatePenalty(severity, testType);
    } else {
      // Passed test → reputation boost
      riskBoost = this.calculateBoost(severity, testType);
    }
    
    const result: AdversarialTestResult = {
      testType,
      passed,
      expectedBehavior,
      actualBehavior,
      severity,
      riskPenalty,
      riskBoost,
    };
    
    // Store in history
    if (!this.testHistory.has(validatorAddress)) {
      this.testHistory.set(validatorAddress, []);
    }
    this.testHistory.get(validatorAddress)!.push(result);
    
    this.logger.info('Adversarial test evaluated', {
      validatorAddress,
      testType,
      passed,
      severity,
      riskPenalty,
      riskBoost,
    });
    
    return result;
  }

  /**
   * Get test history for validator
   */
  getTestHistory(validatorAddress: string): AdversarialTestResult[] {
    return this.testHistory.get(validatorAddress) || [];
  }

  /**
   * Get test statistics for validator
   */
  getTestStatistics(validatorAddress: string): {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    passRate: number;
    averageSeverity: number;
  } {
    const history = this.getTestHistory(validatorAddress);
    
    if (history.length === 0) {
      return {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        passRate: 1.0,
        averageSeverity: 0,
      };
    }
    
    const passedTests = history.filter(r => r.passed).length;
    const failedTests = history.filter(r => !r.passed).length;
    const passRate = passedTests / history.length;
    
    const severityMap = { low: 1, medium: 2, high: 3, critical: 4 };
    const averageSeverity = history.reduce((sum, r) => sum + severityMap[r.severity], 0) / history.length;
    
    return {
      totalTests: history.length,
      passedTests,
      failedTests,
      passRate,
      averageSeverity,
    };
  }

  // Private helper methods

  private selectTestType(
    validatorReputation: number,
    isCorrelated: boolean
  ): AdversarialTestType {
    // Weight test types based on context
    if (isCorrelated) {
      // Correlated behavior → test for correlation
      return 'correlation-test';
    }
    
    if (validatorReputation >= 80) {
      // High reputation → test for manipulation resistance
      return Math.random() < 0.5 ? 'manipulation-attempt' : 'distribution-shift';
    }
    
    // Default: mix of test types
    const rand = Math.random();
    if (rand < 0.3) return 'known-bad-output';
    if (rand < 0.6) return 'edge-case';
    if (rand < 0.8) return 'distribution-shift';
    return 'manipulation-attempt';
  }

  private generateKnownBadOutput(
    taskInput: any,
    taskType: string
  ): { output: TaskOutput; expectedBehavior: string } {
    // Generate output that should be rejected
    const badOutput: TaskOutput = {
      outputId: `adversarial-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      output: this.generateBadOutput(taskType),
      minerAddress: 'adversarial-test',
      submittedAt: Date.now(),
      metadata: {
        isAdversarialTest: true,
        testType: 'known-bad-output',
      },
    };
    
    return {
      output: badOutput,
      expectedBehavior: 'Should be rejected (invalid output)',
    };
  }

  private generateEdgeCase(
    taskInput: any,
    taskType: string
  ): { output: TaskOutput; expectedBehavior: string } {
    // Generate edge case output
    const edgeCaseOutput: TaskOutput = {
      outputId: `adversarial-edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      output: this.generateEdgeCaseOutput(taskType),
      minerAddress: 'adversarial-test',
      submittedAt: Date.now(),
      metadata: {
        isAdversarialTest: true,
        testType: 'edge-case',
      },
    };
    
    return {
      output: edgeCaseOutput,
      expectedBehavior: 'Should be handled correctly (edge case)',
    };
  }

  private generateDistributionShift(
    taskInput: any,
    taskType: string
  ): { output: TaskOutput; expectedBehavior: string } {
    // Generate output with distribution shift
    const shiftedOutput: TaskOutput = {
      outputId: `adversarial-shift-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      output: this.generateShiftedOutput(taskType),
      minerAddress: 'adversarial-test',
      submittedAt: Date.now(),
      metadata: {
        isAdversarialTest: true,
        testType: 'distribution-shift',
      },
    };
    
    return {
      output: shiftedOutput,
      expectedBehavior: 'Should detect distribution shift',
    };
  }

  private generateManipulationAttempt(
    taskInput: any,
    taskType: string
  ): { output: TaskOutput; expectedBehavior: string } {
    // Generate output that attempts manipulation
    const manipulationOutput: TaskOutput = {
      outputId: `adversarial-manip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      output: this.generateManipulationOutput(taskType),
      minerAddress: 'adversarial-test',
      submittedAt: Date.now(),
      metadata: {
        isAdversarialTest: true,
        testType: 'manipulation-attempt',
      },
    };
    
    return {
      output: manipulationOutput,
      expectedBehavior: 'Should detect manipulation attempt',
    };
  }

  private generateCorrelationTest(
    taskInput: any,
    taskType: string
  ): { output: TaskOutput; expectedBehavior: string } {
    // Generate test for correlated behavior
    const correlationOutput: TaskOutput = {
      outputId: `adversarial-corr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      output: this.generateCorrelationOutput(taskType),
      minerAddress: 'adversarial-test',
      submittedAt: Date.now(),
      metadata: {
        isAdversarialTest: true,
        testType: 'correlation-test',
      },
    };
    
    return {
      output: correlationOutput,
      expectedBehavior: 'Should detect correlated behavior',
    };
  }

  private generateBadOutput(taskType: string): any {
    // Generate obviously bad output based on task type
    switch (taskType) {
      case 'code':
        return { code: 'invalid syntax error!!!', language: 'invalid' };
      case 'text':
        return { text: '', length: -1 };
      case 'image':
        return { image: 'not-an-image', format: 'invalid' };
      default:
        return { invalid: true, error: 'malformed output' };
    }
  }

  private generateEdgeCaseOutput(taskType: string): any {
    // Generate edge case output
    switch (taskType) {
      case 'code':
        return { code: '// Empty code block', language: 'javascript' };
      case 'text':
        return { text: 'a', length: 1 };
      case 'image':
        return { image: '1x1-pixel', format: 'png' };
      default:
        return { edgeCase: true, minimal: true };
    }
  }

  private generateShiftedOutput(taskType: string): any {
    // Generate output with distribution shift
    return {
      shifted: true,
      distribution: 'unusual',
      taskType,
    };
  }

  private generateManipulationOutput(taskType: string): any {
    // Generate output that attempts manipulation
    return {
      manipulation: true,
      attempt: 'score-inflation',
      taskType,
    };
  }

  private generateCorrelationOutput(taskType: string): any {
    // Generate output for correlation test
    return {
      correlation: true,
      test: 'behavior-pattern',
      taskType,
    };
  }

  private checkTestPassed(
    testType: AdversarialTestType,
    expectedBehavior: string,
    actualBehavior: string,
    validatorResponse: { score: number; confidence: number; reasoning?: string }
  ): boolean {
    switch (testType) {
      case 'known-bad-output':
        // Should reject (low score, low confidence)
        return validatorResponse.score < 30 && validatorResponse.confidence < 0.5;
      
      case 'edge-case':
        // Should handle correctly (reasonable score)
        return validatorResponse.score >= 40 && validatorResponse.score <= 80;
      
      case 'distribution-shift':
        // Should detect shift (low confidence or flag)
        return validatorResponse.confidence < 0.7 || (validatorResponse.reasoning?.includes('shift') ?? false);
      
      case 'manipulation-attempt':
        // Should detect manipulation (low score or flag)
        return validatorResponse.score < 50 || (validatorResponse.reasoning?.includes('manipulation') ?? false);
      
      case 'correlation-test':
        // Should detect correlation (flag in reasoning)
        return validatorResponse.reasoning?.includes('correlation') ?? false;
      
      default:
        return false;
    }
  }

  private determineSeverity(
    testType: AdversarialTestType,
    passed: boolean
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (passed) {
      // Passed tests are always low severity (positive signal)
      return 'low';
    }
    
    // Failed tests have higher severity
    switch (testType) {
      case 'known-bad-output':
        return 'high'; // Should have caught this
      case 'edge-case':
        return 'medium'; // Edge cases are harder
      case 'distribution-shift':
        return 'high'; // Should detect shifts
      case 'manipulation-attempt':
        return 'critical'; // Manipulation is critical
      case 'correlation-test':
        return 'critical'; // Correlation is critical
      default:
        return 'medium';
    }
  }

  private calculatePenalty(
    severity: 'low' | 'medium' | 'high' | 'critical',
    testType: AdversarialTestType
  ): number {
    const basePenalties = {
      low: 2,
      medium: 5,
      high: 10,
      critical: 20,
    };
    
    const basePenalty = basePenalties[severity];
    
    // Adjust based on test type
    if (testType === 'manipulation-attempt' || testType === 'correlation-test') {
      return basePenalty * 1.5; // Higher penalty for critical tests
    }
    
    return basePenalty;
  }

  private calculateBoost(
    severity: 'low' | 'medium' | 'high' | 'critical',
    testType: AdversarialTestType
  ): number {
    // Passed tests give reputation boost
    const baseBoosts = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 5,
    };
    
    const baseBoost = baseBoosts[severity];
    
    // Adjust based on test type
    if (testType === 'manipulation-attempt' || testType === 'correlation-test') {
      return baseBoost * 2; // Higher boost for critical tests
    }
    
    return baseBoost;
  }

  private hashAddress(address: string): number {
    // Simple hash for jitter seed
    let hash = 0;
    for (let i = 0; i < address.length; i++) {
      const char = address.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
