/**
 * Sybil Resistance Service
 * 
 * Implements proof-of-stake and reputation-based Sybil resistance
 * Prevents validator cartels and ensures economic security
 */

import { ILogger } from './utils/ILogger';
import { PrismaClient } from '@prisma/client';
import { PriceOracleService } from './PriceOracleService';
import { SupportedChain } from './types';

export interface SybilResistanceConfig {
  minStakeUSD: number;           // Minimum stake in USD to become validator
  minReputation: number;         // Minimum reputation to participate (0-100)
  maxValidatorsPerAddress: number; // Maximum validator identities per address (default: 1)
  reputationDecayRate: number;   // Reputation decay per period (0-1)
  stakeLockupPeriod: number;     // Minimum stake lockup period (seconds)
}

export interface ValidatorQualification {
  qualified: boolean;
  reasons: string[];
  stakeUSD: number;
  reputation: number;
  validatorCount: number;
}

export class SybilResistanceService {
  private logger: ILogger;
  private prisma: PrismaClient;
  private config: SybilResistanceConfig;
  private priceOracle: PriceOracleService;

  constructor(prisma: PrismaClient, logger?: Logger, config?: Partial<SybilResistanceConfig>) {
    this.prisma = prisma;
    this.logger = logger || new Logger('SybilResistanceService');
    this.priceOracle = new PriceOracleService(this.logger);
    this.config = {
      minStakeUSD: 100,              // $100 minimum stake
      minReputation: 70,             // 70/100 minimum reputation
      maxValidatorsPerAddress: 1,    // One validator per address
      reputationDecayRate: 0.01,     // 1% decay per period
      stakeLockupPeriod: 86400 * 7,  // 7 days lockup
      ...config,
    };
  }

  /**
   * Check if validator qualifies (Sybil resistance)
   * FIX #2: Now uses on-chain data first, falls back to database
   */
  async checkValidatorQualification(
    validatorAddress: string,
    networkId: string,
    validatorRegistryAddress?: string,
    chain?: string
  ): Promise<ValidatorQualification> {
    const reasons: string[] = [];
    
    // FIX #2: Try on-chain first (if registry address provided)
    if (validatorRegistryAddress && chain) {
      try {
        // Use on-chain validator registry
        const onChainQualification = await this.checkOnChainQualification(
          validatorAddress,
          validatorRegistryAddress,
          chain
        );
        
        if (onChainQualification.qualified) {
          return onChainQualification;
        }
        
        // If on-chain check fails, add reasons and continue with database fallback
        reasons.push(...onChainQualification.reasons);
      } catch (error) {
        this.logger.warn('On-chain qualification check failed, falling back to database', {
          validatorAddress,
          error
        });
      }
    }
    
    // Fallback to database (for backward compatibility)
    // Check 1: Minimum stake
    const stakeUSD = await this.getValidatorStakeUSD(validatorAddress, networkId);
    if (stakeUSD < this.config.minStakeUSD) {
      reasons.push(`Insufficient stake: $${stakeUSD.toFixed(2)} < $${this.config.minStakeUSD}`);
    }

    // Check 2: Minimum reputation
    const reputation = await this.getValidatorReputation(validatorAddress);
    if (reputation < this.config.minReputation) {
      reasons.push(`Insufficient reputation: ${reputation}/100 < ${this.config.minReputation}/100`);
    }

    // Check 3: Maximum validators per address (Sybil resistance)
    const validatorCount = await this.getValidatorCountForAddress(validatorAddress);
    if (validatorCount >= this.config.maxValidatorsPerAddress) {
      reasons.push(`Too many validator identities: ${validatorCount} >= ${this.config.maxValidatorsPerAddress}`);
    }

    const qualified = reasons.length === 0;

    return {
      qualified,
      reasons,
      stakeUSD,
      reputation,
      validatorCount,
    };
  }
  
  /**
   * FIX #2: Check qualification using on-chain validator registry
   */
  private async checkOnChainQualification(
    validatorAddress: string,
    validatorRegistryAddress: string,
    chain: string
  ): Promise<ValidatorQualification> {
    const reasons: string[] = [];
    
    try {
      // Import ethers dynamically (to avoid issues if not available)
      const { ethers } = await import('ethers');
      
      // Get RPC URL directly (chain service doesn't expose getProvider in interface)
      const rpcUrls: Record<string, string> = {
        ethereum: process.env.ETHEREUM_RPC_URL || '',
        polygon: process.env.POLYGON_RPC_URL || '',
        bsc: process.env.BSC_RPC_URL || '',
        arbitrum: process.env.ARBITRUM_RPC_URL || '',
        base: process.env.BASE_RPC_URL || '',
        avalanche: process.env.AVALANCHE_RPC_URL || '',
        optimism: process.env.OPTIMISM_RPC_URL || '',
      };
      
      const rpcUrl = rpcUrls[chain.toLowerCase()];
      if (!rpcUrl) {
        throw new Error(`No RPC URL configured for chain: ${chain}`);
      }
      
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      
      // Load ValidatorRegistry contract ABI (simplified)
      const validatorRegistryABI = [
        'function getValidator(address) view returns (address, uint256, uint256, bool, uint256, string, bytes32)',
        'function isValidator(address) view returns (bool)',
        'function hasP2PEndpoint(address) view returns (bool)',
      ];
      
      const registryContract = new ethers.Contract(
        validatorRegistryAddress,
        validatorRegistryABI,
        provider
      );
      
      // Check if validator is registered
      const isRegistered = await registryContract.isValidator(validatorAddress);
      if (!isRegistered) {
        reasons.push('Validator not registered on-chain');
        return {
          qualified: false,
          reasons,
          stakeUSD: 0,
          reputation: 0,
          validatorCount: 0,
        };
      }
      
      // Get validator info
      const validatorInfo = await registryContract.getValidator(validatorAddress);
      const stake = validatorInfo[1]; // stake
      const reputation = validatorInfo[4]; // reputation (0-100)
      
        // Convert stake to USD using price oracle (with fallback)
        const stakeAmount = parseFloat(ethers.formatEther(stake));
        let nativeTokenPrice: number;
        try {
          nativeTokenPrice = await this.priceOracle.getNativeTokenPriceUSD(chain as SupportedChain);
          // If price is 0 or invalid, use fallback
          if (nativeTokenPrice <= 0 || !isFinite(nativeTokenPrice)) {
            throw new Error('Invalid price from oracle');
          }
        } catch (error) {
          this.logger.warn('Price oracle failed, using conservative fallback', { chain, error });
          // FALLBACK: Use conservative default prices (prevents Sybil resistance from breaking)
          const fallbackPrices: Record<string, number> = {
            ethereum: 2000,
            polygon: 0.5,
            bsc: 300,
            arbitrum: 2000,
            base: 2000,
            avalanche: 20,
            optimism: 2000,
            solana: 100,
            tron: 0.1,
          };
          nativeTokenPrice = fallbackPrices[chain.toLowerCase()] || 1;
          this.logger.warn('Using fallback price for Sybil resistance', { chain, fallbackPrice: nativeTokenPrice });
        }
        
        const stakeUSD = stakeAmount * nativeTokenPrice;
        
        if (stakeUSD < this.config.minStakeUSD) {
          reasons.push(`Insufficient on-chain stake: $${stakeUSD.toFixed(2)} < $${this.config.minStakeUSD}`);
        }
      
      // Check reputation
      if (reputation < this.config.minReputation) {
        reasons.push(`Insufficient on-chain reputation: ${reputation}/100 < ${this.config.minReputation}/100`);
      }
      
      // Check P2P endpoint (required for Phase 5)
      const hasP2P = await registryContract.hasP2PEndpoint(validatorAddress);
      if (!hasP2P) {
        reasons.push('Validator missing P2P endpoint');
      }
      
      const qualified = reasons.length === 0;
      
      return {
        qualified,
        reasons,
        stakeUSD,
        reputation: Number(reputation),
        validatorCount: 1, // On-chain, one address = one validator
      };
    } catch (error) {
      this.logger.error('Failed to check on-chain qualification', {
        validatorAddress,
        validatorRegistryAddress,
        error
      });
      throw error;
    }
  }

  /**
   * Get validator total stake in USD (across all chains)
   */
  private async getValidatorStakeUSD(validatorAddress: string, networkId: string): Promise<number> {
    try {
      // Query validator stakes from database
      const validator = await this.prisma.codeValidator.findUnique({
        where: { validatorId: validatorAddress },
        include: {
          stakes: true, // Get all stakes (networkId filtering not available in schema)
        },
      });

      if (!validator || !validator.stakes || validator.stakes.length === 0) {
        return 0;
      }

      // Filter stakes by networkId manually (since schema doesn't have networkId field)
      // For now, use all stakes - networkId filtering can be added to schema later
      const relevantStakes = validator.stakes;

      // Convert all stakes to USD using price oracle
      let totalStakeUSD = 0;
      
      for (const stake of relevantStakes) {
        // Use cached USD value if available
        if (stake.amountUSD && stake.amountUSD > 0) {
          totalStakeUSD += stake.amountUSD;
          continue;
        }

        // Otherwise, fetch price and convert
        const amount = parseFloat(stake.amount.toString());
        let stakeUSD = 0;

        if (stake.tokenAddress) {
          // ERC20 token - fetch price (with fallback)
          try {
            stakeUSD = await this.priceOracle.convertToUSD(
              stake.amount.toString(),
              stake.tokenAddress,
              stake.blockchain as SupportedChain,
              stake.tokenSymbol
            );
            // If price is 0 or invalid, use fallback
            if (stakeUSD <= 0 || !isFinite(stakeUSD)) {
              throw new Error('Invalid price from oracle');
            }
          } catch (error) {
            this.logger.warn('Price oracle failed for token, using conservative fallback', { 
              tokenAddress: stake.tokenAddress, 
              chain: stake.blockchain,
              error 
            });
            // FALLBACK: Use conservative estimate (1 USD per token minimum)
            stakeUSD = amount * 1; // Conservative: assume 1 USD per token
            this.logger.warn('Using fallback price for token stake', { 
              tokenAddress: stake.tokenAddress, 
              fallbackStakeUSD: stakeUSD 
            });
          }
        } else {
          // Native token - fetch native token price (with fallback)
          try {
            const nativePrice = await this.priceOracle.getNativeTokenPriceUSD(
              stake.blockchain as SupportedChain
            );
            if (nativePrice <= 0 || !isFinite(nativePrice)) {
              throw new Error('Invalid price from oracle');
            }
            stakeUSD = amount * nativePrice;
          } catch (error) {
            this.logger.warn('Price oracle failed for native token, using fallback', { 
              chain: stake.blockchain,
              error 
            });
            // FALLBACK: Use conservative default prices
            const fallbackPrices: Record<string, number> = {
              ethereum: 2000,
              polygon: 0.5,
              bsc: 300,
              arbitrum: 2000,
              base: 2000,
              avalanche: 20,
              optimism: 2000,
              solana: 100,
              tron: 0.1,
            };
            const fallbackPrice = fallbackPrices[stake.blockchain.toLowerCase()] || 1;
            stakeUSD = amount * fallbackPrice;
            this.logger.warn('Using fallback price for native token stake', { 
              chain: stake.blockchain, 
              fallbackPrice,
              fallbackStakeUSD: stakeUSD 
            });
          }
        }

        totalStakeUSD += stakeUSD;

        // Update database with USD value for future use
        try {
          await this.prisma.validatorStake.update({
            where: { id: stake.id },
            data: { amountUSD: stakeUSD },
          });
        } catch (error) {
          this.logger.debug('Failed to update stake USD value', { stakeId: stake.id, error });
          // Don't fail - USD update is optional
        }
      }

      return totalStakeUSD;
    } catch (error) {
      this.logger.error('Failed to get validator stake', { validatorAddress, error });
      return 0;
    }
  }

  /**
   * Get validator reputation
   */
  private async getValidatorReputation(validatorAddress: string): Promise<number> {
    try {
      const validator = await this.prisma.codeValidator.findUnique({
        where: { validatorId: validatorAddress },
      });

      if (!validator) {
        return 0; // New validators start at 0
      }

      return validator.reputation;
    } catch (error) {
      this.logger.error('Failed to get validator reputation', { validatorAddress, error });
      return 0;
    }
  }

  /**
   * Get number of validator identities for an address
   * Sybil resistance: prevent one address from controlling multiple validators
   */
  private async getValidatorCountForAddress(address: string): Promise<number> {
    try {
      const count = await this.prisma.codeValidator.count({
        where: {
          validatorId: {
            contains: address.toLowerCase(),
          },
        },
      });

      return count;
    } catch (error) {
      this.logger.error('Failed to get validator count', { address, error });
      return 0;
    }
  }

  /**
   * Update validator reputation after successful validation
   * Reputation increases with correct validations
   */
  async updateReputationAfterValidation(
    validatorAddress: string,
    wasCorrect: boolean,
    consensusMatch: boolean
  ): Promise<number> {
    try {
      const validator = await this.prisma.codeValidator.findUnique({
        where: { validatorId: validatorAddress },
      });

      if (!validator) {
        throw new Error('Validator not found');
      }

      let newReputation = validator.reputation;

      if (wasCorrect && consensusMatch) {
        // Increase reputation for correct validations
        newReputation = Math.min(100, validator.reputation + 1);
      } else if (!wasCorrect) {
        // Decrease reputation for incorrect validations
        newReputation = Math.max(0, validator.reputation - 5);
      }

      // Apply reputation decay (prevent reputation inflation)
      const decay = newReputation * this.config.reputationDecayRate;
      newReputation = Math.max(0, newReputation - decay);

      await this.prisma.codeValidator.update({
        where: { validatorId: validatorAddress },
        data: {
          reputation: newReputation,
          totalValidations: validator.totalValidations + 1,
          correctValidations: wasCorrect ? validator.correctValidations + 1 : validator.correctValidations,
          incorrectValidations: !wasCorrect ? validator.incorrectValidations + 1 : validator.incorrectValidations,
          lastSeen: new Date(),
        },
      });

      this.logger.info('Validator reputation updated', {
        validatorAddress,
        oldReputation: validator.reputation,
        newReputation,
        wasCorrect,
      });

      return newReputation;
    } catch (error) {
      this.logger.error('Failed to update validator reputation', { validatorAddress, error });
      throw error;
    }
  }

  /**
   * Check if validator meets network-specific requirements
   */
  async checkNetworkRequirements(
    validatorAddress: string,
    networkId: string,
    requirements: {
      minStake?: string;
      minReputation?: number;
      requiredChains?: string[];
    }
  ): Promise<{ qualified: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    // Check stake requirement
    if (requirements.minStake) {
      const stakeUSD = await this.getValidatorStakeUSD(validatorAddress, networkId);
      const minStake = parseFloat(requirements.minStake);
      if (stakeUSD < minStake) {
        reasons.push(`Network requires minimum stake: ${requirements.minStake}, got ${stakeUSD}`);
      }
    }

    // Check reputation requirement
    if (requirements.minReputation !== undefined) {
      const reputation = await this.getValidatorReputation(validatorAddress);
      if (reputation < requirements.minReputation) {
        reasons.push(`Network requires minimum reputation: ${requirements.minReputation}, got ${reputation}`);
      }
    }

    // Check chain support
    if (requirements.requiredChains && requirements.requiredChains.length > 0) {
      const validator = await this.prisma.codeValidator.findUnique({
        where: { validatorId: validatorAddress },
      });

      if (validator) {
        const supportedChains = JSON.parse(validator.supportedBlockchains) as string[];
        const missingChains = requirements.requiredChains.filter(
          chain => !supportedChains.includes(chain)
        );

        if (missingChains.length > 0) {
          reasons.push(`Network requires chains: ${missingChains.join(', ')}, validator supports: ${supportedChains.join(', ')}`);
        }
      }
    }

    return {
      qualified: reasons.length === 0,
      reasons,
    };
  }
}
