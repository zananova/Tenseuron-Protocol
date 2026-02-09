/**
 * Network Manifest Generator Tests
 * 
 * Tests for manifest generation and validation
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NetworkManifestGenerator } from '../NetworkManifestGenerator';
import { NetworkCreationRequest } from '../types';

describe('NetworkManifestGenerator', () => {
  describe('generateNetworkId', () => {
    it('should generate deterministic network ID', () => {
      const name = 'Test Network';
      const creator = '0x1234567890123456789012345678901234567890';
      const timestamp = 1234567890;

      const id1 = NetworkManifestGenerator.generateNetworkId(name, creator, timestamp);
      const id2 = NetworkManifestGenerator.generateNetworkId(name, creator, timestamp);

      // Should be deterministic
      expect(id1).toBe(id2);
      expect(id1).toMatch(/^0x[a-fA-F0-9]{40}$/); // 20 bytes hex
    });

    it('should generate different IDs for different inputs', () => {
      const name = 'Test Network';
      const creator = '0x1234567890123456789012345678901234567890';
      const timestamp1 = 1234567890;
      const timestamp2 = 1234567891;

      const id1 = NetworkManifestGenerator.generateNetworkId(name, creator, timestamp1);
      const id2 = NetworkManifestGenerator.generateNetworkId(name, creator, timestamp2);

      expect(id1).not.toBe(id2);
    });
  });

  describe('generateManifest', () => {
    const validRequest: NetworkCreationRequest = {
      name: 'Test Network',
      description: 'A test network',
      category: 'text-generation',
      taskInputSchema: { type: 'object' },
      taskOutputSchema: { type: 'object' },
      taskTimeout: 300,
      scoringType: 'js',
      scoringModuleHash: '0x123',
      scoringModuleUrl: 'ipfs://QmTest',
      minValidators: 3,
      consensusThreshold: 0.67,
      disputeWindow: 86400,
      stakeRequired: '100',
      settlementMode: 'escrow',
      settlementChain: 'ethereum',
      creatorAddress: '0x1234567890123456789012345678901234567890',
      creatorSignature: '0xsig',
      riskParameters: {
        payoutCap: '1000',
        settlementDelay: 3600,
        taskSchemaFixed: true,
        customScoring: false,
        instantPayout: false,
        singleValidator: false,
        nonDeterministic: false,
        validatorSelfSelect: false,
        maxPayoutPerTask: '1000',
      },
      moneyFlow: {
        creationFeeSplit: {
          creatorReward: 25,
          minerPool: 50,
          purposeBoundSinks: 20,
          burn: 5,
        },
        usageCut: {
          enabled: true,
          percentage: 5,
          minCut: '0.0001',
          maxCut: '1000',
        },
        validatorPayment: {
          enabled: true,
          percentage: 10,
          minPayment: '0.0001',
          maxPayment: '0.5',
        },
      },
    };

    it('should generate valid manifest', () => {
      const manifest = NetworkManifestGenerator.generateManifest(validRequest);

      expect(manifest).toBeDefined();
      expect(manifest.networkId).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(manifest.name).toBe(validRequest.name);
      expect(manifest.creatorAddress).toBe(validRequest.creatorAddress);
      expect(manifest.validatorConfig.minValidators).toBe(validRequest.minValidators);
      expect(manifest.settlement.chain).toBe(validRequest.settlementChain);
    });

    it('should include risk parameters', () => {
      const manifest = NetworkManifestGenerator.generateManifest(validRequest);

      expect(manifest.riskParameters).toBeDefined();
      expect(manifest.riskParameters.payoutCap).toBe(validRequest.riskParameters.payoutCap);
    });

    it('should include money flow configuration', () => {
      const manifest = NetworkManifestGenerator.generateManifest(validRequest);

      expect(manifest.moneyFlow).toBeDefined();
      expect(manifest.moneyFlow.validatorPayment.enabled).toBe(true);
    });
  });

  describe('validateManifest', () => {
    it('should validate correct manifest', () => {
      const request: NetworkCreationRequest = {
        name: 'Test',
        description: 'Test',
        category: 'test',
        taskInputSchema: { type: 'object', properties: {} },
        taskOutputSchema: { type: 'object', properties: {} },
        taskTimeout: 300,
        scoringType: 'js',
        scoringModuleHash: '0x123',
        scoringModuleUrl: 'ipfs://QmTest',
        minValidators: 3,
        consensusThreshold: 0.67,
        disputeWindow: 86400,
        stakeRequired: '100',
        settlementMode: 'escrow',
        settlementChain: 'ethereum',
        creatorAddress: '0x1234567890123456789012345678901234567890',
        creatorSignature: '0xsig',
        riskParameters: {
          payoutCap: '1000',
          settlementDelay: 3600,
          taskSchemaFixed: true,
          customScoring: false,
          instantPayout: false,
          singleValidator: false,
          nonDeterministic: false,
          validatorSelfSelect: false,
          maxPayoutPerTask: '1000',
        },
        moneyFlow: {
          creationFeeSplit: {
            creatorReward: 25,
            minerPool: 50,
            purposeBoundSinks: 20,
            burn: 5,
          },
          usageCut: {
            enabled: true,
            percentage: 5,
            minCut: '0.0001',
            maxCut: '1000',
          },
          validatorPayment: {
            enabled: true,
            percentage: 10,
            minPayment: '0.0001',
            maxPayment: '0.5',
          },
        },
      };

      const manifest = NetworkManifestGenerator.generateManifest(request);
      // Add contract address for escrow mode (validation requires it)
      manifest.settlement.contractAddress = '0x1234567890123456789012345678901234567890';
      const validation = NetworkManifestGenerator.validateManifest(manifest);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject manifest with invalid networkId', () => {
      const request: NetworkCreationRequest = {
        name: 'Test',
        description: 'Test',
        category: 'test',
        taskInputSchema: { type: 'object', properties: {} },
        taskOutputSchema: { type: 'object', properties: {} },
        taskTimeout: 300,
        scoringType: 'js',
        scoringModuleHash: '0x123',
        scoringModuleUrl: 'ipfs://QmTest',
        minValidators: 3,
        consensusThreshold: 0.67,
        disputeWindow: 86400,
        stakeRequired: '100',
        settlementMode: 'escrow',
        settlementChain: 'ethereum',
        creatorAddress: '0x1234567890123456789012345678901234567890',
        creatorSignature: '0xsig',
        riskParameters: {
          payoutCap: '1000',
          settlementDelay: 3600,
          taskSchemaFixed: true,
          customScoring: false,
          instantPayout: false,
          singleValidator: false,
          nonDeterministic: false,
          validatorSelfSelect: false,
          maxPayoutPerTask: '1000',
        },
        moneyFlow: {
          creationFeeSplit: {
            creatorReward: 25,
            minerPool: 50,
            purposeBoundSinks: 20,
            burn: 5,
          },
          usageCut: {
            enabled: true,
            percentage: 5,
            minCut: '0.0001',
            maxCut: '1000',
          },
          validatorPayment: {
            enabled: true,
            percentage: 10,
            minPayment: '0.0001',
            maxPayment: '0.5',
          },
        },
      };

      const manifest = NetworkManifestGenerator.generateManifest(request);
      manifest.networkId = 'invalid'; // Invalid networkId

      const validation = NetworkManifestGenerator.validateManifest(manifest);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });
});

