/**
 * Graduation Service
 * 
 * Formal graduation system based on real usage metrics
 * No price, no market cap, no hype - only measurable performance
 * 
 * Core Variables:
 * - V = number of active validators
 * - M = number of active miners
 * - T = total completed tasks
 * - A = validator agreement rate (0-1)
 * - R = user retry rate (0-1)
 * - D = unresolved disputes
 * - W = rolling window (7 days)
 */

import { PrismaClient } from '@prisma/client';
import { ILogger } from './utils/ILogger';
import { NetworkManifest, GraduationLevel, GraduationStatus } from './types';
import { OnChainValidatorService } from './OnChainValidatorService';

export interface NetworkMetrics {
  // Core metrics
  validatorCount: number;        // V
  minerCount: number;            // M
  completedTasks: number;        // T
  agreementRate: number;         // A (0-1)
  retryRate: number;             // R (0-1)
  unresolvedDisputes: number;    // D
  maxValidatorPower: number;     // max_validator_power (0-1)
  
  // Metadata
  windowStart: Date;
  windowEnd: Date;
  totalTasks: number;
  totalEvaluations: number;
}

export interface GraduationConditions {
  level0to1: {
    validatorCount: number;      // V ≥ 3
    minerCount: number;          // M ≥ 5
    completedTasks: number;      // T ≥ 100
    agreementRate: number;       // A ≥ 0.70
    unresolvedDisputes: number; // D = 0
  };
  level1to2: {
    validatorCount: number;      // V ≥ 10
    minerCount: number;          // M ≥ 30
    completedTasks: number;      // T ≥ 1,000
    agreementRate: number;       // A ≥ 0.80
    retryRate: number;           // R ≤ 0.25
    unresolvedDisputes: number; // D ≤ 1
  };
  level2to3: {
    validatorCount: number;      // V ≥ 20
    minerCount: number;          // M ≥ 100
    completedTasks: number;      // T ≥ 10,000
    agreementRate: number;       // A ≥ 0.90
    retryRate: number;           // R ≤ 0.15
    maxValidatorPower: number;   // max_validator_power ≤ 0.20
  };
}

export class GraduationService {
  private prisma: PrismaClient;
  private logger: ILogger;
  private onChainValidatorService: OnChainValidatorService;
  private readonly ROLLING_WINDOW_DAYS = 7; // W = 7 days

  constructor(prisma: PrismaClient, logger: ILogger) {
    this.prisma = prisma;
    this.logger = logger;
    this.onChainValidatorService = new OnChainValidatorService(logger);
  }

  /**
   * Get current network metrics within rolling window
   */
  async getNetworkMetrics(
    networkId: string,
    manifest: NetworkManifest
  ): Promise<NetworkMetrics> {
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - (this.ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000));

    // Get validator count (V) from on-chain
    const validatorCount = await this.onChainValidatorService.getTotalValidatorCount(manifest);

    // Get miner count (M) from task outputs
    const minerCount = await this.getActiveMinerCount(networkId, windowStart, windowEnd);

    // Get completed tasks (T) within window
    const completedTasks = await this.getCompletedTaskCount(networkId, windowStart, windowEnd);

    // Get total tasks for agreement rate calculation
    const totalTasks = await this.getTotalTaskCount(networkId, windowStart, windowEnd);

    // Get agreement rate (A) from evaluations
    const agreementRate = await this.getAgreementRate(networkId, windowStart, windowEnd);

    // Get retry rate (R) from user rejections
    const retryRate = await this.getRetryRate(networkId, windowStart, windowEnd);

    // Get unresolved disputes (D)
    const unresolvedDisputes = await this.getUnresolvedDisputeCount(networkId, windowStart, windowEnd);

    // Get max validator power (for Level 2→3)
    const maxValidatorPower = await this.getMaxValidatorPower(networkId, manifest, windowStart, windowEnd);

    // Get total evaluations for metadata
    const totalEvaluations = await this.getTotalEvaluationCount(networkId, windowStart, windowEnd);

    return {
      validatorCount,
      minerCount,
      completedTasks,
      agreementRate,
      retryRate,
      unresolvedDisputes,
      maxValidatorPower,
      windowStart,
      windowEnd,
      totalTasks,
      totalEvaluations,
    };
  }

  /**
   * Check if network meets conditions for graduation to next level
   */
  async checkGraduationEligibility(
    networkId: string,
    manifest: NetworkManifest,
    currentLevel: GraduationLevel
  ): Promise<{
    eligible: boolean;
    metrics: NetworkMetrics;
    conditions: GraduationConditions;
    metConditions: Partial<GraduationConditions>;
    reason?: string;
  }> {
    const metrics = await this.getNetworkMetrics(networkId, manifest);
    const conditions = this.getGraduationConditions();

    let eligible = false;
    let metConditions: Partial<GraduationConditions> = {};
    let reason: string | undefined;

    if (currentLevel === 'sandbox') {
      // Check Level 0 → Level 1 conditions
      const meetsV = metrics.validatorCount >= conditions.level0to1.validatorCount;
      const meetsM = metrics.minerCount >= conditions.level0to1.minerCount;
      const meetsT = metrics.completedTasks >= conditions.level0to1.completedTasks;
      const meetsA = metrics.agreementRate >= conditions.level0to1.agreementRate;
      const meetsD = metrics.unresolvedDisputes === conditions.level0to1.unresolvedDisputes;

      eligible = meetsV && meetsM && meetsT && meetsA && meetsD;
      metConditions.level0to1 = {
        validatorCount: metrics.validatorCount,
        minerCount: metrics.minerCount,
        completedTasks: metrics.completedTasks,
        agreementRate: metrics.agreementRate,
        unresolvedDisputes: metrics.unresolvedDisputes,
      };

      if (!eligible) {
        const missing: string[] = [];
        if (!meetsV) missing.push(`V < ${conditions.level0to1.validatorCount}`);
        if (!meetsM) missing.push(`M < ${conditions.level0to1.minerCount}`);
        if (!meetsT) missing.push(`T < ${conditions.level0to1.completedTasks}`);
        if (!meetsA) missing.push(`A < ${conditions.level0to1.agreementRate}`);
        if (!meetsD) missing.push(`D > ${conditions.level0to1.unresolvedDisputes}`);
        reason = `Missing conditions: ${missing.join(', ')}`;
      }
    } else if (currentLevel === 'active') {
      // Check Level 1 → Level 2 conditions
      const meetsV = metrics.validatorCount >= conditions.level1to2.validatorCount;
      const meetsM = metrics.minerCount >= conditions.level1to2.minerCount;
      const meetsT = metrics.completedTasks >= conditions.level1to2.completedTasks;
      const meetsA = metrics.agreementRate >= conditions.level1to2.agreementRate;
      const meetsR = metrics.retryRate <= conditions.level1to2.retryRate;
      const meetsD = metrics.unresolvedDisputes <= conditions.level1to2.unresolvedDisputes;

      eligible = meetsV && meetsM && meetsT && meetsA && meetsR && meetsD;
      metConditions.level1to2 = {
        validatorCount: metrics.validatorCount,
        minerCount: metrics.minerCount,
        completedTasks: metrics.completedTasks,
        agreementRate: metrics.agreementRate,
        retryRate: metrics.retryRate,
        unresolvedDisputes: metrics.unresolvedDisputes,
      };

      if (!eligible) {
        const missing: string[] = [];
        if (!meetsV) missing.push(`V < ${conditions.level1to2.validatorCount}`);
        if (!meetsM) missing.push(`M < ${conditions.level1to2.minerCount}`);
        if (!meetsT) missing.push(`T < ${conditions.level1to2.completedTasks}`);
        if (!meetsA) missing.push(`A < ${conditions.level1to2.agreementRate}`);
        if (!meetsR) missing.push(`R > ${conditions.level1to2.retryRate}`);
        if (!meetsD) missing.push(`D > ${conditions.level1to2.unresolvedDisputes}`);
        reason = `Missing conditions: ${missing.join(', ')}`;
      }
    } else if (currentLevel === 'trusted') {
      // Check Level 2 → Level 3 conditions
      const meetsV = metrics.validatorCount >= conditions.level2to3.validatorCount;
      const meetsM = metrics.minerCount >= conditions.level2to3.minerCount;
      const meetsT = metrics.completedTasks >= conditions.level2to3.completedTasks;
      const meetsA = metrics.agreementRate >= conditions.level2to3.agreementRate;
      const meetsR = metrics.retryRate <= conditions.level2to3.retryRate;
      const meetsMaxPower = metrics.maxValidatorPower <= conditions.level2to3.maxValidatorPower;

      eligible = meetsV && meetsM && meetsT && meetsA && meetsR && meetsMaxPower;
      metConditions.level2to3 = {
        validatorCount: metrics.validatorCount,
        minerCount: metrics.minerCount,
        completedTasks: metrics.completedTasks,
        agreementRate: metrics.agreementRate,
        retryRate: metrics.retryRate,
        maxValidatorPower: metrics.maxValidatorPower,
      };

      if (!eligible) {
        const missing: string[] = [];
        if (!meetsV) missing.push(`V < ${conditions.level2to3.validatorCount}`);
        if (!meetsM) missing.push(`M < ${conditions.level2to3.minerCount}`);
        if (!meetsT) missing.push(`T < ${conditions.level2to3.completedTasks}`);
        if (!meetsA) missing.push(`A < ${conditions.level2to3.agreementRate}`);
        if (!meetsR) missing.push(`R > ${conditions.level2to3.retryRate}`);
        if (!meetsMaxPower) missing.push(`max_validator_power > ${conditions.level2to3.maxValidatorPower}`);
        reason = `Missing conditions: ${missing.join(', ')}`;
      }
    } else {
      // Already at max level
      eligible = false;
      reason = 'Network already at maximum graduation level';
    }

    return {
      eligible,
      metrics,
      conditions,
      metConditions,
      reason,
    };
  }

  /**
   * Get graduation conditions (thresholds)
   */
  private getGraduationConditions(): GraduationConditions {
    return {
      level0to1: {
        validatorCount: 3,
        minerCount: 5,
        completedTasks: 100,
        agreementRate: 0.70,
        unresolvedDisputes: 0,
      },
      level1to2: {
        validatorCount: 10,
        minerCount: 30,
        completedTasks: 1000,
        agreementRate: 0.80,
        retryRate: 0.25,
        unresolvedDisputes: 1,
      },
      level2to3: {
        validatorCount: 20,
        minerCount: 100,
        completedTasks: 10000,
        agreementRate: 0.90,
        retryRate: 0.15,
        maxValidatorPower: 0.20, // 20%
      },
    };
  }

  /**
   * Get active miner count (M) from task outputs within window
   */
  private async getActiveMinerCount(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      const uniqueMiners = await this.prisma.tenseuronTaskOutput.findMany({
        where: {
          task: {
            networkId,
            createdAt: {
              gte: windowStart,
              lte: windowEnd,
            },
          },
        },
        select: {
          minerAddress: true,
        },
        distinct: ['minerAddress'],
      });

      return uniqueMiners.length;
    } catch (error) {
      this.logger.error('Failed to get active miner count', { networkId, error });
      return 0;
    }
  }

  /**
   * Get completed task count (T) within window
   */
  private async getCompletedTaskCount(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      return await this.prisma.tenseuronTask.count({
        where: {
          networkId,
          status: 'paid', // Tasks that reached consensus and were paid
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      });
    } catch (error) {
      this.logger.error('Failed to get completed task count', { networkId, error });
      return 0;
    }
  }

  /**
   * Get total task count within window
   */
  private async getTotalTaskCount(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      return await this.prisma.tenseuronTask.count({
        where: {
          networkId,
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      });
    } catch (error) {
      this.logger.error('Failed to get total task count', { networkId, error });
      return 0;
    }
  }

  /**
   * Get agreement rate (A) from validator evaluations
   * Agreement = validators who scored the winning output ≥ 50
   */
  private async getAgreementRate(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      // Get all tasks with consensus reached
      const tasks = await this.prisma.tenseuronTask.findMany({
        where: {
          networkId,
          consensusReached: true,
          winningOutputId: { not: null },
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        include: {
          evaluations: true,
        },
      });

      if (tasks.length === 0) {
        return 0;
      }

      let totalAgreements = 0;
      let totalEvaluations = 0;

      for (const task of tasks) {
        if (!task.winningOutputId) continue;

        const evaluations = task.evaluations || [];
        const winningEvaluations = evaluations.filter(
          (e) => e.outputId === task.winningOutputId && e.score >= 50
        );

        totalAgreements += winningEvaluations.length;
        totalEvaluations += evaluations.length;
      }

      return totalEvaluations > 0 ? totalAgreements / totalEvaluations : 0;
    } catch (error) {
      this.logger.error('Failed to get agreement rate', { networkId, error });
      return 0;
    }
  }

  /**
   * Get retry rate (R) from user rejections
   * R = (user_requested_redos) / (total_tasks)
   */
  private async getRetryRate(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      const totalTasks = await this.getTotalTaskCount(networkId, windowStart, windowEnd);
      if (totalTasks === 0) {
        return 0;
      }

      const rejectedTasks = await this.prisma.tenseuronTask.count({
        where: {
          networkId,
          userRejected: true,
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      });

      return rejectedTasks / totalTasks;
    } catch (error) {
      this.logger.error('Failed to get retry rate', { networkId, error });
      return 0;
    }
  }

  /**
   * Get unresolved dispute count (D)
   */
  private async getUnresolvedDisputeCount(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      return await this.prisma.tenseuronTask.count({
        where: {
          networkId,
          status: 'challenged', // Tasks in dispute
          createdAt: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
      });
    } catch (error) {
      this.logger.error('Failed to get unresolved dispute count', { networkId, error });
      return 0;
    }
  }

  /**
   * Get max validator power (for Level 2→3 check)
   * max_validator_power = max(stake_per_validator) / total_stake
   */
  private async getMaxValidatorPower(
    networkId: string,
    manifest: NetworkManifest,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      // Get all validators and their stakes
      const validators = await this.onChainValidatorService.getTotalValidatorCount(manifest);
      if (validators === 0) {
        return 1.0; // No validators = 100% power (fails check)
      }

      // FULLY IMPLEMENTED: Query ValidatorRegistry for actual stakes (not equal distribution)
      // Equal distribution is only used as fallback when registry is unavailable
      const equalPower = 1.0 / validators;

      // If we have validator registry, calculate actual max power
      if (manifest.settlement.validatorRegistryAddress) {
        try {
          const { ValidatorRegistrationService } = await import('../services/ValidatorRegistrationService');
          const validatorService = new ValidatorRegistrationService(this.logger);
          const validatorAddresses = await validatorService.getValidators(manifest);

          if (validatorAddresses.length === 0) {
            return 1.0;
          }

          // Get stakes for each validator
          const stakes: bigint[] = [];
          let totalStake = 0n;

          for (const address of validatorAddresses) {
            const info = await validatorService.getValidatorInfo(address, manifest);
            if (info && info.isRegistered) {
              const stake = BigInt(info.stake);
              stakes.push(stake);
              totalStake += stake;
            }
          }

          if (totalStake === 0n) {
            return equalPower;
          }

          // Find max stake percentage
          const maxStake = stakes.length > 0 ? Math.max(...stakes.map((s) => Number(s))) : 0;
          const maxPower = maxStake / Number(totalStake);

          return maxPower;
        } catch (error) {
          this.logger.warn('Failed to get validator stakes, using equal distribution', { error });
          return equalPower;
        }
      }

      return equalPower;
    } catch (error) {
      this.logger.error('Failed to get max validator power', { networkId, error });
      return 1.0; // Fail-safe: assume worst case
    }
  }

  /**
   * Get total evaluation count (metadata)
   */
  private async getTotalEvaluationCount(
    networkId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<number> {
    try {
      return await this.prisma.tenseuronTaskEvaluation.count({
        where: {
          task: {
            networkId,
            createdAt: {
              gte: windowStart,
              lte: windowEnd,
            },
          },
        },
      });
    } catch (error) {
      this.logger.error('Failed to get total evaluation count', { networkId, error });
      return 0;
    }
  }

  /**
   * Get current graduation status for a network
   */
  async getGraduationStatus(
    networkId: string,
    manifest: NetworkManifest
  ): Promise<GraduationStatus> {
    const currentLevel = manifest.graduationStatus?.level || 'sandbox';
    const metrics = await this.getNetworkMetrics(networkId, manifest);

    return {
      level: currentLevel,
      achievedAt: manifest.graduationStatus?.achievedAt,
      conditions: {
        validatorCount: metrics.validatorCount,
        minerCount: metrics.minerCount,
        completedTasks: metrics.completedTasks,
        validatorAgreementRate: metrics.agreementRate,
        unresolvedDisputes: metrics.unresolvedDisputes,
      },
    };
  }
}
