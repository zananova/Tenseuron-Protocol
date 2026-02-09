/**
 * SybilResistanceService Tests
 * 
 * Tests for Sybil resistance and validator qualification
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SybilResistanceService } from '../SybilResistanceService';
import { ILogger } from '../utils/ILogger';
import { PrismaClient } from '@prisma/client';

describe('SybilResistanceService', () => {
  let service: SybilResistanceService;
  let logger: ILogger;
  let prisma: PrismaClient;

  beforeEach(() => {
    logger = new Logger('Test');
    prisma = new PrismaClient();
    service = new SybilResistanceService(prisma, logger, {
      minStakeUSD: 100,
      minReputation: 70,
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  describe('checkValidatorQualification', () => {
    it('should reject validator with insufficient stake', async () => {
      const result = await service.checkValidatorQualification(
        '0x0000000000000000000000000000000000000000',
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.qualified).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  describe('getValidatorStakeUSD', () => {
    it('should return 0 for non-existent validator', async () => {
      const stakeUSD = await (service as any).getValidatorStakeUSD(
        '0x0000000000000000000000000000000000000000',
        '0x1234567890123456789012345678901234567890'
      );
      expect(stakeUSD).toBe(0);
    });
  });
});

