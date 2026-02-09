/**
 * EvaluationService Tests
 * 
 * Tests for task evaluation and consensus building
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { EvaluationService } from '../EvaluationService';
import { ILogger } from '../utils/ILogger';

describe('EvaluationService', () => {
  let service: EvaluationService;
  let logger: ILogger;

  beforeEach(() => {
    logger = new Logger('Test');
    service = new EvaluationService(logger);
  });

  describe('evaluateDeterministic', () => {
    it('should evaluate deterministic task', () => {
      const outputs = [
        {
          outputId: 'out1',
          output: { result: 'test result' },
          minerAddress: 'miner1',
          timestamp: Date.now(),
        },
      ];
      const evaluations = [
        {
          validatorAddress: 'v1',
          outputId: 'out1',
          score: 80,
          confidence: 0.9,
          timestamp: Date.now(),
          signature: '0xsig1',
        },
        {
          validatorAddress: 'v2',
          outputId: 'out1',
          score: 75,
          confidence: 0.8,
          timestamp: Date.now(),
          signature: '0xsig2',
        },
      ];

      const result = service.evaluateDeterministic(
        'task1',
        { prompt: 'test' },
        outputs,
        evaluations,
        '0xhash'
      );

      expect(result).toBeDefined();
      expect(result.winningOutputId).toBeDefined();
      expect(result.finalScore).toBeGreaterThanOrEqual(0);
      expect(result.finalScore).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateAgreementMetrics', () => {
    it('should calculate agreement metrics from evaluations', () => {
      const evaluations = [
        {
          validatorAddress: 'v1',
          outputId: 'out1',
          score: 80,
          confidence: 0.9,
          timestamp: Date.now(),
          signature: '0xsig1',
        },
        {
          validatorAddress: 'v2',
          outputId: 'out1',
          score: 75,
          confidence: 0.8,
          timestamp: Date.now(),
          signature: '0xsig2',
        },
        {
          validatorAddress: 'v3',
          outputId: 'out1',
          score: 70,
          confidence: 0.7,
          timestamp: Date.now(),
          signature: '0xsig3',
        },
      ];

      const result = service.calculateAgreementMetrics(evaluations);

      expect(result.overallAgreement).toBeGreaterThanOrEqual(0);
      expect(result.overallAgreement).toBeLessThanOrEqual(1);
      expect(result.outputAgreement.size).toBeGreaterThan(0);
      expect(result.validatorConsensus.size).toBe(3);
    });
  });
});

