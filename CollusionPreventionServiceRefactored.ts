/**
 * Collusion Prevention Service Refactored
 * 
 * Database-agnostic version using repository pattern
 * Prevents and mitigates validator collusion
 */

import { ILogger } from './utils/ILogger';
import { IValidatorRepository } from './interfaces/IValidatorRepository';
import { IValidatorInteractionRepository } from './interfaces/IValidatorInteractionRepository';
import { ICollusionRepository } from './interfaces/ICollusionRepository';

export interface CollusionPreventionServiceDependencies {
    validatorRepository: IValidatorRepository;
    validatorInteractionRepository: IValidatorInteractionRepository;
    collusionRepository: ICollusionRepository;
}

export class CollusionPreventionServiceRefactored {
    private logger: ILogger;
    private validatorRepo: IValidatorRepository;
    private interactionRepo: IValidatorInteractionRepository;
    private collusionRepo: ICollusionRepository;

    constructor(logger: ILogger, dependencies: CollusionPreventionServiceDependencies) {
        this.logger = logger;
        this.validatorRepo = dependencies.validatorRepository;
        this.interactionRepo = dependencies.validatorInteractionRepository;
        this.collusionRepo = dependencies.collusionRepository;
    }

    /**
     * Prevent validator collusion by enforcing diversity
     * Uses repository instead of direct Prisma calls
     */
    async preventValidatorCollusion(
        networkId: string,
        selectedValidators: string[],
        taskId: string
    ): Promise<{
        allowed: boolean;
        reason?: string;
        suggestedReplacements?: string[];
    }> {
        try {
            // Check for high-agreement pairs in selected validators
            const collusionRisk = await this.checkCollusionRisk(networkId, selectedValidators);

            if (collusionRisk.hasRisk) {
                this.logger.warn('Collusion risk detected in validator selection', {
                    networkId,
                    taskId,
                    riskPairs: collusionRisk.riskPairs.length,
                });

                // Get alternative validators
                const allValidators = await this.validatorRepo.findByNetwork(networkId, {
                    isActive: true,
                    minReputation: 70,
                });

                const suggestedReplacements = allValidators
                    .filter(v => !selectedValidators.includes(v.address))
                    .map(v => v.address)
                    .slice(0, collusionRisk.riskPairs.length);

                return {
                    allowed: false,
                    reason: `Collusion risk detected: ${collusionRisk.riskPairs.length} high-agreement pairs found`,
                    suggestedReplacements,
                };
            }

            return {
                allowed: true,
            };
        } catch (error) {
            this.logger.error('Failed to prevent validator collusion', { networkId, error });
            // Fail open: allow selection if prevention check fails
            return { allowed: true };
        }
    }

    /**
     * Rotate validators to prevent long-term collusion
     * Uses repository instead of direct Prisma calls
     */
    async rotateValidators(
        networkId: string,
        currentValidators: string[],
        rotationPercentage: number = 0.3
    ): Promise<string[]> {
        try {
            const numToRotate = Math.ceil(currentValidators.length * rotationPercentage);

            // Get validators with high collusion scores
            const highRiskValidators = await this.collusionRepo.getHighRiskValidators(networkId, 50);
            const highRiskAddresses = new Set(highRiskValidators.map(v => v.validatorAddress));

            // Prioritize rotating high-risk validators
            const toRotate = currentValidators
                .filter(v => highRiskAddresses.has(v))
                .slice(0, numToRotate);

            // If not enough high-risk validators, rotate randomly
            if (toRotate.length < numToRotate) {
                const remaining = currentValidators
                    .filter(v => !toRotate.includes(v))
                    .sort(() => Math.random() - 0.5)
                    .slice(0, numToRotate - toRotate.length);
                toRotate.push(...remaining);
            }

            // Get replacement validators
            const allValidators = await this.validatorRepo.findByNetwork(networkId, {
                isActive: true,
                minReputation: 70,
            });

            const replacements = allValidators
                .filter(v => !currentValidators.includes(v.address))
                .sort(() => Math.random() - 0.5)
                .slice(0, toRotate.length)
                .map(v => v.address);

            // Create new validator set
            const newValidators = currentValidators
                .filter(v => !toRotate.includes(v))
                .concat(replacements);

            this.logger.info('Validators rotated', {
                networkId,
                rotated: toRotate.length,
                highRiskRotated: toRotate.filter(v => highRiskAddresses.has(v)).length,
            });

            return newValidators;
        } catch (error) {
            this.logger.error('Failed to rotate validators', { networkId, error });
            return currentValidators; // Return original on error
        }
    }

    /**
     * Enforce validator diversity in selection
     * Uses repository instead of direct Prisma calls
     */
    async enforceValidatorDiversity(
        networkId: string,
        candidates: string[],
        numToSelect: number
    ): Promise<string[]> {
        try {
            // Get interaction stats for all candidates
            const diversityScores = new Map<string, number>();

            for (const candidate of candidates) {
                const stats = await this.interactionRepo.getValidatorStats(candidate, networkId);
                // Lower average agreement rate = more diverse = higher score
                const diversityScore = 1 - stats.averageAgreementRate;
                diversityScores.set(candidate, diversityScore);
            }

            // Select validators with highest diversity scores
            const selected = candidates
                .sort((a, b) => (diversityScores.get(b) || 0) - (diversityScores.get(a) || 0))
                .slice(0, numToSelect);

            this.logger.info('Validator diversity enforced', {
                networkId,
                candidates: candidates.length,
                selected: selected.length,
            });

            return selected;
        } catch (error) {
            this.logger.error('Failed to enforce validator diversity', { networkId, error });
            // Fallback to random selection
            return candidates.sort(() => Math.random() - 0.5).slice(0, numToSelect);
        }
    }

    /**
     * Track validator interactions for collusion detection
     * Uses repository instead of direct Prisma calls
     */
    async trackValidatorInteractions(
        networkId: string,
        taskId: string,
        validatorOutputs: Array<{ validatorAddress: string; outputId: string }>
    ): Promise<void> {
        try {
            // Record all pairwise interactions
            for (let i = 0; i < validatorOutputs.length; i++) {
                for (let j = i + 1; j < validatorOutputs.length; j++) {
                    const validator1 = validatorOutputs[i];
                    const validator2 = validatorOutputs[j];

                    // Check if they agreed on the same output
                    const agreement = validator1.outputId === validator2.outputId;

                    await this.interactionRepo.recordInteraction({
                        networkId,
                        validator1: validator1.validatorAddress,
                        validator2: validator2.validatorAddress,
                        taskId,
                        agreement,
                    });
                }
            }

            this.logger.debug('Validator interactions tracked', {
                networkId,
                taskId,
                validators: validatorOutputs.length,
            });
        } catch (error) {
            this.logger.error('Failed to track validator interactions', { networkId, taskId, error });
            // Non-critical: don't throw
        }
    }

    /**
     * Check collusion risk in validator set
     */
    private async checkCollusionRisk(
        networkId: string,
        validators: string[]
    ): Promise<{
        hasRisk: boolean;
        riskPairs: Array<{ validator1: string; validator2: string; agreementRate: number }>;
    }> {
        const riskPairs: Array<{ validator1: string; validator2: string; agreementRate: number }> = [];

        // Check all pairs
        for (let i = 0; i < validators.length; i++) {
            for (let j = i + 1; j < validators.length; j++) {
                const frequency = await this.interactionRepo.getInteractionFrequency(
                    validators[i],
                    validators[j],
                    networkId
                );

                if (frequency && frequency.totalInteractions >= 10 && frequency.agreementRate >= 0.9) {
                    riskPairs.push({
                        validator1: validators[i],
                        validator2: validators[j],
                        agreementRate: frequency.agreementRate,
                    });
                }
            }
        }

        return {
            hasRisk: riskPairs.length > 0,
            riskPairs,
        };
    }
}
