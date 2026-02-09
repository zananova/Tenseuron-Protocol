/**
 * Sybil Resistance Service Refactored
 * 
 * Database-agnostic version using repository pattern
 * Implements proof-of-stake and reputation-based Sybil resistance
 */

import { ILogger } from './utils/ILogger';
import { IValidatorRepository, ValidatorData } from './interfaces/IValidatorRepository';
import { OnChainValidatorService } from './OnChainValidatorService';
import { PriceOracleService } from './PriceOracleService';
import { NetworkManifest, SupportedChain } from './types';

export interface SybilResistanceConfig {
    minStakeUSD: number;
    minReputation: number;
    maxValidatorsPerAddress: number;
    reputationDecayRate: number;
    stakeLockupPeriod: number;
}

export interface ValidatorQualification {
    qualified: boolean;
    reasons: string[];
    stakeUSD: number;
    reputation: number;
    validatorCount: number;
}

export interface SybilResistanceServiceDependencies {
    validatorRepository: IValidatorRepository;
    onChainValidatorService: OnChainValidatorService;
    priceOracleService: PriceOracleService;
}

export class SybilResistanceServiceRefactored {
    private logger: ILogger;
    private validatorRepo: IValidatorRepository;
    private onChainValidatorService: OnChainValidatorService;
    private priceOracle: PriceOracleService;
    private config: SybilResistanceConfig;

    constructor(
        logger: ILogger,
        dependencies: SybilResistanceServiceDependencies,
        config?: Partial<SybilResistanceConfig>
    ) {
        this.logger = logger;
        this.validatorRepo = dependencies.validatorRepository;
        this.onChainValidatorService = dependencies.onChainValidatorService;
        this.priceOracle = dependencies.priceOracleService;
        this.config = {
            minStakeUSD: 100,
            minReputation: 70,
            maxValidatorsPerAddress: 1,
            reputationDecayRate: 0.01,
            stakeLockupPeriod: 86400 * 7,
            ...config,
        };
    }

    /**
     * Check if validator qualifies (Sybil resistance)
     * Uses repository instead of direct Prisma calls
     */
    async checkValidatorQualification(
        validatorAddress: string,
        networkId: string,
        validatorRegistryAddress?: string,
        chain?: string
    ): Promise<ValidatorQualification> {
        const reasons: string[] = [];

        // Try on-chain first (if registry address provided)
        if (validatorRegistryAddress && chain) {
            try {
                const onChainQualification = await this.checkOnChainQualification(
                    validatorAddress,
                    validatorRegistryAddress,
                    chain
                );

                if (onChainQualification.qualified) {
                    return onChainQualification;
                }

                reasons.push(...onChainQualification.reasons);
            } catch (error) {
                this.logger.warn('On-chain qualification check failed, falling back to database', {
                    validatorAddress,
                    error
                });
            }
        }

        // Fallback to database (using repository)
        const validator = await this.validatorRepo.findByAddress(validatorAddress, networkId);

        if (!validator) {
            return {
                qualified: false,
                reasons: ['Validator not registered'],
                stakeUSD: 0,
                reputation: 0,
                validatorCount: 0,
            };
        }

        // Check 1: Minimum stake
        const stakeUSD = parseFloat(validator.stake);
        if (stakeUSD < this.config.minStakeUSD) {
            reasons.push(`Insufficient stake: $${stakeUSD.toFixed(2)} < $${this.config.minStakeUSD}`);
        }

        // Check 2: Minimum reputation
        if (validator.reputation < this.config.minReputation) {
            reasons.push(`Insufficient reputation: ${validator.reputation}/100 < ${this.config.minReputation}/100`);
        }

        // Check 3: Validator is active
        if (!validator.isActive) {
            reasons.push('Validator is not active');
        }

        // Check 4: Validator is not banned
        if (validator.isBanned) {
            reasons.push('Validator is banned');
        }

        const qualified = reasons.length === 0;

        return {
            qualified,
            reasons,
            stakeUSD,
            reputation: validator.reputation,
            validatorCount: 1,
        };
    }

    /**
     * Check qualification using on-chain validator registry
     */
    private async checkOnChainQualification(
        validatorAddress: string,
        validatorRegistryAddress: string,
        chain: string
    ): Promise<ValidatorQualification> {
        const reasons: string[] = [];

        try {
            const { ethers } = await import('ethers');

            // Get RPC URL
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

            // Load ValidatorRegistry contract ABI
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
            const stake = validatorInfo[1];
            const reputation = validatorInfo[4];

            // Convert stake to USD
            const stakeAmount = parseFloat(ethers.formatEther(stake));
            let nativeTokenPrice: number;

            try {
                nativeTokenPrice = await this.priceOracle.getNativeTokenPriceUSD(chain as SupportedChain);
                if (nativeTokenPrice <= 0 || !isFinite(nativeTokenPrice)) {
                    throw new Error('Invalid price from oracle');
                }
            } catch (error) {
                // Fallback prices
                const fallbackPrices: Record<string, number> = {
                    ethereum: 2000,
                    polygon: 0.5,
                    bsc: 300,
                    arbitrum: 2000,
                    base: 2000,
                    avalanche: 20,
                    optimism: 2000,
                };
                nativeTokenPrice = fallbackPrices[chain.toLowerCase()] || 1;
                this.logger.warn('Using fallback price for Sybil resistance', { chain, fallbackPrice: nativeTokenPrice });
            }

            const stakeUSD = stakeAmount * nativeTokenPrice;

            if (stakeUSD < this.config.minStakeUSD) {
                reasons.push(`Insufficient on-chain stake: $${stakeUSD.toFixed(2)} < $${this.config.minStakeUSD}`);
            }

            if (reputation < this.config.minReputation) {
                reasons.push(`Insufficient on-chain reputation: ${reputation}/100 < ${this.config.minReputation}/100`);
            }

            // Check P2P endpoint
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
                validatorCount: 1,
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
     * Update validator reputation after validation
     * Uses repository instead of direct Prisma calls
     */
    async updateReputationAfterValidation(
        validatorAddress: string,
        networkId: string,
        wasCorrect: boolean,
        consensusMatch: boolean
    ): Promise<number> {
        try {
            const validator = await this.validatorRepo.findByAddress(validatorAddress, networkId);

            if (!validator) {
                throw new Error('Validator not found');
            }

            let newReputation = validator.reputation;

            if (wasCorrect && consensusMatch) {
                newReputation = Math.min(100, validator.reputation + 1);
            } else if (!wasCorrect) {
                newReputation = Math.max(0, validator.reputation - 5);
            }

            // Apply reputation decay
            const decay = newReputation * this.config.reputationDecayRate;
            newReputation = Math.max(0, newReputation - decay);

            // Update reputation via repository
            await this.validatorRepo.updateReputation(validatorAddress, networkId, newReputation);

            // Update last active timestamp
            await this.validatorRepo.updateLastActive(validatorAddress, networkId);

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
     * Uses repository instead of direct Prisma calls
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

        const validator = await this.validatorRepo.findByAddress(validatorAddress, networkId);

        if (!validator) {
            return {
                qualified: false,
                reasons: ['Validator not found'],
            };
        }

        // Check stake requirement
        if (requirements.minStake) {
            const stakeUSD = parseFloat(validator.stake);
            const minStake = parseFloat(requirements.minStake);
            if (stakeUSD < minStake) {
                reasons.push(`Network requires minimum stake: ${requirements.minStake}, got ${stakeUSD}`);
            }
        }

        // Check reputation requirement
        if (requirements.minReputation !== undefined) {
            if (validator.reputation < requirements.minReputation) {
                reasons.push(`Network requires minimum reputation: ${requirements.minReputation}, got ${validator.reputation}`);
            }
        }

        return {
            qualified: reasons.length === 0,
            reasons,
        };
    }
}
