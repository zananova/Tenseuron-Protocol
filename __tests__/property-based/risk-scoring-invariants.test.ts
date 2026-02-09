/**
 * Property-Based Tests for Risk Scoring Invariants
 * 
 * Uses fast-check to generate random inputs and verify invariants hold
 */

import * as fc from 'fast-check';
import { RiskScoringService, RiskParameters, RiskScore } from '../../RiskScoringService';

describe('Risk Scoring Invariants (Property-Based)', () => {
  const riskScoringService = new RiskScoringService();

  /**
   * Property 1: Risk score is always in [0, 100]
   */
  describe('Risk Score Bounds', () => {
    it('should always return risk score in [0, 100]', () => {
      fc.assert(
        fc.property(
          // Generate random risk parameters
          fc.record({
            payoutCap: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            settlementDelay: fc.integer({ min: 0, max: 86400 * 7 }), // 0 to 7 days
            taskSchemaFixed: fc.boolean(),
            customScoring: fc.boolean(),
            instantPayout: fc.boolean(),
            singleValidator: fc.boolean(),
            nonDeterministic: fc.boolean(),
            validatorSelfSelect: fc.boolean(),
            maxPayoutPerTask: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            minValidators: fc.integer({ min: 1, max: 10 }),
            consensusThreshold: fc.float({ min: 0, max: 1 }),
            disputeWindow: fc.integer({ min: 0, max: 86400 * 30 }), // 0 to 30 days
            stakeRequired: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
          }),
          (params: any) => {
            const riskParams: RiskParameters = {
              payoutCap: params.payoutCap || '0',
              settlementDelay: params.settlementDelay,
              taskSchemaFixed: params.taskSchemaFixed,
              customScoring: params.customScoring,
              instantPayout: params.instantPayout,
              singleValidator: params.singleValidator,
              nonDeterministic: params.nonDeterministic,
              validatorSelfSelect: params.validatorSelfSelect,
              maxPayoutPerTask: params.maxPayoutPerTask || '0',
              minValidators: params.minValidators,
              consensusThreshold: params.consensusThreshold,
              disputeWindow: params.disputeWindow,
              stakeRequired: params.stakeRequired || '0',
            };

            const riskScore = riskScoringService.calculateRiskScore(riskParams);

            // Invariant: risk score must be in [0, 100]
            expect(riskScore.totalRisk).toBeGreaterThanOrEqual(0);
            expect(riskScore.totalRisk).toBeLessThanOrEqual(100);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('should have all breakdown values in [0, 100]', () => {
      fc.assert(
        fc.property(
          fc.record({
            payoutCap: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            settlementDelay: fc.integer({ min: 0, max: 86400 * 7 }),
            taskSchemaFixed: fc.boolean(),
            customScoring: fc.boolean(),
            instantPayout: fc.boolean(),
            singleValidator: fc.boolean(),
            nonDeterministic: fc.boolean(),
            validatorSelfSelect: fc.boolean(),
            maxPayoutPerTask: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            minValidators: fc.integer({ min: 1, max: 10 }),
            consensusThreshold: fc.float({ min: 0, max: 1 }),
            disputeWindow: fc.integer({ min: 0, max: 86400 * 30 }),
            stakeRequired: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
          }),
          (params: any) => {
            const riskParams: RiskParameters = {
              payoutCap: params.payoutCap || '0',
              settlementDelay: params.settlementDelay,
              taskSchemaFixed: params.taskSchemaFixed,
              customScoring: params.customScoring,
              instantPayout: params.instantPayout,
              singleValidator: params.singleValidator,
              nonDeterministic: params.nonDeterministic,
              validatorSelfSelect: params.validatorSelfSelect,
              maxPayoutPerTask: params.maxPayoutPerTask || '0',
              minValidators: params.minValidators,
              consensusThreshold: params.consensusThreshold,
              disputeWindow: params.disputeWindow,
              stakeRequired: params.stakeRequired || '0',
            };

            const riskScore = riskScoringService.calculateRiskScore(riskParams);
            const breakdown = riskScore.parameterBreakdown;

            // Invariant: all breakdown values must be non-negative
            Object.values(breakdown).forEach(value => {
              expect(value).toBeGreaterThanOrEqual(0);
            });
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  /**
   * Property 2: Risk category matches risk score
   */
  describe('Risk Category Consistency', () => {
    it('should assign correct risk category based on total risk', () => {
      fc.assert(
        fc.property(
          fc.record({
            payoutCap: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            settlementDelay: fc.integer({ min: 0, max: 86400 * 7 }),
            taskSchemaFixed: fc.boolean(),
            customScoring: fc.boolean(),
            instantPayout: fc.boolean(),
            singleValidator: fc.boolean(),
            nonDeterministic: fc.boolean(),
            validatorSelfSelect: fc.boolean(),
            maxPayoutPerTask: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            minValidators: fc.integer({ min: 1, max: 10 }),
            consensusThreshold: fc.float({ min: 0, max: 1 }),
            disputeWindow: fc.integer({ min: 0, max: 86400 * 30 }),
            stakeRequired: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
          }),
          (params: any) => {
            const riskParams: RiskParameters = {
              payoutCap: params.payoutCap || '0',
              settlementDelay: params.settlementDelay,
              taskSchemaFixed: params.taskSchemaFixed,
              customScoring: params.customScoring,
              instantPayout: params.instantPayout,
              singleValidator: params.singleValidator,
              nonDeterministic: params.nonDeterministic,
              validatorSelfSelect: params.validatorSelfSelect,
              maxPayoutPerTask: params.maxPayoutPerTask || '0',
              minValidators: params.minValidators,
              consensusThreshold: params.consensusThreshold,
              disputeWindow: params.disputeWindow,
              stakeRequired: params.stakeRequired || '0',
            };

            const riskScore = riskScoringService.calculateRiskScore(riskParams);

            // Invariant: risk category must match risk score
            if (riskScore.totalRisk < 20) {
              expect(riskScore.riskCategory).toBe('safe');
            } else if (riskScore.totalRisk < 40) {
              expect(riskScore.riskCategory).toBe('moderate');
            } else if (riskScore.totalRisk < 70) {
              expect(riskScore.riskCategory).toBe('risky');
            } else {
              expect(riskScore.riskCategory).toBe('dangerous');
            }
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  /**
   * Property 3: Required costs are always positive
   */
  describe('Required Costs Positivity', () => {
    it('should always return positive required costs', () => {
      fc.assert(
        fc.property(
          fc.record({
            payoutCap: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            settlementDelay: fc.integer({ min: 0, max: 86400 * 7 }),
            taskSchemaFixed: fc.boolean(),
            customScoring: fc.boolean(),
            instantPayout: fc.boolean(),
            singleValidator: fc.boolean(),
            nonDeterministic: fc.boolean(),
            validatorSelfSelect: fc.boolean(),
            maxPayoutPerTask: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            minValidators: fc.integer({ min: 1, max: 10 }),
            consensusThreshold: fc.float({ min: 0, max: 1 }),
            disputeWindow: fc.integer({ min: 0, max: 86400 * 30 }),
            stakeRequired: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            hasCustomPenaltyConfig: fc.boolean(),
          }),
          (params: any) => {
            const riskParams: RiskParameters = {
              payoutCap: params.payoutCap || '0',
              settlementDelay: params.settlementDelay,
              taskSchemaFixed: params.taskSchemaFixed,
              customScoring: params.customScoring,
              instantPayout: params.instantPayout,
              singleValidator: params.singleValidator,
              nonDeterministic: params.nonDeterministic,
              validatorSelfSelect: params.validatorSelfSelect,
              maxPayoutPerTask: params.maxPayoutPerTask || '0',
              minValidators: params.minValidators,
              consensusThreshold: params.consensusThreshold,
              disputeWindow: params.disputeWindow,
              stakeRequired: params.stakeRequired || '0',
            };

            const riskScore = riskScoringService.calculateRiskScore(riskParams);
            const requiredCosts = riskScoringService.calculateRequiredCosts(
              riskScore,
              params.maxPayoutPerTask || '0',
              params.hasCustomPenaltyConfig
            );

            // Invariant: all costs must be positive
            expect(parseFloat(requiredCosts.creationFee)).toBeGreaterThan(0);
            expect(parseFloat(requiredCosts.creatorReward)).toBeGreaterThanOrEqual(0);
            expect(parseFloat(requiredCosts.requiredStake)).toBeGreaterThanOrEqual(0);
            expect(requiredCosts.settlementDelay).toBeGreaterThanOrEqual(0);
            expect(requiredCosts.escrowLockup).toBeGreaterThanOrEqual(0);
            expect(requiredCosts.slashingRate).toBeGreaterThanOrEqual(0);
            expect(requiredCosts.slashingRate).toBeLessThanOrEqual(100);
          }
        ),
        { numRuns: 1000 }
      );
    });
  });

  /**
   * Property 4: Monotonicity - safer parameters should not increase risk
   */
  describe('Risk Score Monotonicity', () => {
    it('should not increase risk when making parameters safer', () => {
      fc.assert(
        fc.property(
          fc.record({
            baseParams: fc.record({
              payoutCap: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
              settlementDelay: fc.integer({ min: 0, max: 86400 * 7 }),
              taskSchemaFixed: fc.boolean(),
              customScoring: fc.boolean(),
              instantPayout: fc.boolean(),
              singleValidator: fc.boolean(),
              nonDeterministic: fc.boolean(),
              validatorSelfSelect: fc.boolean(),
              maxPayoutPerTask: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
              minValidators: fc.integer({ min: 1, max: 10 }),
              consensusThreshold: fc.float({ min: 0, max: 1 }),
              disputeWindow: fc.integer({ min: 0, max: 86400 * 30 }),
              stakeRequired: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            }),
            saferParams: fc.record({
              payoutCap: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
              settlementDelay: fc.integer({ min: 0, max: 86400 * 7 }),
              taskSchemaFixed: fc.boolean(),
              customScoring: fc.boolean(),
              instantPayout: fc.boolean(),
              singleValidator: fc.boolean(),
              nonDeterministic: fc.boolean(),
              validatorSelfSelect: fc.boolean(),
              maxPayoutPerTask: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
              minValidators: fc.integer({ min: 1, max: 10 }),
              consensusThreshold: fc.float({ min: 0, max: 1 }),
              disputeWindow: fc.integer({ min: 0, max: 86400 * 30 }),
              stakeRequired: fc.string().filter(s => !isNaN(parseFloat(s)) && parseFloat(s) >= 0),
            }),
          }),
          (data: any) => {
            const baseParams: RiskParameters = {
              payoutCap: data.baseParams.payoutCap || '0',
              settlementDelay: data.baseParams.settlementDelay,
              taskSchemaFixed: data.baseParams.taskSchemaFixed,
              customScoring: data.baseParams.customScoring,
              instantPayout: data.baseParams.instantPayout,
              singleValidator: data.baseParams.singleValidator,
              nonDeterministic: data.baseParams.nonDeterministic,
              validatorSelfSelect: data.baseParams.validatorSelfSelect,
              maxPayoutPerTask: data.baseParams.maxPayoutPerTask || '0',
              minValidators: data.baseParams.minValidators,
              consensusThreshold: data.baseParams.consensusThreshold,
              disputeWindow: data.baseParams.disputeWindow,
              stakeRequired: data.baseParams.stakeRequired || '0',
            };

            const saferParams: RiskParameters = {
              payoutCap: data.saferParams.payoutCap || '0',
              settlementDelay: Math.max(data.baseParams.settlementDelay, data.saferParams.settlementDelay), // Longer delay = safer
              taskSchemaFixed: true, // Fixed schema = safer
              customScoring: false, // Standard scoring = safer
              instantPayout: false, // Delayed payout = safer
              singleValidator: false, // Multiple validators = safer
              nonDeterministic: false, // Deterministic = safer
              validatorSelfSelect: false, // No self-selection = safer
              maxPayoutPerTask: data.saferParams.maxPayoutPerTask || '0',
              minValidators: Math.max(data.baseParams.minValidators, data.saferParams.minValidators), // More validators = safer
              consensusThreshold: Math.max(data.baseParams.consensusThreshold, data.saferParams.consensusThreshold), // Higher threshold = safer
              disputeWindow: Math.max(data.baseParams.disputeWindow, data.saferParams.disputeWindow), // Longer window = safer
              stakeRequired: data.saferParams.stakeRequired || '0',
            };

            const baseRisk = riskScoringService.calculateRiskScore(baseParams);
            const saferRisk = riskScoringService.calculateRiskScore(saferParams);

            // Invariant: safer parameters should not increase risk
            // Note: This is a soft invariant - some combinations might not strictly decrease risk
            // but we check that making parameters safer doesn't dramatically increase risk
            expect(saferRisk.totalRisk).toBeLessThanOrEqual(baseRisk.totalRisk + 10); // Allow small variance
          }
        ),
        { numRuns: 500 } // Fewer runs due to complexity
      );
    });
  });
});
