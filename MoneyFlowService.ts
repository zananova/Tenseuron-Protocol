/**
 * Money Flow Service
 * 
 * Protocol-level money routing for:
 * - Creation fees (split to creator/miner pool/purpose-bound sinks/burn)
 * - Usage cuts (per-task creator revenue)
 * 
 * Purpose-bound sinks: No human control, no discretionary spending, no governance theater.
 * Funds go to: validator subsidy (usage-smoothing mint), audit bonds, loser-pays disputes, opt-in infra streams.
 * 
 * All routing is protocol-level and cannot be bypassed.
 */

import { ILogger } from './utils/ILogger';
import { SupportedChain } from './types';
import { multiChainService } from '../services/chains/MultiChainService';
import { ethers } from 'ethers';
import { getInvariantChecker } from './InvariantChecker';

export interface CreationFeeSplit {
  creatorReward: number;      // % to creator (0-100)
  minerPool: number;          // % to miner reward pool
  purposeBoundSinks: number;  // % to purpose-bound sinks (validator subsidy, audit bonds, disputes, infra)
  burn: number;               // % to burn
}

export interface UsageCut {
  enabled: boolean;
  percentage: number;         // % of task payment to creator
  minCut: string;            // Minimum cut per task
  maxCut: string;            // Maximum cut per task
}

export interface ValidatorPayment {
  enabled: boolean;
  percentage: number;         // % of task payment to validators (split equally among participating validators)
  minPayment: string;        // Minimum payment per validator
  maxPayment: string;        // Maximum payment per validator
}

export interface MoneyFlowConfig {
  creationFeeSplit: CreationFeeSplit;
  usageCut: UsageCut;
  validatorPayment: ValidatorPayment; // CRITICAL: Validators must be paid
}

export interface CreationFeeRouting {
  creatorReward: string;     // Amount to creator
  minerPool: string;         // Amount to miner pool
  purposeBoundSinks: string; // Amount to purpose-bound sinks (validator subsidy, audit bonds, disputes, infra)
  burn: string;              // Amount to burn
  total: string;             // Total creation fee
}

export interface TaskPaymentRouting {
  minerPayment: string;      // Amount to miner (after cuts)
  creatorCut: string;        // Amount to creator (usage cut)
  validatorPayment: string;  // Amount to validators (split among participants)
  total: string;             // Total task payment
}

export class MoneyFlowService {
  private logger: ILogger;
  private purposeBoundSinksAddress: string; // Purpose-bound sinks address (0x0 = burn-only, no accumulation)

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('MoneyFlowService');
    // Purpose-bound sinks address (can be configured via env)
    // If 0x0, sinks portion goes to burn (no accumulation, no human control)
    // Purpose-bound sinks: validator subsidy (auto-mint), audit bonds, loser-pays disputes, opt-in infra streams
    this.purposeBoundSinksAddress = process.env.PURPOSE_BOUND_SINKS_ADDRESS || '0x0000000000000000000000000000000000000000';
  }

  /**
   * Route creation fees according to money flow config
   * Protocol-level: This is enforced in smart contracts
   */
  routeCreationFee(
    totalFee: string,
    creatorAddress: string,
    moneyFlow: MoneyFlowConfig
  ): CreationFeeRouting {
    const total = parseFloat(totalFee);
    
    // Calculate splits
    const creatorReward = (total * moneyFlow.creationFeeSplit.creatorReward / 100).toString();
    const minerPool = (total * moneyFlow.creationFeeSplit.minerPool / 100).toString();
    const purposeBoundSinks = (total * moneyFlow.creationFeeSplit.purposeBoundSinks / 100).toString();
    const burn = (total * moneyFlow.creationFeeSplit.burn / 100).toString();

    // Verify splits total 100%
    const totalSplit = moneyFlow.creationFeeSplit.creatorReward +
                       moneyFlow.creationFeeSplit.minerPool +
                       moneyFlow.creationFeeSplit.purposeBoundSinks +
                       moneyFlow.creationFeeSplit.burn;
    
    // Runtime invariant check: percentage split must sum to 100%
    const invariantChecker = getInvariantChecker();
    invariantChecker.checkPercentageSplit(
      'MoneyFlowService.routeCreationFee',
      {
        creatorReward: moneyFlow.creationFeeSplit.creatorReward,
        minerPool: moneyFlow.creationFeeSplit.minerPool,
        purposeBoundSinks: moneyFlow.creationFeeSplit.purposeBoundSinks,
        burn: moneyFlow.creationFeeSplit.burn,
      },
      100,
      0.01
    );
    
    if (Math.abs(totalSplit - 100) > 0.01) {
      throw new Error(`Creation fee split must total 100% (got ${totalSplit}%)`);
    }

    // Runtime invariant check: money conservation
    const totalOut = parseFloat(creatorReward) + parseFloat(minerPool) + 
                     parseFloat(purposeBoundSinks) + parseFloat(burn);
    invariantChecker.checkMoneyConservation(
      'MoneyFlowService.routeCreationFee',
      total,
      totalOut
    );

    // Runtime invariant check: no negative amounts
    invariantChecker.checkNoNegativeAmounts(
      'MoneyFlowService.routeCreationFee',
      {
        creatorReward: parseFloat(creatorReward),
        minerPool: parseFloat(minerPool),
        purposeBoundSinks: parseFloat(purposeBoundSinks),
        burn: parseFloat(burn),
        total,
      }
    );

    this.logger.info('Creation fee routing calculated', {
      total,
      creatorReward,
      minerPool,
      purposeBoundSinks,
      burn,
      creatorAddress,
    });

    return {
      creatorReward,
      minerPool,
      purposeBoundSinks,
      burn,
      total: totalFee,
    };
  }

  /**
   * Calculate usage cut for a task payment
   * Protocol-level: This is enforced in smart contracts
   */
  calculateUsageCut(
    taskPayment: string,
    moneyFlow: MoneyFlowConfig
  ): TaskPaymentRouting {
    const payment = parseFloat(taskPayment);
    let creatorCut = '0';
    let validatorPayment = '0';
    let minerPayment = taskPayment;

    // Calculate creator cut (usage cut)
    if (moneyFlow.usageCut.enabled) {
      const percentage = moneyFlow.usageCut.percentage;
      creatorCut = (payment * percentage / 100).toString();
      
      // Apply min/max bounds
      const minCut = parseFloat(moneyFlow.usageCut.minCut);
      const maxCut = parseFloat(moneyFlow.usageCut.maxCut);
      const cutAmount = parseFloat(creatorCut);
      
      if (cutAmount < minCut) {
        creatorCut = minCut.toString();
      } else if (cutAmount > maxCut) {
        creatorCut = maxCut.toString();
      }
    }

    // Calculate validator payment
    if (moneyFlow.validatorPayment?.enabled) {
      const validatorPercentage = moneyFlow.validatorPayment.percentage;
      validatorPayment = (payment * validatorPercentage / 100).toString();
      
      // Apply min/max bounds
      const minPayment = parseFloat(moneyFlow.validatorPayment.minPayment);
      const maxPayment = parseFloat(moneyFlow.validatorPayment.maxPayment);
      const paymentAmount = parseFloat(validatorPayment);
      
      if (paymentAmount < minPayment) {
        validatorPayment = minPayment.toString();
      } else if (paymentAmount > maxPayment) {
        validatorPayment = maxPayment.toString();
      }
    }

    // Miner gets the remainder (after creator cut and validator payment)
    const totalCuts = parseFloat(creatorCut) + parseFloat(validatorPayment);
    minerPayment = (payment - totalCuts).toString();

    this.logger.info('Usage cut calculated', {
      taskPayment,
      creatorCut,
      validatorPayment,
      minerPayment,
      total: taskPayment,
    });

    return {
      minerPayment,
      creatorCut,
      validatorPayment,
      total: taskPayment,
    };
  }

  /**
   * Get purpose-bound sinks address
   * Returns 0x0 if no accumulation (burn-only, no human control)
   */
  getPurposeBoundSinksAddress(): string {
    return this.purposeBoundSinksAddress;
  }

  /**
   * Validate money flow configuration
   */
  validateMoneyFlowConfig(moneyFlow: MoneyFlowConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate creation fee split
    const totalSplit = moneyFlow.creationFeeSplit.creatorReward +
                       moneyFlow.creationFeeSplit.minerPool +
                       moneyFlow.creationFeeSplit.purposeBoundSinks +
                       moneyFlow.creationFeeSplit.burn;
    
    if (Math.abs(totalSplit - 100) > 0.01) {
      errors.push(`Creation fee split must total 100% (got ${totalSplit}%)`);
    }

    // Validate percentages are non-negative
    if (moneyFlow.creationFeeSplit.creatorReward < 0 || moneyFlow.creationFeeSplit.creatorReward > 100) {
      errors.push('Creator reward must be between 0 and 100');
    }
    if (moneyFlow.creationFeeSplit.minerPool < 0 || moneyFlow.creationFeeSplit.minerPool > 100) {
      errors.push('Miner pool must be between 0 and 100');
    }
    if (moneyFlow.creationFeeSplit.purposeBoundSinks < 0 || moneyFlow.creationFeeSplit.purposeBoundSinks > 100) {
      errors.push('Purpose-bound sinks must be between 0 and 100');
    }
    if (moneyFlow.creationFeeSplit.burn < 0 || moneyFlow.creationFeeSplit.burn > 100) {
      errors.push('Burn must be between 0 and 100');
    }

    // Validate usage cut
    if (moneyFlow.usageCut.enabled) {
      if (moneyFlow.usageCut.percentage < 0 || moneyFlow.usageCut.percentage > 100) {
        errors.push('Usage cut percentage must be between 0 and 100');
      }
      
      const minCut = parseFloat(moneyFlow.usageCut.minCut);
      const maxCut = parseFloat(moneyFlow.usageCut.maxCut);
      
      if (isNaN(minCut) || minCut < 0) {
        errors.push('Minimum usage cut must be a non-negative number');
      }
      if (isNaN(maxCut) || maxCut < 0) {
        errors.push('Maximum usage cut must be a non-negative number');
      }
      if (minCut > maxCut) {
        errors.push('Minimum usage cut cannot exceed maximum usage cut');
      }
    }

    // Validate validator payment (CRITICAL: Must be enabled)
    if (!moneyFlow.validatorPayment.enabled) {
      errors.push('Validator payment must be enabled (validators must be paid)');
    } else {
      if (moneyFlow.validatorPayment.percentage < 0 || moneyFlow.validatorPayment.percentage > 100) {
        errors.push('Validator payment percentage must be between 0 and 100');
      }
      
      const minPayment = parseFloat(moneyFlow.validatorPayment.minPayment);
      const maxPayment = parseFloat(moneyFlow.validatorPayment.maxPayment);
      
      if (isNaN(minPayment) || minPayment < 0) {
        errors.push('Minimum validator payment must be a non-negative number');
      }
      if (isNaN(maxPayment) || maxPayment < 0) {
        errors.push('Maximum validator payment must be a non-negative number');
      }
      if (minPayment > maxPayment) {
        errors.push('Minimum validator payment cannot exceed maximum validator payment');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get default money flow configuration
   * Used when creator doesn't specify custom config
   * CRITICAL: Validators must be paid (default 10% of task payment)
   */
  getDefaultMoneyFlowConfig(): MoneyFlowConfig {
    return {
      creationFeeSplit: {
        creatorReward: 20,      // 20% to creator
        minerPool: 50,         // 50% to miner pool
        purposeBoundSinks: 20,  // 20% to purpose-bound sinks (validator subsidy, audit bonds, disputes, infra)
        burn: 10,              // 10% burned
      },
      usageCut: {
        enabled: true,
        percentage: 5,         // 5% of task payment to creator
        minCut: '0.0001',      // Minimum 0.0001 ETH/token
        maxCut: '1.0',         // Maximum 1.0 ETH/token
      },
      validatorPayment: {
        enabled: true,          // CRITICAL: Validators must be paid
        percentage: 10,        // 10% of task payment to validators (split equally)
        minPayment: '0.0001',  // Minimum 0.0001 ETH/token per validator
        maxPayment: '0.5',     // Maximum 0.5 ETH/token per validator
      },
    };
  }

  /**
   * Get recommended money flow config based on risk category
   * Higher risk = more to purpose-bound sinks/burn, less to creator
   */
  getRecommendedMoneyFlowConfig(riskCategory: 'safe' | 'moderate' | 'risky' | 'dangerous'): MoneyFlowConfig {
    switch (riskCategory) {
      case 'safe':
        return {
          creationFeeSplit: {
            creatorReward: 30,      // Higher creator reward for safe networks
            minerPool: 50,
            purposeBoundSinks: 15,  // 15% to purpose-bound sinks
            burn: 5,
          },
          usageCut: {
            enabled: true,
            percentage: 5,
            minCut: '0.0001',
            maxCut: '1.0',
          },
          validatorPayment: {
            enabled: true,          // CRITICAL: Validators must be paid
            percentage: 10,        // 10% of task payment to validators
            minPayment: '0.0001',
            maxPayment: '0.5',
          },
        };
      
      case 'moderate':
        return {
          creationFeeSplit: {
            creatorReward: 20,
            minerPool: 50,
            purposeBoundSinks: 20,  // 20% to purpose-bound sinks
            burn: 10,
          },
          usageCut: {
            enabled: true,
            percentage: 5,
            minCut: '0.0001',
            maxCut: '1.0',
          },
          validatorPayment: {
            enabled: true,          // CRITICAL: Validators must be paid
            percentage: 10,
            minPayment: '0.0001',
            maxPayment: '0.5',
          },
        };
      
      case 'risky':
        return {
          creationFeeSplit: {
            creatorReward: 10,      // Lower creator reward for risky networks
            minerPool: 50,
            purposeBoundSinks: 30,  // More to purpose-bound sinks
            burn: 10,
          },
          usageCut: {
            enabled: true,
            percentage: 3,          // Lower usage cut
            minCut: '0.0001',
            maxCut: '0.5',
          },
          validatorPayment: {
            enabled: true,          // CRITICAL: Validators must be paid
            percentage: 10,
            minPayment: '0.0001',
            maxPayment: '0.5',
          },
        };
      
      case 'dangerous':
        return {
          creationFeeSplit: {
            creatorReward: 5,       // Minimal creator reward
            minerPool: 50,
            purposeBoundSinks: 35,  // Most to purpose-bound sinks
            burn: 10,
          },
          usageCut: {
            enabled: true,
            percentage: 2,          // Very low usage cut
            minCut: '0.0001',
            maxCut: '0.1',
          },
          validatorPayment: {
            enabled: true,          // CRITICAL: Validators must be paid
            percentage: 10,
            minPayment: '0.0001',
            maxPayment: '0.5',
          },
        };
      
      default:
        return this.getDefaultMoneyFlowConfig();
    }
  }
}
