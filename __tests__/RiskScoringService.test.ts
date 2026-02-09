/**
 * Risk Scoring Service Tests
 * 
 * Tests for risk-based pricing system
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { RiskScoringService } from '../RiskScoringService';
import { ILogger } from '../utils/ILogger';

describe('RiskScoringService', () => {
  let riskScoringService: RiskScoringService;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    riskScoringService = new RiskScoringService(mockLogger);
  });

  describe('calculateRiskScore', () => {
    it('should calculate low risk for safe parameters', () => {
      const safeParams = {
        payoutCap: '100',
        settlementDelay: 7200,
        taskSchemaFixed: true,
        customScoring: false,
        instantPayout: false,
        singleValidator: false,
        nonDeterministic: false,
        validatorSelfSelect: false,
        maxPayoutPerTask: '100',
        minValidators: 5,
        consensusThreshold: 0.8,
        disputeWindow: 86400,
        stakeRequired: '1000',
      };

      const riskScore = riskScoringService.calculateRiskScore(safeParams);

      expect(riskScore.totalRisk).toBeLessThan(50); // Low to moderate risk
      expect(['safe', 'moderate']).toContain(riskScore.riskCategory);
    });

    it('should calculate high risk for dangerous parameters', () => {
      const riskyParams = {
        payoutCap: '10000',
        settlementDelay: 0,
        taskSchemaFixed: false,
        customScoring: true,
        instantPayout: true,
        singleValidator: true,
        nonDeterministic: true,
        validatorSelfSelect: true,
        maxPayoutPerTask: '10000',
        minValidators: 1,
        consensusThreshold: 0.5,
        disputeWindow: 0,
        stakeRequired: '0',
      };

      const riskScore = riskScoringService.calculateRiskScore(riskyParams);

      expect(riskScore.totalRisk).toBeGreaterThan(70); // High risk
      expect(riskScore.riskCategory).toBe('dangerous');
    });

    it('should calculate moderate risk for mixed parameters', () => {
      const mixedParams = {
        payoutCap: '1000',
        settlementDelay: 3600,
        taskSchemaFixed: true,
        customScoring: false,
        instantPayout: false,
        singleValidator: false,
        nonDeterministic: true, // Some risk
        validatorSelfSelect: false,
        maxPayoutPerTask: '1000',
        minValidators: 3,
        consensusThreshold: 0.67,
        disputeWindow: 86400,
        stakeRequired: '500',
      };

      const riskScore = riskScoringService.calculateRiskScore(mixedParams);

      expect(riskScore.totalRisk).toBeGreaterThanOrEqual(30);
      expect(riskScore.totalRisk).toBeLessThanOrEqual(80); // Allow some margin
      expect(['moderate', 'risky']).toContain(riskScore.riskCategory);
    });
  });

  describe('calculateRequiredCosts', () => {
    it('should calculate higher costs for risky networks', () => {
      const riskyParams = {
        payoutCap: '10000',
        settlementDelay: 0,
        taskSchemaFixed: false,
        customScoring: true,
        instantPayout: true,
        singleValidator: true,
        nonDeterministic: true,
        validatorSelfSelect: true,
        maxPayoutPerTask: '10000',
        minValidators: 1,
        consensusThreshold: 0.5,
        disputeWindow: 0,
        stakeRequired: '0',
      };

      const riskScore = riskScoringService.calculateRiskScore(riskyParams);
      const costs = riskScoringService.calculateRequiredCosts(riskScore, '10000');

      expect(parseFloat(costs.creationFee)).toBeGreaterThan(0);
      expect(parseFloat(costs.requiredStake)).toBeGreaterThan(0);
    });

    it('should calculate lower costs for safe networks', () => {
      const safeParams = {
        payoutCap: '100',
        settlementDelay: 7200,
        taskSchemaFixed: true,
        customScoring: false,
        instantPayout: false,
        singleValidator: false,
        nonDeterministic: false,
        validatorSelfSelect: false,
        maxPayoutPerTask: '100',
        minValidators: 5,
        consensusThreshold: 0.8,
        disputeWindow: 86400,
        stakeRequired: '1000',
      };

      const riskScore = riskScoringService.calculateRiskScore(safeParams);
      const riskyParams = {
        payoutCap: '10000',
        settlementDelay: 0,
        taskSchemaFixed: false,
        customScoring: true,
        instantPayout: true,
        singleValidator: true,
        nonDeterministic: true,
        validatorSelfSelect: true,
        maxPayoutPerTask: '10000',
        minValidators: 1,
        consensusThreshold: 0.5,
        disputeWindow: 0,
        stakeRequired: '0',
      };
      const riskyRiskScore = riskScoringService.calculateRiskScore(riskyParams);
      const riskyCosts = riskScoringService.calculateRequiredCosts(riskyRiskScore, '10000');
      const safeCosts = riskScoringService.calculateRequiredCosts(riskScore, '100');

      // Safe networks should cost less (or at least not more)
      // Note: This is a relative comparison
      expect(parseFloat(safeCosts.creationFee)).toBeLessThanOrEqual(parseFloat(riskyCosts.creationFee));
    });
  });

  describe('validateRiskParameters', () => {
    it('should validate correct parameters', () => {
      const validParams = {
        payoutCap: '1000',
        settlementDelay: 3600,
        taskSchemaFixed: true,
        customScoring: false,
        instantPayout: false,
        singleValidator: false,
        nonDeterministic: false,
        validatorSelfSelect: false,
        maxPayoutPerTask: '1000',
        minValidators: 3,
        consensusThreshold: 0.67,
        disputeWindow: 86400,
        stakeRequired: '100',
      };

      const validation = riskScoringService.validateRiskParameters(validParams);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid parameters', () => {
      const invalidParams = {
        payoutCap: '-100', // Negative payout cap
        settlementDelay: -100, // Negative delay
        taskSchemaFixed: true,
        customScoring: false,
        instantPayout: false,
        singleValidator: false,
        nonDeterministic: false,
        validatorSelfSelect: false,
        maxPayoutPerTask: '1000',
        minValidators: 0, // Invalid: must be >= 1
        consensusThreshold: 1.5, // Invalid: must be <= 1
        disputeWindow: 86400,
        stakeRequired: '100',
      };

      const validation = riskScoringService.validateRiskParameters(invalidParams);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });
});

