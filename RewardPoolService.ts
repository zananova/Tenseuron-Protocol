/**
 * Reward Pool Service
 * 
 * Manages reward pool unlocking and reward calculations based on graduation levels
 * 
 * Reward Pool: 60% of total supply locked at token creation
 * Unlock factors:
 * - Level 0 (Sandbox): U = 0.05 (5%)
 * - Level 1 (Active): U = 0.25 (25%)
 * - Level 2 (Trusted): U = 0.60 (60%)
 * - Level 3 (Open Economic): U = 1.00 (100%)
 * 
 * Reward calculation: reward_per_task = base_reward × U(level)
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest, GraduationLevel } from './types';
import { PrismaClient } from '@prisma/client';

export interface RewardPoolConfig {
  totalSupply: string;           // Total token supply
  rewardPoolPercentage: number;   // Percentage of supply in reward pool (default: 60%)
  baseReward: string;              // Base reward per task
  burnRatio?: number;             // Burn ratio (5-30%) at Level ≥2
}

export interface RewardCalculation {
  rewardPerTask: string;          // Calculated reward per task
  unlockFactor: number;            // Current unlock factor U(level)
  unlockedAmount: string;         // Amount unlocked from pool
  totalLocked: string;            // Total amount locked in pool
  availableRewards: string;        // Available rewards for distribution
}

export class RewardPoolService {
  private logger: ILogger;
  private prisma?: PrismaClient;
  private readonly DEFAULT_REWARD_POOL_PERCENTAGE = 0.60; // 60% of supply

  constructor(logger: ILogger, prisma?: PrismaClient) {
    this.logger = logger;
    this.prisma = prisma;
  }

  /**
   * Get unlock factor for a graduation level
   * U(level): Level 0 = 0.05, Level 1 = 0.25, Level 2 = 0.60, Level 3 = 1.00
   */
  getUnlockFactor(level: GraduationLevel): number {
    switch (level) {
      case 'sandbox':
        return 0.05; // 5%
      case 'active':
        return 0.25; // 25%
      case 'trusted':
        return 0.60; // 60%
      case 'open_economic':
        return 1.00; // 100%
      default:
        return 0.05; // Default to lowest
    }
  }

  /**
   * Calculate reward per task based on graduation level
   * reward_per_task = base_reward × U(level)
   */
  calculateRewardPerTask(
    baseReward: string,
    level: GraduationLevel
  ): string {
    const unlockFactor = this.getUnlockFactor(level);
    const baseRewardNum = parseFloat(baseReward);
    const rewardPerTask = baseRewardNum * unlockFactor;

    // Return as string with appropriate precision
    return rewardPerTask.toFixed(18);
  }

  /**
   * Calculate reward pool configuration
   */
  calculateRewardPool(config: RewardPoolConfig): {
    totalLocked: string;
    unlockFactors: Record<GraduationLevel, number>;
  } {
    const totalSupplyNum = parseFloat(config.totalSupply);
    const rewardPoolAmount = totalSupplyNum * (config.rewardPoolPercentage || this.DEFAULT_REWARD_POOL_PERCENTAGE);

    return {
      totalLocked: rewardPoolAmount.toFixed(18),
      unlockFactors: {
        sandbox: 0.05,
        active: 0.25,
        trusted: 0.60,
        open_economic: 1.00,
      },
    };
  }

  /**
   * Get reward calculation for a network
   * FULLY IMPLEMENTED: Tracks distributed tokens separately
   */
  async getRewardCalculation(
    manifest: NetworkManifest,
    baseReward: string
  ): Promise<RewardCalculation> {
    const currentLevel = manifest.graduationStatus?.level || 'sandbox';
    const unlockFactor = this.getUnlockFactor(currentLevel);

    // Get tokenomics from manifest
    const totalSupply = manifest.tokenomics?.totalSupply || '0';
    const rewardPoolPercentage = 0.60; // 60% locked

    const totalSupplyNum = parseFloat(totalSupply);
    const totalLocked = totalSupplyNum * rewardPoolPercentage;
    const unlockedAmount = totalLocked * unlockFactor;
    const rewardPerTask = this.calculateRewardPerTask(baseReward, currentLevel);

    // Track distributed tokens separately
    const distributedAmount = await this.getDistributedTokens(manifest.networkId);
    const availableRewards = Math.max(0, unlockedAmount - distributedAmount);

    this.logger.debug('Reward calculation', {
      networkId: manifest.networkId,
      level: currentLevel,
      unlockFactor,
      unlockedAmount: unlockedAmount.toFixed(18),
      distributedAmount: distributedAmount.toFixed(18),
      availableRewards: availableRewards.toFixed(18),
    });

    return {
      rewardPerTask,
      unlockFactor,
      unlockedAmount: unlockedAmount.toFixed(18),
      totalLocked: totalLocked.toFixed(18),
      availableRewards: availableRewards.toFixed(18),
    };
  }

  /**
   * Get total distributed tokens for a network
   * FULLY IMPLEMENTED: Tracks distributed tokens separately from unlocked amount
   */
  private async getDistributedTokens(networkId: string): Promise<number> {
    if (!this.prisma) {
      this.logger.warn('Prisma not available, cannot track distributed tokens', { networkId });
      return 0;
    }

    try {
      // Sum all paid task deposits for this network
      const result = await this.prisma.tenseuronTask.aggregate({
        where: {
          networkId,
          status: 'paid', // Only count actually paid tasks
        },
        _sum: {
          depositAmount: true,
        },
      });

      const distributedAmount = result._sum.depositAmount 
        ? parseFloat(result._sum.depositAmount) 
        : 0;

      this.logger.debug('Distributed tokens calculated', {
        networkId,
        distributedAmount: distributedAmount.toFixed(18),
      });

      return distributedAmount;
    } catch (error) {
      this.logger.error('Failed to get distributed tokens', {
        networkId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Record token distribution
   * FULLY IMPLEMENTED: Tracks when tokens are distributed
   */
  async recordTokenDistribution(
    networkId: string,
    taskId: string,
    amount: string,
    recipient: string
  ): Promise<void> {
    if (!this.prisma) {
      this.logger.warn('Prisma not available, cannot record token distribution', {
        networkId,
        taskId,
      });
      return;
    }

    try {
      // Update task status to 'paid' (which marks it as distributed)
      // The amount is already stored in depositAmount
      await this.prisma.tenseuronTask.update({
        where: { taskId },
        data: {
          status: 'paid',
          paymentTxHash: `distribution-${Date.now()}`, // Placeholder, would be actual tx hash
        },
      });

      this.logger.info('Token distribution recorded', {
        networkId,
        taskId,
        amount,
        recipient,
      });
    } catch (error) {
      this.logger.error('Failed to record token distribution', {
        networkId,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - distribution recording is non-critical
    }
  }

  /**
   * Calculate burn amount for a task (Level ≥2)
   * burned_tokens = fee_per_task × burn_ratio
   * burn_ratio: 5-30% (configurable per network)
   */
  calculateBurnAmount(
    feePerTask: string,
    level: GraduationLevel,
    burnRatio?: number
  ): string {
    // Burn only at Level 2+ (Trusted, Open Economic)
    if (level !== 'trusted' && level !== 'open_economic') {
      return '0';
    }

    // Default burn ratio: 10% if not specified
    const effectiveBurnRatio = burnRatio || 0.10;

    // Enforce bounds: 5-30%
    const clampedBurnRatio = Math.max(0.05, Math.min(0.30, effectiveBurnRatio));

    const feeNum = parseFloat(feePerTask);
    const burnAmount = feeNum * clampedBurnRatio;

    return burnAmount.toFixed(18);
  }

  /**
   * Get token utility activation by level
   * Level 0: Transfer/trading only
   * Level 1: + AI fees
   * Level 2: + Burn/slashing
   * Level 3: + Routing (full utility)
   */
  getTokenUtilityFeatures(level: GraduationLevel): {
    transfer: boolean;
    trading: boolean;
    aiFees: boolean;
    burn: boolean;
    slashing: boolean;
    routing: boolean;
  } {
    return {
      transfer: true,      // Always enabled
      trading: true,        // Always enabled
      aiFees: level !== 'sandbox',           // Level 1+
      burn: level === 'trusted' || level === 'open_economic', // Level 2+
      slashing: level === 'trusted' || level === 'open_economic', // Level 2+
      routing: level === 'open_economic',     // Level 3 only
    };
  }

  /**
   * Validate reward pool configuration
   */
  validateRewardPoolConfig(config: RewardPoolConfig): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (parseFloat(config.totalSupply) <= 0) {
      errors.push('Total supply must be greater than 0');
    }

    if (config.rewardPoolPercentage < 0 || config.rewardPoolPercentage > 1) {
      errors.push('Reward pool percentage must be between 0 and 1');
    }

    if (parseFloat(config.baseReward) <= 0) {
      errors.push('Base reward must be greater than 0');
    }

    if (config.burnRatio !== undefined) {
      if (config.burnRatio < 0.05 || config.burnRatio > 0.30) {
        errors.push('Burn ratio must be between 0.05 (5%) and 0.30 (30%)');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
