/**
 * Input Validator
 * 
 * Comprehensive input validation to prevent invalid data from reaching contracts
 * Validates all protocol inputs before they reach on-chain operations
 */

import { ILogger, ConsoleLogger } from './utils/ILogger';
import { NetworkCreationRequest, NetworkManifest } from './types';
import { ethers } from 'ethers';
import { JSONSchemaValidator } from './JSONSchemaValidator';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class InputValidator {
  private logger: ILogger;
  private jsonSchemaValidator: JSONSchemaValidator;

  constructor(logger?: ILogger) {
    this.logger = logger || new ConsoleLogger('InputValidator');
    this.jsonSchemaValidator = new JSONSchemaValidator(this.logger);
  }

  /**
   * Validate network creation request
   * Prevents invalid data from reaching contract deployment
   */
  async validateNetworkCreationRequest(request: NetworkCreationRequest): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate creator address
    if (!request.creatorAddress) {
      errors.push('Creator address is required');
    } else if (!this.isValidAddress(request.creatorAddress)) {
      errors.push(`Invalid creator address: ${request.creatorAddress}`);
    }

    // Validate network name
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Network name is required');
    } else if (request.name.length > 100) {
      errors.push('Network name must be 100 characters or less');
    } else if (request.name.length < 3) {
      errors.push('Network name must be at least 3 characters');
    }

    // Validate description
    if (!request.description || request.description.trim().length === 0) {
      errors.push('Network description is required');
    } else if (request.description.length > 1000) {
      errors.push('Network description must be 1000 characters or less');
    }

    // Validate task schemas
    // Validate AI Module (Module Layer) - REQUIRED
    if (!request.moduleId || typeof request.moduleId !== 'string' || request.moduleId.trim().length === 0) {
      errors.push('AI Module ID (moduleId) is required');
    } else {
      // Module existence and active status check is handled by ProtocolServiceRefactored
      // using the injected aiModuleRepo
    }

    // Task schemas are optional (provided by module) but if provided, must be valid
    if (request.taskInputSchema && typeof request.taskInputSchema !== 'object') {
      errors.push('Task input schema must be an object if provided');
    }
    if (request.taskOutputSchema && typeof request.taskOutputSchema !== 'object') {
      errors.push('Task output schema must be an object if provided');
    }

    // Scoring logic is optional (provided by module) but if provided, must be valid
    if (request.scoringModuleHash && request.scoringModuleHash.length !== 64) {
      errors.push('Scoring module hash must be 64 hex characters (32 bytes) if provided');
    }
    if (request.scoringModuleUrl && request.scoringModuleUrl.trim().length > 0 && !this.isValidUrl(request.scoringModuleUrl)) {
      errors.push(`Invalid scoring module URL: ${request.scoringModuleUrl}`);
    }

    // Validate validator config
    if (request.minValidators < 1) {
      errors.push('Minimum validators must be at least 1');
    } else if (request.minValidators > 100) {
      errors.push('Minimum validators cannot exceed 100');
    }

    if (request.consensusThreshold < 0 || request.consensusThreshold > 1) {
      errors.push('Consensus threshold must be between 0 and 1');
    } else if (request.consensusThreshold < 0.5) {
      warnings.push('Consensus threshold below 50% is risky - consider higher threshold');
    }

    if (request.disputeWindow < 0) {
      errors.push('Dispute window must be non-negative');
    } else if (request.disputeWindow < 300) {
      warnings.push('Dispute window less than 5 minutes is very short - consider longer window');
    }

    // Validate stake required
    if (request.stakeRequired) {
      const stake = parseFloat(request.stakeRequired);
      if (isNaN(stake) || stake < 0) {
        errors.push('Stake required must be a non-negative number');
      }
    }

    // Validate risk parameters
    if (request.riskParameters) {
      const riskValidation = this.validateRiskParameters(request.riskParameters);
      errors.push(...riskValidation.errors);
      warnings.push(...riskValidation.warnings);
    }

    // Validate money flow
    if (request.moneyFlow) {
      const moneyFlowValidation = this.validateMoneyFlow(request.moneyFlow);
      errors.push(...moneyFlowValidation.errors);
      warnings.push(...moneyFlowValidation.warnings);
    }

    // Validate settlement chain (if provided, though it's auto-determined)
    if (request.settlementChain) {
      const validChains = ['ethereum', 'polygon', 'bsc', 'arbitrum', 'base', 'avalanche', 'optimism', 'solana', 'tron'];
      if (!validChains.includes(request.settlementChain)) {
        errors.push(`Invalid settlement chain: ${request.settlementChain}. Must be one of: ${validChains.join(', ')}`);
      }
    }

    // Validate token config (if provided)
    if (request.token) {
      const tokenValidation = this.validateTokenConfig(request.token);
      errors.push(...tokenValidation.errors);
      warnings.push(...tokenValidation.warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate risk parameters
   */
  private validateRiskParameters(riskParams: NetworkCreationRequest['riskParameters']): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate payout cap
    if (riskParams.payoutCap) {
      const cap = parseFloat(riskParams.payoutCap);
      if (isNaN(cap) || cap < 0) {
        errors.push('Payout cap must be a non-negative number');
      } else if (cap > 1000000) {
        warnings.push('Payout cap exceeds $1M - very high risk');
      }
    }

    // Validate settlement delay
    if (riskParams.settlementDelay !== undefined) {
      if (riskParams.settlementDelay < 0) {
        errors.push('Settlement delay must be non-negative');
      } else if (riskParams.settlementDelay < 60) {
        warnings.push('Settlement delay less than 1 minute is very risky');
      }
    }

    // Validate max payout per task
    if (riskParams.maxPayoutPerTask) {
      const payout = parseFloat(riskParams.maxPayoutPerTask);
      if (isNaN(payout) || payout < 0) {
        errors.push('Max payout per task must be a non-negative number');
      } else if (payout > 100000) {
        warnings.push('Max payout per task exceeds $100K - very high risk');
      }
    }

    // Warn about dangerous combinations
    if (riskParams.singleValidator && riskParams.instantPayout) {
      warnings.push('Single validator + instant payout is extremely risky');
    }
    if (riskParams.customScoring && riskParams.nonDeterministic) {
      warnings.push('Custom scoring + non-deterministic evaluation is very risky');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate money flow configuration
   */
  private validateMoneyFlow(moneyFlow: NetworkCreationRequest['moneyFlow']): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!moneyFlow) {
      errors.push('Money flow configuration is required');
      return { valid: false, errors, warnings };
    }

    // Validate creation fee split
    if (moneyFlow.creationFeeSplit) {
      const split = moneyFlow.creationFeeSplit;
      const total = split.creatorReward + split.minerPool + split.purposeBoundSinks + split.burn;

      if (Math.abs(total - 100) > 0.01) {
        errors.push(`Creation fee split must total 100% (got ${total}%)`);
      }

      if (split.creatorReward < 0 || split.creatorReward > 100) {
        errors.push('Creator reward must be between 0 and 100');
      }
      if (split.minerPool < 0 || split.minerPool > 100) {
        errors.push('Miner pool must be between 0 and 100');
      }
      if (split.purposeBoundSinks < 0 || split.purposeBoundSinks > 100) {
        errors.push('Purpose-bound sinks must be between 0 and 100');
      }
      if (split.burn < 0 || split.burn > 100) {
        errors.push('Burn must be between 0 and 100');
      }
    }

    // Validate usage cut
    if (moneyFlow.usageCut) {
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

    // Validate validator payment
    if (moneyFlow.validatorPayment) {
      if (!moneyFlow.validatorPayment.enabled) {
        warnings.push('Validator payment is disabled - validators may not participate');
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
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate token configuration
   */
  private validateTokenConfig(token: NetworkCreationRequest['token']): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!token) {
      return { valid: true, errors, warnings };
    }

    // Validate token name
    if (!token.name || token.name.trim().length === 0) {
      errors.push('Token name is required');
    } else if (token.name.length > 50) {
      errors.push('Token name must be 50 characters or less');
    }

    // Validate token symbol
    if (!token.symbol || token.symbol.trim().length === 0) {
      errors.push('Token symbol is required');
    } else if (token.symbol.length > 10) {
      errors.push('Token symbol must be 10 characters or less');
    }

    // Validate total supply
    if (!token.totalSupply) {
      errors.push('Token total supply is required');
    } else {
      const supply = parseFloat(token.totalSupply);
      if (isNaN(supply) || supply <= 0) {
        errors.push('Token total supply must be a positive number');
      } else if (supply > 1e18) {
        warnings.push('Token total supply exceeds 1 quintillion - very large');
      }
    }

    // Validate token design
    const validDesigns = ['burn-on-use', 'earn-only', 'decay', 'stake-required'];
    if (!validDesigns.includes(token.design)) {
      errors.push(`Invalid token design: ${token.design}. Must be one of: ${validDesigns.join(', ')}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate task submission
   */
  validateTaskSubmission(
    taskId: string,
    networkId: string,
    input: any,
    depositorAddress: string,
    depositAmount: string,
    manifest: NetworkManifest
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate task ID
    if (!taskId || taskId.trim().length === 0) {
      errors.push('Task ID is required');
    } else if (taskId.length > 100) {
      errors.push('Task ID must be 100 characters or less');
    }

    // Validate network ID
    if (!networkId || networkId.trim().length === 0) {
      errors.push('Network ID is required');
    } else if (!networkId.startsWith('0x') || networkId.length !== 42) {
      errors.push('Network ID must be a valid 0x-prefixed address (42 characters)');
    }

    // Validate depositor address
    if (!depositorAddress) {
      errors.push('Depositor address is required');
    } else if (!this.isValidAddress(depositorAddress)) {
      errors.push(`Invalid depositor address: ${depositorAddress}`);
    }

    // Validate deposit amount
    if (!depositAmount) {
      errors.push('Deposit amount is required');
    } else {
      const amount = parseFloat(depositAmount);
      if (isNaN(amount) || amount <= 0) {
        errors.push('Deposit amount must be a positive number');
      } else if (amount > 1000000) {
        warnings.push('Deposit amount exceeds $1M - very high value task');
      }
    }

    // Validate input against schema using comprehensive JSON schema validation
    if (!input || typeof input !== 'object') {
      errors.push('Task input is required and must be an object');
    } else if (manifest.taskFormat?.inputSchema) {
      try {
        const validation = this.jsonSchemaValidator.validateInput(
          input,
          manifest.taskFormat.inputSchema,
          `task-input-${taskId}`
        );

        if (!validation.valid) {
          errors.push(...validation.errors);
        }

        if (validation.warnings.length > 0) {
          warnings.push(...validation.warnings);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
        errors.push(`Schema validation error: ${errorMessage}`);
        this.logger.error('Input schema validation exception', {
          taskId,
          error: errorMessage,
        });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate validator evaluation
   */
  validateValidatorEvaluation(
    validatorAddress: string,
    outputId: string,
    score: number,
    confidence: number,
    signature: string
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate validator address
    if (!validatorAddress) {
      errors.push('Validator address is required');
    } else if (!this.isValidAddress(validatorAddress)) {
      errors.push(`Invalid validator address: ${validatorAddress}`);
    }

    // Validate output ID
    if (!outputId || outputId.trim().length === 0) {
      errors.push('Output ID is required');
    } else if (outputId.length > 100) {
      errors.push('Output ID must be 100 characters or less');
    }

    // Validate score
    if (isNaN(score) || score < 0 || score > 100) {
      errors.push('Score must be a number between 0 and 100');
    } else if (score < 50) {
      warnings.push('Score below 50 indicates poor output quality');
    }

    // Validate confidence
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      errors.push('Confidence must be a number between 0 and 1');
    } else if (confidence < 0.5) {
      warnings.push('Confidence below 0.5 indicates low certainty');
    }

    // Validate signature
    if (!signature || signature.trim().length === 0) {
      errors.push('Signature is required');
    } else if (signature.length < 130) {
      errors.push('Signature appears invalid (too short)');
    } else if (!/^0x[a-fA-F0-9]+$/.test(signature)) {
      errors.push('Signature must be a valid hex string');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Check if address is valid (supports multiple wallet types)
   * Supports: Ethereum (0x...), Solana (base58), Tron (base58), Bittensor (SS58)
   */
  private isValidAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    // Ethereum address (0x followed by 40 hex characters)
    if (address.startsWith('0x') && address.length === 42) {
      try {
        return ethers.isAddress(address);
      } catch {
        return false;
      }
    }

    // Bittensor/Substrate SS58 address (starts with 5, typically 48 chars)
    if (address.startsWith('5') && address.length >= 40 && address.length <= 50) {
      // Basic SS58 format check (alphanumeric, no confusing characters)
      return /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
    }

    // Solana address (base58, typically 32-44 characters)
    if (address.length >= 32 && address.length <= 44) {
      // Base58 characters: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
      return /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
    }

    // Tron address (base58, typically 34 characters, starts with T)
    if (address.startsWith('T') && address.length === 34) {
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
    }

    return false;
  }

  /**
   * Get wallet type from address format
   */
  getWalletTypeFromAddress(address: string): 'ethereum' | 'solana' | 'tron' | 'bittensor' | 'unknown' {
    if (!address || typeof address !== 'string') {
      return 'unknown';
    }

    if (address.startsWith('0x') && address.length === 42) {
      return 'ethereum';
    }

    if (address.startsWith('5') && address.length >= 40 && address.length <= 50) {
      return 'bittensor';
    }

    if (address.startsWith('T') && address.length === 34) {
      return 'tron';
    }

    if (address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
      return 'solana';
    }

    return 'unknown';
  }

  /**
   * Check if URL is valid
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
