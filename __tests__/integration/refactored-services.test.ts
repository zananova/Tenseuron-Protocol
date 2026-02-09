/**
 * Integration Tests for Refactored Services
 * 
 * Tests the refactored anti-gaming services with both Prisma and D1 adapters
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ILogger } from './utils/ILogger';
import { PrismaClient } from '@prisma/client';
import { PrismaValidatorRepository } from '../adapters/database/PrismaValidatorRepository';
import { PrismaCollusionRepository } from '../adapters/database/PrismaCollusionRepository';
import { PrismaValidatorInteractionRepository } from '../adapters/database/PrismaValidatorInteractionRepository';
import { SybilResistanceServiceRefactored } from '../SybilResistanceServiceRefactored';
import { CollusionTrackingServiceRefactored } from '../CollusionTrackingServiceRefactored';
import { CollusionPreventionServiceRefactored } from '../CollusionPreventionServiceRefactored';
import { OnChainValidatorService } from '../OnChainValidatorService';
import { PriceOracleService } from '../PriceOracleService';

describe('Refactored Services Integration Tests', () => {
    let prisma: PrismaClient;
    let logger: ILogger;
    let validatorRepo: PrismaValidatorRepository;
    let collusionRepo: PrismaCollusionRepository;
    let interactionRepo: PrismaValidatorInteractionRepository;
    let sybilService: SybilResistanceServiceRefactored;
    let collusionTrackingService: CollusionTrackingServiceRefactored;
    let collusionPreventionService: CollusionPreventionServiceRefactored;

    beforeAll(async () => {
        prisma = new PrismaClient();
        logger = new Logger('IntegrationTest');

        // Create repositories
        validatorRepo = new PrismaValidatorRepository(prisma);
        collusionRepo = new PrismaCollusionRepository(prisma);
        interactionRepo = new PrismaValidatorInteractionRepository(prisma);

        // Create services
        const onChainValidatorService = new OnChainValidatorService(logger);
        const priceOracleService = new PriceOracleService(logger);

        sybilService = new SybilResistanceServiceRefactored(logger, {
            validatorRepository: validatorRepo,
            onChainValidatorService,
            priceOracleService,
        });

        collusionTrackingService = new CollusionTrackingServiceRefactored(logger, {
            collusionRepository: collusionRepo,
            validatorInteractionRepository: interactionRepo,
        });

        collusionPreventionService = new CollusionPreventionServiceRefactored(logger, {
            validatorRepository: validatorRepo,
            validatorInteractionRepository: interactionRepo,
            collusionRepository: collusionRepo,
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    describe('SybilResistanceServiceRefactored', () => {
        it('should check validator qualification', async () => {
            // Register a test validator
            await validatorRepo.register({
                address: '0xtest123',
                networkId: 'test-network',
                stake: '1000',
                reputation: 80,
                isActive: true,
                isBanned: false,
                registeredAt: new Date(),
            });

            const result = await sybilService.checkValidatorQualification(
                '0xtest123',
                'test-network'
            );

            expect(result.qualified).toBe(true);
            expect(result.reputation).toBe(80);
            expect(result.stakeUSD).toBe(1000);
        });

        it('should reject validator with insufficient stake', async () => {
            await validatorRepo.register({
                address: '0xlow-stake',
                networkId: 'test-network',
                stake: '50',
                reputation: 80,
                isActive: true,
                isBanned: false,
                registeredAt: new Date(),
            });

            const result = await sybilService.checkValidatorQualification(
                '0xlow-stake',
                'test-network'
            );

            expect(result.qualified).toBe(false);
            expect(result.reasons).toContain(expect.stringContaining('Insufficient stake'));
        });

        it('should update validator reputation', async () => {
            const newReputation = await sybilService.updateReputationAfterValidation(
                '0xtest123',
                'test-network',
                true,
                true
            );

            expect(newReputation).toBeGreaterThan(80);
        });
    });

    describe('CollusionTrackingServiceRefactored', () => {
        it('should track user rejection', async () => {
            const result = await collusionTrackingService.trackUserRejection(
                'task-123',
                'test-network',
                ['0xval1', '0xval2'],
                5,
                1
            );

            expect(result.patternHash).toBeDefined();
            expect(result.validatorsReplaced).toHaveLength(2);
            expect(result.shouldPenalize).toBe(false); // First redo
        });

        it('should detect collusion patterns', async () => {
            // Create interactions with high agreement
            for (let i = 0; i < 15; i++) {
                await interactionRepo.recordInteraction({
                    networkId: 'test-network',
                    validator1: '0xcolluder1',
                    validator2: '0xcolluder2',
                    taskId: `task-${i}`,
                    agreement: true, // Always agree
                });
            }

            const patterns = await collusionTrackingService.detectCollusionPattern(
                'test-network',
                10,
                0.9
            );

            expect(patterns.length).toBeGreaterThan(0);
            expect(patterns[0].agreementRate).toBeGreaterThanOrEqual(0.9);
        });

        it('should get validator collusion score', async () => {
            const score = await collusionTrackingService.getValidatorCollusionScore(
                '0xcolluder1',
                'test-network'
            );

            expect(score).toBeGreaterThanOrEqual(0);
        });
    });

    describe('CollusionPreventionServiceRefactored', () => {
        it('should prevent validator collusion', async () => {
            const result = await collusionPreventionService.preventValidatorCollusion(
                'test-network',
                ['0xcolluder1', '0xcolluder2'],
                'task-new'
            );

            // Should detect collusion risk
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Collusion risk');
        });

        it('should rotate validators', async () => {
            const currentValidators = ['0xval1', '0xval2', '0xval3', '0xval4'];
            const rotated = await collusionPreventionService.rotateValidators(
                'test-network',
                currentValidators,
                0.5 // Rotate 50%
            );

            expect(rotated).toHaveLength(4);
            // At least 2 validators should be different
            const diff = rotated.filter(v => !currentValidators.includes(v));
            expect(diff.length).toBeGreaterThanOrEqual(2);
        });

        it('should enforce validator diversity', async () => {
            const candidates = ['0xval1', '0xval2', '0xval3', '0xval4', '0xval5'];
            const selected = await collusionPreventionService.enforceValidatorDiversity(
                'test-network',
                candidates,
                3
            );

            expect(selected).toHaveLength(3);
            // All selected should be from candidates
            selected.forEach(v => expect(candidates).toContain(v));
        });

        it('should track validator interactions', async () => {
            await collusionPreventionService.trackValidatorInteractions(
                'test-network',
                'task-tracking',
                [
                    { validatorAddress: '0xval1', outputId: 'output-1' },
                    { validatorAddress: '0xval2', outputId: 'output-1' },
                    { validatorAddress: '0xval3', outputId: 'output-2' },
                ]
            );

            // Verify interactions were recorded
            const interactions = await interactionRepo.findByValidator('0xval1', 'test-network', 10);
            expect(interactions.length).toBeGreaterThan(0);
        });
    });

    describe('Cross-Service Integration', () => {
        it('should handle complete workflow', async () => {
            // 1. Check validator qualification
            const qualification = await sybilService.checkValidatorQualification(
                '0xtest123',
                'test-network'
            );
            expect(qualification.qualified).toBe(true);

            // 2. Track interactions
            await collusionPreventionService.trackValidatorInteractions(
                'test-network',
                'workflow-task',
                [
                    { validatorAddress: '0xtest123', outputId: 'output-1' },
                    { validatorAddress: '0xval2', outputId: 'output-1' },
                ]
            );

            // 3. Detect patterns
            const patterns = await collusionTrackingService.detectCollusionPattern(
                'test-network',
                5,
                0.8
            );

            // 4. Update reputation
            const newReputation = await sybilService.updateReputationAfterValidation(
                '0xtest123',
                'test-network',
                true,
                true
            );

            expect(newReputation).toBeGreaterThan(qualification.reputation);
        });
    });
});
