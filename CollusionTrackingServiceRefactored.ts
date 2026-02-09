/**
 * Collusion Tracking Service Refactored
 * 
 * Database-agnostic version using repository pattern
 * Tracks and detects validator collusion patterns
 */

import { ILogger } from './utils/ILogger';
import { ICollusionRepository } from './interfaces/ICollusionRepository';
import { IValidatorInteractionRepository } from './interfaces/IValidatorInteractionRepository';

export interface CollusionTrackingServiceDependencies {
    collusionRepository: ICollusionRepository;
    validatorInteractionRepository: IValidatorInteractionRepository;
}

export class CollusionTrackingServiceRefactored {
    private logger: ILogger;
    private collusionRepo: ICollusionRepository;
    private interactionRepo: IValidatorInteractionRepository;

    constructor(logger: ILogger, dependencies: CollusionTrackingServiceDependencies) {
        this.logger = logger;
        this.collusionRepo = dependencies.collusionRepository;
        this.interactionRepo = dependencies.validatorInteractionRepository;
    }

    /**
     * Track user rejection with statistical process control
     * Uses repository instead of direct Prisma calls
     */
    async trackUserRejection(
        taskId: string,
        networkId: string,
        approvedValidators: string[],
        totalValidators: number,
        redoCount: number
    ): Promise<{
        patternHash: string;
        validatorsReplaced: string[];
        reputationUpdated: boolean;
        reputationReason?: string;
        shouldPenalize: boolean;
        penaltyType?: 'none' | 'soft' | 'partial' | 'challenge';
    }> {
        try {
            // Generate encrypted pattern hash
            const patternHash = await this.generatePatternHash(approvedValidators, taskId);

            // Record user rejection via repository
            await this.collusionRepo.recordUserRejection({
                taskId,
                networkId,
                userAddress: 'system', // TODO: Get from context
                rejectedValidators: approvedValidators,
                patternHash,
                redoCount,
            });

            // Statistical process control: Check if rejection is statistically significant
            const rejectionRate = approvedValidators.length / totalValidators;
            const shouldPenalize = redoCount > 2 && rejectionRate > 0.5;

            let penaltyType: 'none' | 'soft' | 'partial' | 'challenge' = 'none';
            let reputationReason: string | undefined;

            if (shouldPenalize) {
                if (redoCount > 5) {
                    penaltyType = 'challenge';
                    reputationReason = 'Excessive user rejections detected';
                } else if (rejectionRate > 0.75) {
                    penaltyType = 'partial';
                    reputationReason = 'High rejection rate detected';
                } else {
                    penaltyType = 'soft';
                    reputationReason = 'Multiple rejections detected';
                }

                // Update collusion scores for rejected validators
                for (const validator of approvedValidators) {
                    const currentScore = await this.collusionRepo.getCollusionScore(validator, networkId);
                    const newScore = Math.min(100, currentScore + (penaltyType === 'challenge' ? 20 : penaltyType === 'partial' ? 10 : 5));
                    await this.collusionRepo.updateCollusionScore(validator, networkId, newScore);
                }
            }

            this.logger.info('User rejection tracked', {
                taskId,
                networkId,
                rejectedValidators: approvedValidators.length,
                redoCount,
                shouldPenalize,
                penaltyType,
            });

            return {
                patternHash,
                validatorsReplaced: approvedValidators,
                reputationUpdated: shouldPenalize,
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
     * Detect collusion patterns between validators
     * Uses repository instead of direct Prisma calls
     */
    async detectCollusionPattern(
        networkId: string,
        minInteractions: number = 10,
        minAgreementRate: number = 0.9
    ): Promise<Array<{
        validator1: string;
        validator2: string;
        agreementRate: number;
        totalInteractions: number;
        severity: 'low' | 'medium' | 'high' | 'critical';
    }>> {
        try {
            // Get high-agreement pairs from repository
            const highAgreementPairs = await this.interactionRepo.getHighAgreementPairs(
                networkId,
                minInteractions,
                minAgreementRate
            );

            const collusionPatterns = highAgreementPairs.map(pair => {
                // Determine severity based on agreement rate and interaction count
                let severity: 'low' | 'medium' | 'high' | 'critical';
                if (pair.agreementRate >= 0.98 && pair.totalInteractions >= 50) {
                    severity = 'critical';
                } else if (pair.agreementRate >= 0.95 && pair.totalInteractions >= 30) {
                    severity = 'high';
                } else if (pair.agreementRate >= 0.92 && pair.totalInteractions >= 20) {
                    severity = 'medium';
                } else {
                    severity = 'low';
                }

                return {
                    validator1: pair.validator1,
                    validator2: pair.validator2,
                    agreementRate: pair.agreementRate,
                    totalInteractions: pair.totalInteractions,
                    severity,
                };
            });

            // Record collusion events for high/critical severity
            for (const pattern of collusionPatterns) {
                if (pattern.severity === 'high' || pattern.severity === 'critical') {
                    await this.collusionRepo.recordEvent({
                        networkId,
                        validators: [pattern.validator1, pattern.validator2],
                        patternHash: await this.generatePatternHash([pattern.validator1, pattern.validator2], networkId),
                        severity: pattern.severity,
                        metadata: {
                            agreementRate: pattern.agreementRate,
                            totalInteractions: pattern.totalInteractions,
                        },
                    });
                }
            }

            this.logger.info('Collusion pattern detection complete', {
                networkId,
                patternsFound: collusionPatterns.length,
                criticalPatterns: collusionPatterns.filter(p => p.severity === 'critical').length,
            });

            return collusionPatterns;
        } catch (error) {
            this.logger.error('Failed to detect collusion patterns', { networkId, error });
            throw error;
        }
    }

    /**
     * Get collusion score for a validator
     * Uses repository instead of direct Prisma calls
     */
    async getValidatorCollusionScore(validatorAddress: string, networkId: string): Promise<number> {
        try {
            return await this.collusionRepo.getCollusionScore(validatorAddress, networkId);
        } catch (error) {
            this.logger.error('Failed to get collusion score', { validatorAddress, error });
            return 0;
        }
    }

    /**
     * Record collusion event
     * Uses repository instead of direct Prisma calls
     */
    async recordCollusionEvent(
        networkId: string,
        validators: string[],
        severity: 'low' | 'medium' | 'high' | 'critical',
        taskId?: string,
        metadata?: any
    ): Promise<void> {
        try {
            const patternHash = await this.generatePatternHash(validators, taskId || networkId);

            await this.collusionRepo.recordEvent({
                networkId,
                taskId,
                validators,
                patternHash,
                severity,
                metadata,
            });

            this.logger.info('Collusion event recorded', {
                networkId,
                validators: validators.length,
                severity,
            });
        } catch (error) {
            this.logger.error('Failed to record collusion event', { networkId, error });
            throw error;
        }
    }

    /**
     * Generate encrypted pattern hash for privacy
     */
    private async generatePatternHash(validators: string[], salt: string): Promise<string> {
        const { createHash } = require('crypto');
        const sortedValidators = validators.sort().join(',');
        const data = `${sortedValidators}:${salt}`;
        return createHash('sha256').update(data).digest('hex');
    }
}
