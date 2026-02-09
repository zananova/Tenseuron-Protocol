/**
 * Network State Calculator
 * 
 * Calculates adaptive network state metrics for risk scoring and reward weighting.
 * 
 * Metrics:
 * - currentEntropy: Output distribution entropy (Shannon entropy)
 * - modeCollapseDetected: Whether output distribution shows mode collapse
 * - taskDifficulty: Task complexity metrics
 * - networkAge: Network age from creation timestamp
 * - explorationBias: Adaptive bias based on entropy and diversity
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest } from './types';
import { DistributionAnalysis } from './StatisticalDistributionService';

/**
 * Network State
 */
export interface NetworkState {
  currentEntropy: number;          // 0-1, normalized entropy
  modeCollapseDetected: boolean;   // True if mode collapse detected
  taskDifficulty: number;          // 0-1, task complexity
  networkAge: number;              // Days since network creation
  maturity: 'early' | 'mature' | 'established';
  explorationBias: number;         // 0-1, adaptive based on state
  reliabilityBias: number;         // 0-1, complement of explorationBias
}

/**
 * Network State Calculator
 */
export class NetworkStateCalculator {
  private logger: ILogger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('NetworkStateCalculator');
  }

  /**
   * Calculate network state from current context
   */
  calculateNetworkState(
    manifest: NetworkManifest,
    distributionAnalysis?: DistributionAnalysis,
    outputs?: any[],
    taskInput?: any
  ): NetworkState {
    // Calculate entropy from distribution analysis
    const currentEntropy = this.calculateCurrentEntropy(distributionAnalysis, outputs);

    // Detect mode collapse
    const modeCollapseDetected = this.detectModeCollapse(distributionAnalysis, currentEntropy);

    // Calculate task difficulty
    const taskDifficulty = this.calculateTaskDifficulty(manifest, taskInput);

    // Get network age
    const networkAge = this.getNetworkAge(manifest);

    // Determine maturity
    const maturity = this.determineMaturity(networkAge);

    // Calculate adaptive exploration bias
    const explorationBias = this.calculateExplorationBias(
      currentEntropy,
      distributionAnalysis?.diversity || 0,
      modeCollapseDetected,
      networkAge
    );

    // Reliability bias is complement of exploration bias
    const reliabilityBias = 1 - explorationBias;

    return {
      currentEntropy,
      modeCollapseDetected,
      taskDifficulty,
      networkAge,
      maturity,
      explorationBias,
      reliabilityBias,
    };
  }

  /**
   * Calculate current entropy from output distribution
   * 
   * Uses Shannon entropy: H(X) = -Σ p(x) log₂ p(x)
   * Normalized to 0-1 range
   */
  private calculateCurrentEntropy(
    distributionAnalysis?: DistributionAnalysis,
    outputs?: any[]
  ): number {
    // If distribution analysis is available, use its entropy
    if (distributionAnalysis && distributionAnalysis.entropy !== undefined) {
      // Normalize entropy (max entropy for n modes = log₂(n))
      const maxEntropy = distributionAnalysis.modeCount > 0
        ? Math.log2(distributionAnalysis.modeCount)
        : 1;
      
      if (maxEntropy === 0) {
        return 0;
      }

      const normalizedEntropy = Math.min(1.0, distributionAnalysis.entropy / maxEntropy);
      this.logger.debug('Entropy calculated from distribution analysis', {
        entropy: distributionAnalysis.entropy,
        normalizedEntropy,
        modeCount: distributionAnalysis.modeCount,
      });

      return normalizedEntropy;
    }

    // Fallback: calculate entropy from outputs directly
    if (outputs && outputs.length > 0) {
      return this.calculateEntropyFromOutputs(outputs);
    }

    // Default: unknown entropy
    this.logger.warn('No distribution analysis or outputs available, using default entropy');
    return 0.5;
  }

  /**
   * Calculate entropy directly from outputs
   * 
   * Groups outputs by similarity and calculates entropy of groups
   */
  private calculateEntropyFromOutputs(outputs: any[]): number {
    if (outputs.length === 0) {
      return 0;
    }

    if (outputs.length === 1) {
      return 0; // Single output = zero entropy
    }

    // Group outputs by hash (simple similarity measure)
    const groups = new Map<string, number>();
    for (const output of outputs) {
      const outputStr = JSON.stringify(output);
      const hash = this.simpleHash(outputStr);
      groups.set(hash, (groups.get(hash) || 0) + 1);
    }

    // Calculate Shannon entropy
    const total = outputs.length;
    let entropy = 0;

    for (const count of groups.values()) {
      const probability = count / total;
      if (probability > 0) {
        entropy -= probability * Math.log2(probability);
      }
    }

    // Normalize (max entropy = log₂(n) where n is number of groups)
    const maxEntropy = Math.log2(groups.size);
    const normalizedEntropy = maxEntropy > 0 ? Math.min(1.0, entropy / maxEntropy) : 0;

    this.logger.debug('Entropy calculated from outputs', {
      entropy,
      normalizedEntropy,
      outputCount: outputs.length,
      groupCount: groups.size,
    });

    return normalizedEntropy;
  }

  /**
   * Simple hash function for grouping
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Detect mode collapse
   * 
   * Mode collapse occurs when:
   * 1. Entropy is very low (most outputs are similar)
   * 2. One mode dominates (>80% of outputs)
   * 3. Coverage is low (outputs are clustered)
   */
  private detectModeCollapse(
    distributionAnalysis?: DistributionAnalysis,
    entropy?: number
  ): boolean {
    if (!distributionAnalysis) {
      // Without distribution analysis, use entropy threshold
      if (entropy !== undefined) {
        return entropy < 0.2; // Very low entropy suggests collapse
      }
      return false;
    }

    // Check 1: Low entropy
    const normalizedEntropy = entropy !== undefined ? entropy : this.calculateCurrentEntropy(distributionAnalysis);
    if (normalizedEntropy < 0.2) {
      this.logger.warn('Mode collapse detected: very low entropy', { entropy: normalizedEntropy });
      return true;
    }

    // Check 2: One mode dominates
    if (distributionAnalysis.modes && distributionAnalysis.modes.length > 0) {
      const totalOutputs = distributionAnalysis.modes.reduce(
        (sum, mode) => sum + mode.members.length,
        0
      );

      for (const mode of distributionAnalysis.modes) {
        const modeProportion = mode.members.length / totalOutputs;
        if (modeProportion > 0.8) {
          this.logger.warn('Mode collapse detected: single mode dominates', {
            modeProportion,
            modeId: mode.modeId,
          });
          return true;
        }
      }
    }

    // Check 3: Low coverage (outputs are too clustered)
    if (distributionAnalysis.coverage !== undefined && distributionAnalysis.coverage < 0.1) {
      this.logger.warn('Mode collapse detected: low coverage', {
        coverage: distributionAnalysis.coverage,
      });
      return true;
    }

    return false;
  }

  /**
   * Calculate task difficulty
   * 
   * Based on:
   * - Input size/complexity
   * - Schema complexity
   * - Timeout requirements
   * - Task type
   */
  private calculateTaskDifficulty(
    manifest: NetworkManifest,
    taskInput?: any
  ): number {
    let difficulty = 0.5; // Default medium difficulty
    let factors = 0;

    // Factor 1: Input size
    if (taskInput) {
      const inputSize = this.estimateInputSize(taskInput);
      const sizeFactor = Math.min(1.0, inputSize / 10000); // Normalize to 0-1
      difficulty += sizeFactor * 0.2;
      factors++;
    }

    // Factor 2: Schema complexity
    const inputSchema = manifest.taskFormat?.inputSchema;
    if (inputSchema) {
      const schemaComplexity = this.estimateSchemaComplexity(inputSchema);
      difficulty += schemaComplexity * 0.2;
      factors++;
    }

    // Factor 3: Timeout (longer timeout = harder task)
    const timeout = manifest.taskFormat?.timeout || 3600;
    const timeoutFactor = Math.min(1.0, timeout / 3600); // Normalize to 0-1 (1 hour = max)
    difficulty += timeoutFactor * 0.2;
    factors++;

    // Factor 4: Task type (some types are inherently harder)
    const taskType = this.getTaskType(manifest);
    const typeDifficulty = this.getTaskTypeDifficulty(taskType);
    difficulty += typeDifficulty * 0.2;
    factors++;

    // Normalize
    if (factors > 0) {
      difficulty = difficulty / (0.5 + factors * 0.2); // Adjust for number of factors
    }

    // Clamp to 0-1
    difficulty = Math.max(0, Math.min(1, difficulty));

    this.logger.debug('Task difficulty calculated', {
      difficulty,
      factors,
      taskType,
    });

    return difficulty;
  }

  /**
   * Estimate input size
   */
  private estimateInputSize(input: any): number {
    if (typeof input === 'string') {
      return input.length;
    }

    const inputStr = JSON.stringify(input);
    return inputStr.length;
  }

  /**
   * Estimate schema complexity
   */
  private estimateSchemaComplexity(schema: any): number {
    if (!schema || typeof schema !== 'object') {
      return 0.5;
    }

    // Count properties, nested objects, arrays
    let complexity = 0;
    const countComplexity = (obj: any, depth: number = 0): void => {
      if (depth > 5) return; // Prevent infinite recursion
      if (Array.isArray(obj)) {
        complexity += 0.1;
        if (obj.length > 0) {
          countComplexity(obj[0], depth + 1);
        }
      } else if (obj && typeof obj === 'object') {
        const keys = Object.keys(obj);
        complexity += keys.length * 0.05;
        for (const key of keys) {
          countComplexity(obj[key], depth + 1);
        }
      }
    };

    countComplexity(schema);

    // Normalize to 0-1
    return Math.min(1.0, complexity / 10);
  }

  /**
   * Get task type from manifest
   */
  private getTaskType(manifest: NetworkManifest): string {
    const inputSchema = manifest.taskFormat?.inputSchema as any;
    return inputSchema?.type || 'general';
  }

  /**
   * Get difficulty for task type
   */
  private getTaskTypeDifficulty(taskType: string): number {
    const typeDifficulties: Record<string, number> = {
      'code-generation': 0.8,
      'proof-verification': 0.9,
      'math-solving': 0.7,
      'text-generation': 0.4,
      'image-generation': 0.6,
      'translation': 0.5,
      'summarization': 0.5,
      'classification': 0.4,
      'general': 0.5,
    };

    return typeDifficulties[taskType.toLowerCase()] || 0.5;
  }

  /**
   * Get network age in days
   */
  private getNetworkAge(manifest: NetworkManifest): number {
    if (!manifest.createdAt) {
      return 0;
    }

    try {
      const createdDate = new Date(manifest.createdAt);
      const now = new Date();
      const diffMs = now.getTime() - createdDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      this.logger.debug('Network age calculated', {
        createdAt: manifest.createdAt,
        ageDays: diffDays,
      });

      return Math.max(0, diffDays);
    } catch (error) {
      this.logger.warn('Failed to parse network creation date', {
        createdAt: manifest.createdAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Determine network maturity
   */
  private determineMaturity(networkAge: number): 'early' | 'mature' | 'established' {
    if (networkAge < 30) {
      return 'early';
    } else if (networkAge < 180) {
      return 'mature';
    } else {
      return 'established';
    }
  }

  /**
   * Calculate adaptive exploration bias
   * 
   * Higher exploration bias when:
   * - Entropy is low (need more diversity)
   * - Mode collapse detected (need exploration)
   * - Network is early (need exploration)
   * 
   * Lower exploration bias when:
   * - Entropy is high (already diverse)
   * - Network is mature (focus on reliability)
   * - Task is difficult (need reliability)
   */
  private calculateExplorationBias(
    entropy: number,
    diversity: number,
    modeCollapseDetected: boolean,
    networkAge: number
  ): number {
    let bias = 0.5; // Start with balanced

    // Factor 1: Entropy (low entropy = need exploration)
    const entropyFactor = (1 - entropy) * 0.3; // Low entropy increases exploration
    bias += entropyFactor;

    // Factor 2: Diversity (low diversity = need exploration)
    const diversityFactor = (1 - diversity) * 0.2; // Low diversity increases exploration
    bias += diversityFactor;

    // Factor 3: Mode collapse (detected = need exploration)
    if (modeCollapseDetected) {
      bias += 0.2; // Strong signal for exploration
    }

    // Factor 4: Network age (early = need exploration, mature = reliability)
    const ageFactor = networkAge < 30 ? 0.1 : (networkAge > 180 ? -0.1 : 0);
    bias += ageFactor;

    // Clamp to 0-1
    bias = Math.max(0, Math.min(1, bias));

    this.logger.debug('Exploration bias calculated', {
      bias,
      entropy,
      diversity,
      modeCollapseDetected,
      networkAge,
    });

    return bias;
  }
}
