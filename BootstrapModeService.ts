/**
 * Bootstrap Mode Service
 * 
 * Handles bootstrap mode when network has insufficient validators or miners
 * Provides fallback mechanisms to allow networks to function while growing
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest } from './types';
import { OnChainValidatorService } from './OnChainValidatorService';
import { PrismaClient } from '@prisma/client';
import { TaskOutput, EvaluationService } from './EvaluationService';
import { PriceOracleService } from './PriceOracleService';

export interface BootstrapModeConfig {
  isActive: boolean;
  mode: 'no-validators' | 'no-miners' | 'normal';
  convertedValidators: string[]; // Miners converted to validators
  convertedMiners: string[]; // Validators converted to miners
  remainingMiners: string[]; // Miners that stayed as miners
  remainingValidators: string[]; // Validators that stayed as validators
  requiresMultipleConfirmations: boolean; // SECURITY FIX: For high-value tasks
  minConfirmationsRequired: number; // SECURITY FIX: Minimum confirmations needed
  taskValueUSD?: number; // SECURITY FIX: Task value in USD for security checks
  requiresDelay: boolean; // SECURITY FIX: High-value tasks require time delay
  delaySeconds: number; // SECURITY FIX: Delay period in seconds
  securityWarnings: string[]; // SECURITY FIX: Warnings about security risks
}

export interface BootstrapEvaluationResult {
  top2Outputs: TaskOutput[];
  validatorPicks: Map<string, string>; // validatorAddress -> outputId
  requiresUserSelection: boolean;
}

export class BootstrapModeService {
  private logger: ILogger;
  private onChainValidatorService: OnChainValidatorService;
  private prisma: PrismaClient;
  private evaluationService: EvaluationService;
  private priceOracle: PriceOracleService;
  private readonly HIGH_VALUE_THRESHOLD_USD = 1000; // $1000 USD threshold for high-value tasks
  private readonly CRITICAL_VALUE_THRESHOLD_USD = 10000; // $10,000 USD - bootstrap mode disabled
  private readonly MIN_CONFIRMATIONS_HIGH_VALUE = 3; // Minimum confirmations for high-value tasks
  private readonly MIN_CONFIRMATIONS_CRITICAL = 5; // Minimum confirmations for critical tasks (if allowed)
  private readonly HIGH_VALUE_DELAY_SECONDS = 3600; // 1 hour delay for high-value tasks in bootstrap mode

  constructor(logger: ILogger, prisma: PrismaClient, onChainValidatorService: OnChainValidatorService) {
    this.logger = logger;
    this.prisma = prisma;
    this.onChainValidatorService = onChainValidatorService;
    this.evaluationService = new EvaluationService(logger);
    this.priceOracle = new PriceOracleService(logger);
  }

  /**
   * Check if bootstrap mode should be active
   * Bootstrap mode activates when:
   * - Network has 0 validators OR
   * - Network has 0 miners
   * 
   * Bootstrap mode deactivates when:
   * - Network has both validators AND miners
   */
  async checkBootstrapMode(
    networkId: string,
    manifest: NetworkManifest,
    minerAddresses: string[],
    depositAmount?: string // SECURITY FIX: Task deposit amount for value calculation
  ): Promise<BootstrapModeConfig> {
    try {
      // Get validator count from on-chain
      const validatorCount = await this.onChainValidatorService.getTotalValidatorCount(manifest);
      const minerCount = minerAddresses.length;

      this.logger.info('Checking bootstrap mode', {
        networkId,
        validatorCount,
        minerCount
      });

      // If network has both validators and miners, use normal mode
      if (validatorCount > 0 && minerCount > 0) {
        return {
          isActive: false,
          mode: 'normal',
          convertedValidators: [],
          convertedMiners: [],
          remainingMiners: minerAddresses,
          remainingValidators: [],
          requiresMultipleConfirmations: false,
          minConfirmationsRequired: 1,
          taskValueUSD: 0,
          requiresDelay: false,
          delaySeconds: 0,
          securityWarnings: []
        };
      }

      // SECURITY FIX: Calculate task value in USD for security checks
      let taskValueUSD = 0;
      let requiresMultipleConfirmations = false;
      let minConfirmationsRequired = 1;

      if (depositAmount) {
        try {
          // Convert deposit amount to USD
          const chain = manifest.settlement.chain;
          const networkToken = manifest.settlement.tokenAddress;
          taskValueUSD = await this.priceOracle.convertToUSD(
            depositAmount,
            networkToken || '0x0000000000000000000000000000000000000000',
            chain
          );

          // SECURITY FIX: High-value tasks require multiple confirmations
          if (taskValueUSD >= this.HIGH_VALUE_THRESHOLD_USD) {
            requiresMultipleConfirmations = true;
            minConfirmationsRequired = this.MIN_CONFIRMATIONS_HIGH_VALUE;
            this.logger.warn('High-value task detected in bootstrap mode - requiring multiple confirmations', {
              networkId,
              taskValueUSD,
              minConfirmationsRequired
            });
          }
        } catch (error) {
          this.logger.warn('Failed to calculate task value, assuming low value', { error });
          // Default to low value if calculation fails
        }
      }

      // No validators scenario
      if (validatorCount === 0 && minerCount > 0) {
        const config = this.calculateNoValidatorsConfig(minerAddresses);
        return {
          isActive: true,
          mode: 'no-validators',
          ...config,
          requiresMultipleConfirmations,
          minConfirmationsRequired,
          taskValueUSD
        };
      }

      // No miners scenario
      if (minerCount === 0 && validatorCount > 0) {
        const validatorAddresses = await this.getValidatorAddresses(manifest);
        const config = this.calculateNoMinersConfig(validatorAddresses);
        return {
          isActive: true,
          mode: 'no-miners',
          ...config,
          requiresMultipleConfirmations,
          minConfirmationsRequired,
          taskValueUSD
        };
      }

      // Edge case: no validators AND no miners
      if (validatorCount === 0 && minerCount === 0) {
        this.logger.warn('Network has no validators and no miners - cannot process tasks', { networkId });
        return {
          isActive: false,
          mode: 'normal',
          convertedValidators: [],
          convertedMiners: [],
          remainingMiners: [],
          remainingValidators: [],
          requiresMultipleConfirmations: false,
          minConfirmationsRequired: 1,
          taskValueUSD: 0
        };
      }

      // Default: normal mode
      return {
        isActive: false,
        mode: 'normal',
        convertedValidators: [],
        convertedMiners: [],
        remainingMiners: minerAddresses,
        remainingValidators: [],
        requiresMultipleConfirmations: false,
        minConfirmationsRequired: 1,
        taskValueUSD: 0
      };
    } catch (error) {
      this.logger.error('Failed to check bootstrap mode', { error, networkId });
      // On error, if it's a critical value error, rethrow it
      if (error instanceof Error && error.message.includes('Bootstrap mode cannot be used')) {
        throw error;
      }
      // Otherwise, assume normal mode (safer than allowing bootstrap mode on error)
      return {
        isActive: false,
        mode: 'normal',
        convertedValidators: [],
        convertedMiners: [],
        remainingMiners: minerAddresses,
        remainingValidators: [],
        requiresMultipleConfirmations: false,
        minConfirmationsRequired: 1,
        taskValueUSD: 0,
        requiresDelay: false,
        delaySeconds: 0,
        securityWarnings: ['Bootstrap mode check failed - using normal mode for safety']
      };
    }
  }

  /**
   * Calculate bootstrap config when network has no validators
   * Option 2: Minimum + scaling (1 validator per 3 miners, minimum 1)
   */
  private calculateNoValidatorsConfig(minerAddresses: string[]): Omit<BootstrapModeConfig, 'isActive' | 'mode' | 'requiresMultipleConfirmations' | 'minConfirmationsRequired' | 'taskValueUSD'> {
    const minerCount = minerAddresses.length;

    if (minerCount === 0) {
      return {
        convertedValidators: [],
        convertedMiners: [],
        remainingMiners: [],
        remainingValidators: []
      };
    }

    // 1 miner: User approves/rerolls (no conversion needed)
    if (minerCount === 1) {
      return {
        convertedValidators: [],
        convertedMiners: [],
        remainingMiners: minerAddresses,
        remainingValidators: []
      };
    }

    // 2 miners: User picks winner (no conversion needed)
    if (minerCount === 2) {
      return {
        convertedValidators: [],
        convertedMiners: [],
        remainingMiners: minerAddresses,
        remainingValidators: []
      };
    }

    // 3+ miners: Convert miners to validators using Option 2 formula
    // Formula: validators = Math.max(1, Math.floor(miners / 3))
    const validatorCount = Math.max(1, Math.floor(minerCount / 3));
    const remainingMinerCount = minerCount - validatorCount;

    // Randomly select miners to convert to validators
    const shuffled = [...minerAddresses].sort(() => Math.random() - 0.5);
    const convertedValidators = shuffled.slice(0, validatorCount);
    const remainingMiners = shuffled.slice(validatorCount);

    this.logger.info('Bootstrap mode: Converting miners to validators', {
      totalMiners: minerCount,
      validatorsNeeded: validatorCount,
      convertedValidators,
      remainingMiners
    });

    return {
      convertedValidators,
      convertedMiners: [],
      remainingMiners,
      remainingValidators: []
    };
  }

  /**
   * Calculate bootstrap config when network has no miners
   * Reverse logic: Convert validators to miners
   */
  private calculateNoMinersConfig(validatorAddresses: string[]): Omit<BootstrapModeConfig, 'isActive' | 'mode' | 'requiresMultipleConfirmations' | 'minConfirmationsRequired' | 'taskValueUSD'> {
    const validatorCount = validatorAddresses.length;

    if (validatorCount === 0) {
      return {
        convertedValidators: [],
        convertedMiners: [],
        remainingMiners: [],
        remainingValidators: []
      };
    }

    // 1 validator: Make validator act as miner, user approves/rerolls
    if (validatorCount === 1) {
      return {
        convertedValidators: [],
        convertedMiners: validatorAddresses,
        remainingMiners: [],
        remainingValidators: []
      };
    }

    // 2 validators: Make both validators act as miners, user picks winner
    if (validatorCount === 2) {
      return {
        convertedValidators: [],
        convertedMiners: validatorAddresses,
        remainingMiners: [],
        remainingValidators: []
      };
    }

    // 3+ validators: Make 2 validators act as miners, keep 1 as validator
    // Randomly select 2 validators to become miners
    const shuffled = [...validatorAddresses].sort(() => Math.random() - 0.5);
    const convertedMiners = shuffled.slice(0, 2);
    const remainingValidators = shuffled.slice(2);

    this.logger.info('Bootstrap mode: Converting validators to miners', {
      totalValidators: validatorCount,
      convertedMiners,
      remainingValidators
    });

    return {
      convertedValidators: [],
      convertedMiners,
      remainingMiners: [],
      remainingValidators
    };
  }

  /**
   * Get validator addresses from on-chain registry
   */
  private async getValidatorAddresses(manifest: NetworkManifest): Promise<string[]> {
    try {
      if (!manifest.settlement.validatorRegistryAddress) {
        return [];
      }

      // Use OnChainValidatorService to get validator list
      const provider = (this.onChainValidatorService as any).getProvider(manifest.settlement.chain);
      if (!provider) {
        return [];
      }

      const registryABI = [
        'function getValidatorList() external view returns (address[] memory)'
      ];

      const { ethers } = await import('ethers');
      const registry = new ethers.Contract(
        manifest.settlement.validatorRegistryAddress,
        registryABI,
        provider
      );

      const addresses = await registry.getValidatorList();
      return addresses.map((addr: string) => addr.toLowerCase());
    } catch (error) {
      this.logger.error('Failed to get validator addresses', { error });
      return [];
    }
  }

  /**
   * Evaluate outputs in bootstrap mode
   * Returns top 2 outputs for user selection
   */
  async evaluateBootstrapOutputs(
    outputs: TaskOutput[],
    bootstrapConfig: BootstrapModeConfig,
    manifest: NetworkManifest,
    taskInput?: any
  ): Promise<BootstrapEvaluationResult> {
    this.logger.info('Evaluating outputs in bootstrap mode', {
      mode: bootstrapConfig.mode,
      outputCount: outputs.length,
      convertedValidators: bootstrapConfig.convertedValidators.length,
      convertedMiners: bootstrapConfig.convertedMiners.length
    });

    // No validators scenario
    if (bootstrapConfig.mode === 'no-validators') {
      return await this.evaluateNoValidatorsMode(outputs, bootstrapConfig, manifest, taskInput);
    }

    // No miners scenario
    if (bootstrapConfig.mode === 'no-miners') {
      return await this.evaluateNoMinersMode(outputs, bootstrapConfig, manifest, taskInput);
    }

    // Should not reach here in bootstrap mode
    throw new Error('Invalid bootstrap mode configuration');
  }

  /**
   * Evaluate when no validators (miners converted to validators)
   */
  private async evaluateNoValidatorsMode(
    outputs: TaskOutput[],
    config: BootstrapModeConfig,
    manifest: NetworkManifest,
    taskInput?: any
  ): Promise<BootstrapEvaluationResult> {
    const validatorPicks = new Map<string, string>();

    // If we have converted validators, they evaluate all outputs
    if (config.convertedValidators.length > 0) {
      // Each converted validator evaluates and picks top 2
      for (const validatorAddress of config.convertedValidators) {
        // Use evaluation service to select top 2
        const top2 = await this.selectTop2Outputs(outputs, validatorAddress, manifest);
        validatorPicks.set(validatorAddress, top2[0].outputId); // Validator's #1 pick
      }
    }

    // Determine top 2 outputs to show user
    let top2Outputs: TaskOutput[];

    if (outputs.length === 1) {
      // 1 miner: Show single output
      top2Outputs = outputs;
    } else if (outputs.length === 2) {
      // 2 miners: Show both outputs
      top2Outputs = outputs;
    } else {
      // 3+ miners: Use validator's top 2 picks (if available)
      if (config.convertedValidators.length > 0 && validatorPicks.size > 0) {
        // Get validator's #1 pick
        const validatorPick1 = Array.from(validatorPicks.values())[0];
        const output1 = outputs.find(o => o.outputId === validatorPick1);
        
        // Get #2 output (next best, excluding #1)
        const remainingOutputs = outputs.filter(o => o.outputId !== validatorPick1);
        const top2 = await this.selectTop2Outputs(remainingOutputs, config.convertedValidators[0], manifest, taskInput);
        const output2 = top2[0] || remainingOutputs[0];

        top2Outputs = output1 && output2 ? [output1, output2] : outputs.slice(0, 2);
      } else {
        // Fallback: Just take first 2 outputs
        top2Outputs = outputs.slice(0, 2);
      }
    }

    return {
      top2Outputs,
      validatorPicks,
      requiresUserSelection: outputs.length > 1
    };
  }

  /**
   * Evaluate when no miners (validators converted to miners)
   */
  private async evaluateNoMinersMode(
    outputs: TaskOutput[],
    config: BootstrapModeConfig,
    manifest: NetworkManifest,
    taskInput?: any
  ): Promise<BootstrapEvaluationResult> {
    const validatorPicks = new Map<string, string>();

    // If we have remaining validators, they evaluate outputs
    if (config.remainingValidators.length > 0 && outputs.length > 1) {
      for (const validatorAddress of config.remainingValidators) {
        const top2 = await this.selectTop2Outputs(outputs, validatorAddress, manifest, taskInput);
        validatorPicks.set(validatorAddress, top2[0].outputId);
      }
    }

    // Determine top 2 outputs to show user
    let top2Outputs: TaskOutput[];

    if (outputs.length === 1) {
      top2Outputs = outputs;
    } else if (outputs.length === 2) {
      top2Outputs = outputs;
    } else {
      // Should not happen in no-miners mode (max 2 converted miners)
      top2Outputs = outputs.slice(0, 2);
    }

    return {
      top2Outputs,
      validatorPicks,
      requiresUserSelection: outputs.length > 1
    };
  }

  /**
   * Select top 2 outputs using evaluation service
   * Uses actual scoring logic from network manifest
   */
  private async selectTop2Outputs(
    outputs: TaskOutput[],
    evaluatorAddress: string,
    manifest: NetworkManifest,
    taskInput?: any
  ): Promise<TaskOutput[]> {
    if (outputs.length <= 2) {
      return outputs;
    }

    try {
      // Use evaluation service to score outputs
      // Create mock evaluations for each output (validator evaluates all)
      const mockEvaluations = outputs.map(output => ({
        validatorAddress: evaluatorAddress,
        outputId: output.outputId,
        score: 50, // Default score, will be calculated by evaluation service
        confidence: 0.5,
        timestamp: Date.now(),
        signature: '' // Not needed for bootstrap mode
      }));

      // Use evaluation service to get scores
      let evaluationResult;
      if (manifest.evaluationMode === 'statistical') {
        evaluationResult = this.evaluationService.evaluateStatistical(
          'bootstrap-eval',
          outputs,
          mockEvaluations,
          new Map([[evaluatorAddress, 50]]) // Default reputation
        );
      } else {
        // Deterministic mode
        evaluationResult = await this.evaluationService.evaluateDeterministic(
          'bootstrap-eval',
          taskInput || {},
          outputs,
          mockEvaluations,
          manifest.scoringLogic.hash
        );
      }

      // Get top outputs based on scores
      if (evaluationResult.statisticalResult) {
        const topOutputs = evaluationResult.statisticalResult.topOutputs
          .slice(0, 2)
          .map(ranked => outputs.find(o => o.outputId === ranked.outputId))
          .filter((o): o is TaskOutput => o !== undefined);
        
        return topOutputs.length === 2 ? topOutputs : outputs.slice(0, 2);
      } else if (evaluationResult.deterministicResult) {
        // For deterministic, use score-based ranking
        const scored = outputs.map(output => {
          const eval_ = mockEvaluations.find(e => e.outputId === output.outputId);
          return {
            output,
            score: eval_?.score || 0
          };
        });

        const sorted = scored.sort((a, b) => b.score - a.score);
        return sorted.slice(0, 2).map(s => s.output);
      }

      // Fallback: simple hash-based selection
      return this.simpleSelectTop2(outputs, evaluatorAddress);
    } catch (error) {
      this.logger.warn('Failed to use evaluation service for top 2 selection, using fallback', { error });
      return this.simpleSelectTop2(outputs, evaluatorAddress);
    }
  }

  /**
   * Simple fallback selection method
   */
  private simpleSelectTop2(outputs: TaskOutput[], evaluatorAddress: string): TaskOutput[] {
    const sorted = [...outputs].sort((a, b) => {
      const hashA = this.simpleHash(a.outputId + evaluatorAddress);
      const hashB = this.simpleHash(b.outputId + evaluatorAddress);
      return hashB - hashA;
    });

    return sorted.slice(0, 2);
  }

  /**
   * Simple hash function for deterministic selection
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Check if validator's pick matches user's pick
   * Used for reward calculation
   */
  checkValidatorMatch(
    validatorAddress: string,
    validatorPicks: Map<string, string>,
    userSelectedOutputId: string
  ): boolean {
    const validatorPick = validatorPicks.get(validatorAddress);
    return validatorPick === userSelectedOutputId;
  }
}
