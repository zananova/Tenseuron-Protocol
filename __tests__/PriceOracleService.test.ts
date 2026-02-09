/**
 * PriceOracleService Tests
 * 
 * Tests for price oracle functionality
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { PriceOracleService } from '../PriceOracleService';
import { ILogger } from '../utils/ILogger';

describe('PriceOracleService', () => {
  let service: PriceOracleService;
  let logger: ILogger;

  beforeEach(() => {
    logger = new Logger('Test');
    service = new PriceOracleService(logger);
  });

  describe('getNativeTokenPriceUSD', () => {
    it('should fetch native token price for ethereum', async () => {
      const price = await service.getNativeTokenPriceUSD('ethereum');
      // Price should be > 0 (ETH is valuable)
      expect(price).toBeGreaterThan(0);
    });

    it('should cache price results', async () => {
      const price1 = await service.getNativeTokenPriceUSD('ethereum');
      const price2 = await service.getNativeTokenPriceUSD('ethereum');
      // Should return same price (cached)
      expect(price2).toBe(price1);
    });
  });

  describe('getTokenPriceUSD', () => {
    it('should return 0 for unsupported token', async () => {
      const price = await service.getTokenPriceUSD(
        '0x0000000000000000000000000000000000000000',
        'ethereum'
      );
      expect(price).toBe(0);
    });
  });

  describe('convertToUSD', () => {
    it('should convert token amount to USD', async () => {
      const amount = '1.0';
      const price = await service.convertToUSD(
        amount,
        '0x0000000000000000000000000000000000000000',
        'ethereum'
      );
      expect(typeof price).toBe('number');
    });
  });
});

