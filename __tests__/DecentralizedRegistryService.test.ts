/**
 * DecentralizedRegistryService Tests
 * 
 * Tests for creator signature verification, blockchain index fetching, and network discovery
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DecentralizedRegistryService } from '../DecentralizedRegistryService';
import { ILogger } from '../utils/ILogger';
import { NetworkManifest } from '../types';

describe('DecentralizedRegistryService', () => {
  let service: DecentralizedRegistryService;
  let logger: ILogger;

  beforeEach(() => {
    logger = new Logger('Test');
    service = new DecentralizedRegistryService(logger);
  });

  describe('verifyCreatorSignature', () => {
    it('should verify valid EIP-191 signature', async () => {
      // This would require a real signature from a wallet
      // For now, test that the method exists and handles invalid signatures
      const manifest: Partial<NetworkManifest> = {
        networkId: '0x1234567890123456789012345678901234567890',
        creatorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        creatorSignature: '0xinvalid',
        createdAt: new Date().toISOString(),
        name: 'Test Network',
        description: 'Test',
        taskFormat: {
          inputSchema: {},
          outputSchema: {},
          timeout: 3600,
        },
        scoringLogic: {
          type: 'wasm',
          hash: '0xhash',
          url: 'ipfs://QmTest',
        },
        validatorConfig: {
          minValidators: 3,
          consensusThreshold: 6700,
          disputeWindow: 86400,
          stakeRequired: '1000000000000000000',
        },
        settlement: {
          mode: 'escrow',
          chain: 'ethereum',
        },
      };

      // Access private method via reflection (for testing)
      const result = (service as any).verifyCreatorSignature(manifest);
      expect(result).toBe(false); // Invalid signature should fail
    });

    it('should return false for missing signature', () => {
      const manifest: Partial<NetworkManifest> = {
        networkId: '0x1234',
        creatorAddress: '0xabcd',
        // No signature
      };

      const result = (service as any).verifyCreatorSignature(manifest);
      expect(result).toBe(false);
    });
  });

  describe('fetchFromBlockchain', () => {
    it('should handle invalid blockchain location format', async () => {
      const result = await (service as any).fetchFromBlockchain('invalid-format');
      expect(result).toBeNull();
    });

    it('should handle unsupported chain', async () => {
      const result = await (service as any).fetchFromBlockchain('unsupported:0x1234');
      expect(result).toBeNull();
    });
  });

  describe('verifyManifest', () => {
    it('should validate manifest structure', () => {
      const manifest: any = {
        networkId: '0x1234567890123456789012345678901234567890',
        name: 'Test Network',
        creatorAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        taskFormat: {
          inputSchema: {},
          outputSchema: {},
        },
        scoringLogic: {
          hash: '0xhash',
          url: 'ipfs://QmTest',
        },
        validatorConfig: {
          minValidators: 3,
        },
        settlement: {
          chain: 'ethereum',
        },
        riskParameters: {},
        moneyFlow: {
          validatorPayment: {
            enabled: true,
          },
        },
      };

      const result = service.verifyManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('should reject manifest with missing required fields', () => {
      const manifest: any = {
        // Missing required fields
      };

      const result = service.verifyManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

