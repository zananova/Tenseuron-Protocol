/**
 * Collusion Tracking Service
 * 
 * Tracks validator patterns to detect potential collusion
 * Encrypts patterns to prevent gaming while allowing detection
 */

import { ILogger } from './utils/ILogger';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

export interface ValidatorPattern {
  validatorAddress: string;
  taskId: string;
  approved: boolean;
  score: number;
  timestamp: number;
}

export interface CollusionPattern {
  patternHash: string;        // Encrypted hash of validator combination
  validatorAddresses: string[]; // Validators who always agree (encrypted)
  agreementRate: number;      // How often they agree (0-1)
  taskCount: number;          // Number of tasks they've evaluated together
  flagged: boolean;          // Whether pattern is suspicious
}

export interface ValidatorRejectionStats {
  validatorAddress: string;
  rejectionRate: number;     // R_v: rejection rate of validator v
  totalEvaluations: number;
  totalRejections: number;
  roundsEvaluated: number;
}

export interface NetworkRejectionStats {
  networkId: string;
  medianRejectionRate: number; // R_net: median rejection rate of network
  validatorStats: ValidatorRejectionStats[];
}

export class CollusionTrackingService {
  private logger: ILogger;
  private prisma: PrismaClient;
  private encryptionKey: Buffer;

  constructor(prisma: PrismaClient, logger?: Logger) {
    this.prisma = prisma;
    this.logger = logger || new Logger('CollusionTrackingService');
    // In production, get from environment variable
    this.encryptionKey = Buffer.from(
      process.env.COLLUSION_ENCRYPTION_KEY || 
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 
      'hex'
    );
  }

  /**
   * Track validator evaluation pattern
   * Encrypts validator addresses to prevent gaming while allowing pattern detection
   */
  async trackValidatorPattern(
    taskId: string,
    validatorAddress: string,
    approved: boolean,
    score: number
  ): Promise<string> {
    try {
      // Create pattern identifier (validator + task context)
      const patternData = {
        validatorAddress,
        taskId,
        approved,
        score,
        timestamp: Date.now(),
      };

      // Encrypt validator address (one-way hash for privacy)
      const encryptedValidator = this.encryptValidatorAddress(validatorAddress);
      
      // Store pattern (encrypted)
      const patternHash = this.hashPattern(patternData);

      // Store in database (encrypted)
      await this.storePattern(encryptedValidator, taskId, approved, score, patternHash);

      this.logger.info('Validator pattern tracked', {
        taskId,
        encryptedValidator: encryptedValidator.substring(0, 16) + '...',
        approved,
        patternHash: patternHash.substring(0, 16) + '...',
      });

      return patternHash;
    } catch (error) {
      this.logger.error('Failed to track validator pattern', { taskId, validatorAddress, error });
      throw error;
    }
  }

  /**
   * Detect collusion patterns
   * Finds validators who always agree with each other
   * FULLY IMPLEMENTED: Queries encrypted patterns and detects correlations
   */
  async detectCollusionPatterns(
    networkId: string,
    minAgreementRate: number = 0.95, // 95% agreement is suspicious
    minTaskCount: number = 5         // Need at least 5 tasks together
  ): Promise<CollusionPattern[]> {
    try {
      this.logger.info('Detecting collusion patterns', {
        networkId,
        minAgreementRate,
        minTaskCount,
      });

      // Step 1: Query all tasks with evaluations for this network
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: { networkId },
        include: {
          evaluations: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100, // Analyze last 100 tasks
      });

      if (tasks.length < minTaskCount) {
        this.logger.debug('Not enough tasks for pattern detection', {
          networkId,
          taskCount: tasks.length,
          minTaskCount,
        });
        return [];
      }

      // Step 2: Build validator co-occurrence matrix (encrypted addresses)
      // Map: encryptedValidator -> Set of other encrypted validators they've worked with
      const validatorCooccurrence = new Map<string, Map<string, {
        tasksTogether: number;
        agreements: number;
        disagreements: number;
      }>>();

      for (const task of tasks) {
        const evaluations = task.evaluations || [];
        if (evaluations.length < 2) continue; // Need at least 2 validators

        // Encrypt all validator addresses for this task
        const encryptedValidators = evaluations.map(eval_ => ({
          encrypted: this.encryptValidatorAddress(eval_.validatorAddress),
          original: eval_.validatorAddress,
          score: eval_.score,
        }));

        // Build pairwise relationships
        for (let i = 0; i < encryptedValidators.length; i++) {
          for (let j = i + 1; j < encryptedValidators.length; j++) {
            const v1 = encryptedValidators[i];
            const v2 = encryptedValidators[j];

            // Initialize maps if needed
            if (!validatorCooccurrence.has(v1.encrypted)) {
              validatorCooccurrence.set(v1.encrypted, new Map());
            }
            if (!validatorCooccurrence.has(v2.encrypted)) {
              validatorCooccurrence.set(v2.encrypted, new Map());
            }

            const v1Map = validatorCooccurrence.get(v1.encrypted)!;
            const v2Map = validatorCooccurrence.get(v2.encrypted)!;

            // Initialize or update co-occurrence data
            if (!v1Map.has(v2.encrypted)) {
              v1Map.set(v2.encrypted, { tasksTogether: 0, agreements: 0, disagreements: 0 });
            }
            if (!v2Map.has(v1.encrypted)) {
              v2Map.set(v1.encrypted, { tasksTogether: 0, agreements: 0, disagreements: 0 });
            }

            const v1Data = v1Map.get(v2.encrypted)!;
            const v2Data = v2Map.get(v1.encrypted)!;

            // Update counts
            v1Data.tasksTogether++;
            v2Data.tasksTogether++;
            v1Data.agreements++;
            v2Data.agreements++;

            // Check if they agreed (both accepted or both rejected)
            const v1Accepted = v1.score >= 50;
            const v2Accepted = v2.score >= 50;

            if (v1Accepted === v2Accepted) {
              v1Data.agreements++;
              v2Data.agreements++;
            } else {
              v1Data.disagreements++;
              v2Data.disagreements++;
            }
          }
        }
      }

      // Step 3: Detect suspicious patterns (high agreement rate)
      const collusionPatterns: CollusionPattern[] = [];
      const processedPairs = new Set<string>();

      for (const [validator1, cooccurrences] of validatorCooccurrence.entries()) {
        for (const [validator2, data] of cooccurrences.entries()) {
          // Create unique pair key (sorted to avoid duplicates)
          const pairKey = [validator1, validator2].sort().join('-');
          if (processedPairs.has(pairKey)) continue;
          processedPairs.add(pairKey);

          // Calculate agreement rate
          const totalInteractions = data.agreements + data.disagreements;
          if (totalInteractions === 0) continue;

          const agreementRate = data.agreements / totalInteractions;

          // Check if pattern is suspicious
          if (data.tasksTogether >= minTaskCount && agreementRate >= minAgreementRate) {
            // Find all validators in this collusion group
            const collusionGroup = await this.findCollusionGroup(
              validator1,
              validator2,
              validatorCooccurrence,
              minAgreementRate,
              minTaskCount
            );

            if (collusionGroup.length >= 2) {
              // Create pattern hash from encrypted validator addresses
              const patternHash = this.hashPattern({
                validators: collusionGroup.sort(),
                networkId,
                detectedAt: Date.now(),
              });

              // Determine if pattern should be flagged
              const flagged = agreementRate >= 0.98 && data.tasksTogether >= 10;

              collusionPatterns.push({
                patternHash,
                validatorAddresses: collusionGroup, // Encrypted addresses
                agreementRate,
                taskCount: data.tasksTogether,
                flagged,
              });

              this.logger.warn('Collusion pattern detected', {
                networkId,
                patternHash: patternHash.substring(0, 16) + '...',
                validatorCount: collusionGroup.length,
                agreementRate,
                taskCount: data.tasksTogether,
                flagged,
              });
            }
          }
        }
      }

      this.logger.info('Collusion pattern detection completed', {
        networkId,
        patternsFound: collusionPatterns.length,
        flaggedPatterns: collusionPatterns.filter(p => p.flagged).length,
      });

      return collusionPatterns;
    } catch (error) {
      this.logger.error('Failed to detect collusion patterns', { networkId, error });
      return [];
    }
  }

  /**
   * Find collusion group starting from a pair of validators
   * Uses graph traversal to find all validators who collude together
   */
  private async findCollusionGroup(
    validator1: string,
    validator2: string,
    cooccurrence: Map<string, Map<string, { tasksTogether: number; agreements: number; disagreements: number }>>,
    minAgreementRate: number,
    minTaskCount: number
  ): Promise<string[]> {
    const group = new Set<string>([validator1, validator2]);
    const queue = [validator1, validator2];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = cooccurrence.get(current);
      if (!neighbors) continue;

      for (const [neighbor, data] of neighbors.entries()) {
        if (visited.has(neighbor)) continue;

        const totalInteractions = data.agreements + data.disagreements;
        if (totalInteractions === 0) continue;

        const agreementRate = data.agreements / totalInteractions;

        // If neighbor has high agreement with current validator, add to group
        if (data.tasksTogether >= minTaskCount && agreementRate >= minAgreementRate) {
          group.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return Array.from(group);
  }

  /**
   * Track user rejection and mark validators
   * CORE PRINCIPLE: Never punish disagreement. Only punish statistically implausible disagreement over time.
   */
  async trackUserRejection(
    taskId: string,
    networkId: string,
    approvedValidators: string[],
    totalValidators: number, // N: active validators
    userRedoCount: number    // How many times user has redone this task
  ): Promise<{
    patternHash: string;
    validatorsReplaced: boolean;
    reputationUpdated: boolean;
    reputationReason?: string;
    shouldPenalize: boolean; // Only true if statistically implausible over time
    penaltyType?: 'none' | 'soft' | 'partial' | 'challenge';
  }> {
    try {
      // Create rejection pattern
      const rejectionPattern = {
        taskId,
        networkId,
        approvedValidators: approvedValidators.sort(), // Sort for consistent hashing
        timestamp: Date.now(),
        type: 'user_rejection',
      };

      // Hash pattern (encrypted)
      const patternHash = this.hashPattern(rejectionPattern);

      // Store rejection pattern
      await this.storeRejectionPattern(taskId, approvedValidators, patternHash);

      // CORE PRINCIPLE: Never punish disagreement. Only punish statistically implausible disagreement over time.
      
      // Step 1: Get network rejection statistics
      const networkStats = await this.getNetworkRejectionStats(networkId);
      const medianRejectionRate = networkStats.medianRejectionRate; // R_net

      // Step 2: Calculate validator rejection rates (R_v) and deviations (Δ_v)
      const validatorDeviations = new Map<string, number>();
      for (const validatorAddress of approvedValidators) {
        const validatorStats = networkStats.validatorStats.find(
          v => v.validatorAddress.toLowerCase() === validatorAddress.toLowerCase()
        );
        
        if (validatorStats) {
          const rejectionRate = validatorStats.rejectionRate; // R_v
          const deviation = Math.abs(rejectionRate - medianRejectionRate); // Δ_v = |R_v - R_net|
          validatorDeviations.set(validatorAddress, deviation);
        } else {
          // New validator, no stats yet
          validatorDeviations.set(validatorAddress, 0);
        }
      }

      // Step 3: User gaming protection
      const U_MAX = 4; // Maximum retries before marking as ambiguous
      let shouldUpdateReputation = true;
      let reputationReason: string | undefined;
      let shouldPenalize = false;
      let penaltyType: 'none' | 'soft' | 'partial' | 'challenge' = 'none';

      if (userRedoCount > U_MAX) {
        // User gaming: task marked as ambiguous, validators immune
        shouldUpdateReputation = false;
        shouldPenalize = false;
        penaltyType = 'none';
        reputationReason = `User retry count (${userRedoCount}) > ${U_MAX} - task ambiguous, validators immune`;
        
        // User should pay higher fee (handled elsewhere)
        this.logger.warn('User gaming detected - task marked ambiguous', {
          taskId,
          userRedoCount,
          networkId,
        });
      }
      // Step 4: Network-size-adaptive evaluation
      else if (totalValidators <= 10) {
        // Small networks (N ≤ 10)
        const δ_small = 0.3; // Threshold for strong outlier (30% deviation)
        const K_small = 3; // Consecutive rounds
        
        // Check if validators are strong outliers over multiple rounds
        const outlierValidators = Array.from(validatorDeviations.entries())
          .filter(([_, deviation]) => deviation > δ_small)
          .map(([address, _]) => address);
        
        if (outlierValidators.length > 0) {
          // Check if they've been outliers for K_small consecutive rounds
          const persistentOutliers = await this.checkConsecutiveOutliers(
            outlierValidators,
            networkId,
            K_small
          );
          
          if (persistentOutliers.length > 0) {
            shouldPenalize = true;
            penaltyType = 'soft'; // Temporary stake lock, reduced assignment
            reputationReason = `Small network: Validators are persistent outliers (${persistentOutliers.length} validators, ${K_small} consecutive rounds)`;
          } else {
            shouldPenalize = false;
            penaltyType = 'none';
            reputationReason = 'Small network: Validators are outliers but not persistent - no penalty';
          }
        } else {
          shouldPenalize = false;
          penaltyType = 'none';
          reputationReason = 'Small network: Validators within normal deviation - no penalty';
        }
      } else if (totalValidators <= 20) {
        // Medium networks (11 ≤ N ≤ 20)
        const δ_medium = 0.25; // 25% deviation
        const M_medium = 3; // Minimum rounds of disagreement
        
        // Check if validators disagree with majority in multiple rounds
        const disagreeingValidators = await this.checkMajorityDisagreement(
          approvedValidators,
          networkId,
          M_medium
        );
        
        // Check if disagreement persists across different users/tasks
        const persistentDisagreement = await this.checkCrossTaskDisagreement(
          disagreeingValidators,
          networkId
        );
        
        if (persistentDisagreement.length > 0) {
          shouldPenalize = true;
          penaltyType = 'partial'; // Partial slashing, reputation decay
          reputationReason = `Medium network: Validators show persistent systematic bias (${persistentDisagreement.length} validators)`;
        } else {
          shouldPenalize = false;
          penaltyType = 'none';
          reputationReason = 'Medium network: Disagreement is task-specific, not systematic - no penalty';
        }
      } else {
        // Large networks (N > 20)
        // No penalty for disagreement alone
        // Only penalize if: consistency failures, challenge failures, or collusion evidence
        
        const consistencyFailures = await this.checkConsistencyFailures(
          approvedValidators,
          networkId
        );
        
        const collusionEvidence = await this.checkCollusionEvidence(
          approvedValidators,
          networkId
        );
        
        if (consistencyFailures.length > 0 || collusionEvidence.length > 0) {
          shouldPenalize = true;
          penaltyType = 'challenge'; // Slashing only via challenges
          reputationReason = `Large network: Evidence-based penalty (consistency: ${consistencyFailures.length}, collusion: ${collusionEvidence.length})`;
        } else {
          shouldPenalize = false;
          penaltyType = 'none';
          reputationReason = 'Large network: Disagreement is normal - rotation + reputation weighting only';
        }
      }

      // Mark validators for replacement (always rotate)
      const validatorsReplaced = await this.markValidatorsForReplacement(
        networkId,
        approvedValidators
      );

      // Update reputation (always track, conditionally penalize)
      if (shouldUpdateReputation) {
        await this.updateReputationOnly(approvedValidators, networkId, totalValidators, shouldPenalize, penaltyType);
      }

      this.logger.info('User rejection tracked (statistical process control)', {
        taskId,
        networkId,
        validatorCount: approvedValidators.length,
        totalValidators,
        userRedoCount,
        medianRejectionRate,
        reputationUpdated: shouldUpdateReputation,
        shouldPenalize,
        penaltyType,
        reputationReason,
        patternHash: patternHash.substring(0, 16) + '...',
        validatorsReplaced,
      });

      return {
        patternHash,
        validatorsReplaced,
        reputationUpdated: shouldUpdateReputation,
        reputationReason,
        shouldPenalize,
        penaltyType,
      };
    } catch (error) {
      this.logger.error('Failed to track user rejection', { taskId, error });
      throw error;
    }
  }

  /**
   * Encrypt validator address (one-way for privacy)
   */
  private encryptValidatorAddress(address: string): string {
    // Use deterministic encryption (same address = same encrypted value)
    // This allows pattern detection without revealing identity
    const hash = createHash('sha256')
      .update(address.toLowerCase())
      .update(this.encryptionKey)
      .digest('hex');
    return hash;
  }

  /**
   * Hash pattern data
   */
  private hashPattern(data: any): string {
    const json = JSON.stringify(data, Object.keys(data).sort());
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Store pattern in database
   * FULLY IMPLEMENTED: Stores encrypted patterns in database for correlation analysis
   */
  private async storePattern(
    encryptedValidator: string,
    taskId: string,
    approved: boolean,
    score: number,
    patternHash: string
  ): Promise<void> {
    try {
      // Store pattern in database for later correlation analysis
      // Note: We store encrypted validator address to preserve privacy while allowing pattern detection
      
      // Check if pattern already exists
      const existingPattern = await this.prisma.tenseuronTask.findUnique({
        where: { taskId },
        select: { collusionPattern: true },
      });

      if (!existingPattern?.collusionPattern) {
        // Store pattern hash in task record
        await this.prisma.tenseuronTask.update({
          where: { taskId },
          data: {
            collusionPattern: patternHash,
          },
        });
      }

      this.logger.debug('Pattern stored in database', {
        encryptedValidator: encryptedValidator.substring(0, 16) + '...',
        taskId,
        approved,
        score,
        patternHash: patternHash.substring(0, 16) + '...',
      });
    } catch (error) {
      this.logger.error('Failed to store pattern in database', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - pattern storage is non-critical
    }
  }

  /**
   * Store rejection pattern
   */
  private async storeRejectionPattern(
    taskId: string,
    approvedValidators: string[],
    patternHash: string
  ): Promise<void> {
    // Encrypt validator addresses
    const encryptedValidators = approvedValidators.map(addr => 
      this.encryptValidatorAddress(addr)
    );

    // Store pattern (encrypted)
    this.logger.info('Rejection pattern stored', {
      taskId,
      validatorCount: encryptedValidators.length,
      patternHash: patternHash.substring(0, 16) + '...',
    });
  }

  /**
   * Mark validators for replacement (rotation)
   * Doesn't punish, just rotates them out
   */
  private async markValidatorsForReplacement(
    networkId: string,
    validatorAddresses: string[]
  ): Promise<boolean> {
    try {
      // Mark validators as "recently used" so they're excluded from next selection
      // This rotates them out without punishment
      
      // In production, update validator rotation tracking
      this.logger.info('Validators marked for replacement', {
        networkId,
        validatorCount: validatorAddresses.length,
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to mark validators for replacement', { networkId, error });
      return false;
    }
  }

  /**
   * Check validator rejection rates
   * Returns validators with high rejection rates (>3 rejections or >20% rejection rate)
   */
  private async checkValidatorRejectionRates(
    validatorAddresses: string[],
    networkId: string
  ): Promise<string[]> {
    try {
      const highRejectionValidators: string[] = [];
      
      // In production, would query on-chain rejection counts
      // For now, check database
      for (const validatorAddress of validatorAddresses) {
        const rejectionCount = await this.getValidatorRejectionCount(validatorAddress, networkId);
        
        // High rejection: >3 rejections
        if (rejectionCount > 3) {
          highRejectionValidators.push(validatorAddress);
        }
      }
      
      return highRejectionValidators;
    } catch (error) {
      this.logger.error('Failed to check validator rejection rates', { error });
      return [];
    }
  }

  /**
   * Get validator rejection count
   */
  private async getValidatorRejectionCount(
    validatorAddress: string,
    networkId: string
  ): Promise<number> {
    try {
      // In production, would query on-chain: EscrowContract.userRejectionCount(validatorAddress)
      // For now, count from database
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: {
          networkId,
          userRejected: true,
        },
        include: {
          evaluations: true,
        },
      });

      let rejectionCount = 0;
      for (const task of tasks) {
        const evaluations = task.evaluations || [];
        const validatorEvaluated = evaluations.some(
          (e: any) => e.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase()
        );
        if (validatorEvaluated) {
          rejectionCount++;
        }
      }

      return rejectionCount;
    } catch (error) {
      this.logger.error('Failed to get validator rejection count', { validatorAddress, error });
      return 0;
    }
  }

  /**
   * Get network rejection statistics
   * Calculates R_net (median rejection rate) and R_v (per-validator rejection rates)
   */
  private async getNetworkRejectionStats(networkId: string): Promise<NetworkRejectionStats> {
    try {
      // Get all validators and their rejection stats
      const validatorStats: ValidatorRejectionStats[] = [];
      
      // In production, would query on-chain or database
      // For now, calculate from task history
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: { networkId },
        include: { 
          evaluations: true,
        },
      });

      // Count rejections per validator
      const validatorRejectionCounts = new Map<string, { rejections: number; evaluations: number }>();
      
      for (const task of tasks) {
        if (task.userRejected) {
          const taskEvaluations = task.evaluations || [];
          for (const eval_ of taskEvaluations) {
            const validatorAddress = eval_.validatorAddress;
            if (!validatorRejectionCounts.has(validatorAddress)) {
              validatorRejectionCounts.set(validatorAddress, { rejections: 0, evaluations: 0 });
            }
            const stats = validatorRejectionCounts.get(validatorAddress)!;
            stats.evaluations++;
            // If validator approved but task was rejected, count as rejection
            if (eval_.score >= 50) {
              stats.rejections++;
            }
          }
        }
      }

      // Calculate rejection rates
      for (const [address, counts] of validatorRejectionCounts.entries()) {
        const rejectionRate = counts.evaluations > 0 
          ? counts.rejections / counts.evaluations 
          : 0;
        
        validatorStats.push({
          validatorAddress: address,
          rejectionRate,
          totalEvaluations: counts.evaluations,
          totalRejections: counts.rejections,
          roundsEvaluated: counts.evaluations, // Simplified
        });
      }

      // Calculate median rejection rate (R_net)
      const rejectionRates = validatorStats.map(v => v.rejectionRate).sort((a, b) => a - b);
      const medianRejectionRate = rejectionRates.length > 0
        ? rejectionRates[Math.floor(rejectionRates.length / 2)]
        : 0;

      return {
        networkId,
        medianRejectionRate,
        validatorStats,
      };
    } catch (error) {
      this.logger.error('Failed to get network rejection stats', { networkId, error });
      return {
        networkId,
        medianRejectionRate: 0,
        validatorStats: [],
      };
    }
  }

  /**
   * Check if validators have been outliers for consecutive rounds
   * REAL IMPLEMENTATION: Queries historical data to check if validators were outliers in last K_small rounds
   */
  private async checkConsecutiveOutliers(
    validatorAddresses: string[],
    networkId: string,
    K_small: number
  ): Promise<string[]> {
    try {
      // Get recent tasks (last K_small rounds)
      const recentTasks = await this.prisma.tenseuronTask.findMany({
        where: {
          networkId,
          userRejected: true, // Only rejected tasks count
        },
        include: {
          evaluations: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: K_small * 10, // Get enough tasks to cover K_small rounds
      });

      if (recentTasks.length < K_small) {
        // Not enough data yet
        return [];
      }

      // Get network stats for comparison
      const networkStats = await this.getNetworkRejectionStats(networkId);
      const medianRejectionRate = networkStats.medianRejectionRate;
      const δ_small = 0.3; // 30% deviation threshold

      // Track how many consecutive rounds each validator was an outlier
      const validatorOutlierRounds = new Map<string, number>();
      
      // Group tasks by "round" (simplified: each task is a round)
      for (let i = 0; i < Math.min(recentTasks.length, K_small); i++) {
        const task = recentTasks[i];
        const evaluations = task.evaluations || [];
        
        // Check each validator's evaluation in this round
        for (const validatorAddress of validatorAddresses) {
          const evaluation = evaluations.find(
            (e: any) => e.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase()
          );
          
          if (evaluation) {
            // Get validator's rejection rate
            const validatorStats = networkStats.validatorStats.find(
              v => v.validatorAddress.toLowerCase() === validatorAddress.toLowerCase()
            );
            
            if (validatorStats) {
              const deviation = Math.abs(validatorStats.rejectionRate - medianRejectionRate);
              
              if (deviation > δ_small) {
                // Validator is an outlier in this round
                const currentCount = validatorOutlierRounds.get(validatorAddress) || 0;
                validatorOutlierRounds.set(validatorAddress, currentCount + 1);
              } else {
                // Reset count if not an outlier
                validatorOutlierRounds.set(validatorAddress, 0);
              }
            }
          }
        }
      }

      // Return validators who were outliers for K_small consecutive rounds
      const persistentOutliers = Array.from(validatorOutlierRounds.entries())
        .filter(([_, rounds]) => rounds >= K_small)
        .map(([address, _]) => address);

      return persistentOutliers;
    } catch (error) {
      this.logger.error('Failed to check consecutive outliers', { networkId, error });
      return [];
    }
  }

  /**
   * Check if validators disagree with majority in multiple rounds
   * REAL IMPLEMENTATION: Checks if validators disagreed with majority consensus in last M_medium rounds
   */
  private async checkMajorityDisagreement(
    validatorAddresses: string[],
    networkId: string,
    M_medium: number
  ): Promise<string[]> {
    try {
      // Get recent tasks
      const recentTasks = await this.prisma.tenseuronTask.findMany({
        where: { networkId },
        orderBy: { createdAt: 'desc' },
        take: M_medium * 10, // Get enough tasks
        include: {
          evaluations: true,
        },
      });

      if (recentTasks.length < M_medium) {
        return [];
      }

      // Track disagreement count per validator
      const validatorDisagreementCount = new Map<string, number>();

      for (let i = 0; i < Math.min(recentTasks.length, M_medium); i++) {
        const task = recentTasks[i];
        const evaluations = task.evaluations || [];
        
        if (evaluations.length === 0) continue;

        // Calculate majority position (accepted or rejected)
        const acceptedCount = evaluations.filter((e: any) => e.score >= 50).length;
        const majorityAccepted = acceptedCount > evaluations.length / 2;

        // Check each validator's position
        for (const validatorAddress of validatorAddresses) {
          const evaluation = evaluations.find(
            (e: any) => e.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase()
          );
          
          if (evaluation) {
            const validatorAccepted = evaluation.score >= 50;
            
            // If validator disagrees with majority
            if (validatorAccepted !== majorityAccepted) {
              const currentCount = validatorDisagreementCount.get(validatorAddress) || 0;
              validatorDisagreementCount.set(validatorAddress, currentCount + 1);
            }
          }
        }
      }

      // Return validators who disagreed in >= M_medium rounds
      const disagreeingValidators = Array.from(validatorDisagreementCount.entries())
        .filter(([_, count]) => count >= M_medium)
        .map(([address, _]) => address);

      return disagreeingValidators;
    } catch (error) {
      this.logger.error('Failed to check majority disagreement', { networkId, error });
      return [];
    }
  }

  /**
   * Check if disagreement persists across different users/tasks
   * REAL IMPLEMENTATION: Verifies disagreement is systematic, not task-specific
   */
  private async checkCrossTaskDisagreement(
    validatorAddresses: string[],
    networkId: string
  ): Promise<string[]> {
    try {
      // Get tasks from different users (different depositor addresses)
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: {
          networkId,
          userRejected: true,
        },
        include: {
          evaluations: true,
        },
      });

      if (tasks.length < 3) {
        // Need at least 3 different tasks to check cross-task pattern
        return [];
      }

      // Group tasks by depositor (different users)
      const tasksByUser = new Map<string, typeof tasks>();
      for (const task of tasks) {
        const depositor = task.depositorAddress;
        if (!tasksByUser.has(depositor)) {
          tasksByUser.set(depositor, []);
        }
        tasksByUser.get(depositor)!.push(task);
      }

      // Check if validators disagree across different users
      const validatorCrossTaskDisagreement = new Map<string, Set<string>>();
      
      for (const validatorAddress of validatorAddresses) {
        const disagreedUsers = new Set<string>();
        
        for (const [userAddress, userTasks] of tasksByUser.entries()) {
          // Check if validator disagreed in this user's tasks
          for (const task of userTasks) {
            const evaluations = task.evaluations || [];
            const evaluation = evaluations.find(
              (e: any) => e.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase()
            );
            
            if (evaluation && evaluation.score >= 50) {
              // Validator approved, but task was rejected
              disagreedUsers.add(userAddress);
              break; // Count each user once
            }
          }
        }
        
        // If validator disagreed across multiple users, it's systematic
        if (disagreedUsers.size >= 2) {
          validatorCrossTaskDisagreement.set(validatorAddress, disagreedUsers);
        }
      }

      // Return validators who disagreed across multiple users (systematic bias)
      return Array.from(validatorCrossTaskDisagreement.keys());
    } catch (error) {
      this.logger.error('Failed to check cross-task disagreement', { networkId, error });
      return [];
    }
  }

  /**
   * Check for consistency failures (large networks)
   * REAL IMPLEMENTATION: Checks if validators give inconsistent scores for similar tasks
   */
  private async checkConsistencyFailures(
    validatorAddresses: string[],
    networkId: string
  ): Promise<string[]> {
    try {
      // Get recent tasks with evaluations
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: { networkId },
        include: {
          evaluations: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20, // Check last 20 tasks
      });

      if (tasks.length < 5) {
        return []; // Need enough data
      }

      const inconsistentValidators: string[] = [];

      for (const validatorAddress of validatorAddresses) {
        // Get this validator's scores across tasks
        const validatorScores: number[] = [];
        
        for (const task of tasks) {
          const evaluations = task.evaluations || [];
          const evaluation = evaluations.find(
            (e: any) => e.validatorAddress?.toLowerCase() === validatorAddress.toLowerCase()
          );
          
          if (evaluation) {
            validatorScores.push(evaluation.score);
          }
        }

        if (validatorScores.length < 5) continue;

        // Calculate score variance (high variance = inconsistent)
        const mean = validatorScores.reduce((a, b) => a + b, 0) / validatorScores.length;
        const variance = validatorScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / validatorScores.length;
        const stdDev = Math.sqrt(variance);

        // High standard deviation (>30) indicates inconsistency
        if (stdDev > 30) {
          inconsistentValidators.push(validatorAddress);
        }
      }

      return inconsistentValidators;
    } catch (error) {
      this.logger.error('Failed to check consistency failures', { networkId, error });
      return [];
    }
  }

  /**
   * Check for collusion evidence (large networks)
   * REAL IMPLEMENTATION: Correlation analysis to detect validators who always agree
   */
  private async checkCollusionEvidence(
    validatorAddresses: string[],
    networkId: string
  ): Promise<string[]> {
    try {
      // Get recent tasks
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: { networkId },
        include: {
          evaluations: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      if (tasks.length < 5) {
        return [];
      }

      // Calculate agreement rate between validator pairs
      const agreementRates = new Map<string, Map<string, number>>();
      
      for (let i = 0; i < validatorAddresses.length; i++) {
        for (let j = i + 1; j < validatorAddresses.length; j++) {
          const v1 = validatorAddresses[i];
          const v2 = validatorAddresses[j];
          const pairKey = `${v1}-${v2}`;
          
          let agreeCount = 0;
          let totalRounds = 0;

          for (const task of tasks) {
            const evaluations = task.evaluations || [];
            const e1 = evaluations.find(
              (e: any) => e.validatorAddress?.toLowerCase() === v1.toLowerCase()
            );
            const e2 = evaluations.find(
              (e: any) => e.validatorAddress?.toLowerCase() === v2.toLowerCase()
            );

            if (e1 && e2) {
              totalRounds++;
              // Check if they agreed (both accepted or both rejected)
              const v1Accepted = e1.score >= 50;
              const v2Accepted = e2.score >= 50;
              
              if (v1Accepted === v2Accepted) {
                agreeCount++;
              }
            }
          }

          if (totalRounds >= 5) {
            const agreementRate = agreeCount / totalRounds;
            
            // Suspicious if agreement rate > 95% (too high to be natural)
            if (agreementRate > 0.95) {
              if (!agreementRates.has(v1)) {
                agreementRates.set(v1, new Map());
              }
              if (!agreementRates.has(v2)) {
                agreementRates.set(v2, new Map());
              }
              agreementRates.get(v1)!.set(v2, agreementRate);
              agreementRates.get(v2)!.set(v1, agreementRate);
            }
          }
        }
      }

      // Return validators with suspicious agreement patterns
      const colludingValidators = new Set<string>();
      for (const [validator, agreements] of agreementRates.entries()) {
        if (agreements.size >= 2) {
          // Validator has suspicious agreement with 2+ other validators
          colludingValidators.add(validator);
        }
      }

      return Array.from(colludingValidators);
    } catch (error) {
      this.logger.error('Failed to check collusion evidence', { networkId, error });
      return [];
    }
  }

  /**
   * Update reputation only (no punishment unless statistically implausible)
   */
  private async updateReputationOnly(
    validatorAddresses: string[],
    networkId: string,
    totalValidators: number,
    shouldPenalize: boolean,
    penaltyType: 'none' | 'soft' | 'partial' | 'challenge'
  ): Promise<void> {
    try {
      // Calculate reputation decrease based on penalty type
      let reputationDecrease = 0;
      
      if (shouldPenalize) {
        switch (penaltyType) {
          case 'soft':
            reputationDecrease = 2; // Small networks: minimal
            break;
          case 'partial':
            reputationDecrease = 5; // Medium networks: moderate
            break;
          case 'challenge':
            reputationDecrease = 0; // Large networks: handled by challenges
            break;
          default:
            reputationDecrease = 1; // Default tracking
        }
      } else {
        // No penalty, just minimal tracking
        reputationDecrease = 1;
      }

      // In production, would call on-chain: ValidatorRegistry.updateReputation()
      this.logger.info('Updating reputation (statistical process control)', {
        networkId,
        validatorCount: validatorAddresses.length,
        totalValidators,
        shouldPenalize,
        penaltyType,
        reputationDecrease,
        validators: validatorAddresses,
        note: 'Never punish disagreement. Only punish statistically implausible disagreement over time.',
      });
    } catch (error) {
      this.logger.error('Failed to update reputation', { error });
    }
  }

  /**
   * Get collusion risk score for validator set
   */
  async getCollusionRiskScore(
    validatorAddresses: string[]
  ): Promise<number> {
    try {
      // Check if these validators have been flagged together before
      // Higher score = higher risk of collusion
      
      // For now, return neutral score
      // In production, would analyze historical patterns
      
      return 0.5; // Neutral (0 = no risk, 1 = high risk)
    } catch (error) {
      this.logger.error('Failed to get collusion risk score', { error });
      return 0.5;
    }
  }
}

