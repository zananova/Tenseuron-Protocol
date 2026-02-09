/**
 * INCCallService Tests
 * 
 * Tests for inter-network call processing
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { INCCallService } from '../INCCallService';
import { ILogger } from '../utils/ILogger';
import { TaskService } from '../TaskService';
import { ProtocolService } from '../ProtocolService';
import { PrismaClient } from '@prisma/client';
import { InterNetworkCall, NetworkManifest } from '../types';

describe('INCCallService', () => {
  let service: INCCallService;
  let logger: ILogger;
  let taskService: TaskService;
  let protocolService: ProtocolService;
  let prisma: PrismaClient;

  beforeEach(() => {
    logger = new Logger('Test');
    prisma = new PrismaClient();
    taskService = new TaskService(prisma, logger);
    protocolService = new ProtocolService(logger, prisma);
    service = new INCCallService(logger, taskService, protocolService);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  describe('createINC', () => {
    it('should create INC with valid parameters', () => {
      const inc = service.createINC({
        sourceNetworkId: '0x1234',
        destinationNetworkId: '0x5678',
        taskPayload: { input: 'test' },
        maxBudget: '1000000000000000000',
        settlementMode: 'escrow',
        sourceValidatorSignatures: ['0xsig1', '0xsig2'],
        callChain: [],
      });

      expect(inc.incId).toBeDefined();
      expect(inc.sourceNetworkId).toBe('0x1234');
      expect(inc.destinationNetworkId).toBe('0x5678');
    });

    it('should reject INC with cycle', () => {
      expect(() => {
        service.createINC({
          sourceNetworkId: '0x1234',
          destinationNetworkId: '0x5678',
          taskPayload: { input: 'test' },
          maxBudget: '1000000000000000000',
          settlementMode: 'escrow',
          sourceValidatorSignatures: ['0xsig1'],
          callChain: ['0x5678'], // Cycle detected
        });
      }).toThrow('Cycle detected');
    });

    it('should reject INC exceeding max depth', () => {
      expect(() => {
        service.createINC({
          sourceNetworkId: '0x1234',
          destinationNetworkId: '0x5678',
          taskPayload: { input: 'test' },
          maxBudget: '1000000000000000000',
          settlementMode: 'escrow',
          sourceValidatorSignatures: ['0xsig1'],
          callChain: Array(10).fill('0x'), // Max depth exceeded
          maxDepth: 10,
        });
      }).toThrow('Max depth');
    });
  });

  describe('validateINC', () => {
    it('should validate INC against destination manifest', () => {
      const inc: InterNetworkCall = {
        incId: '0xinc',
        sourceNetworkId: '0x1234',
        destinationNetworkId: '0x5678',
        taskPayload: { input: 'test' },
        maxBudget: '1000000000000000000',
        settlementMode: 'escrow',
        signature: '0xsig',
        timestamp: Date.now(),
        maxDepth: 10,
        currentDepth: 1,
        callChain: [],
      };

      const manifest: NetworkManifest = {
        networkId: '0x5678',
        name: 'Test Network',
        description: 'Test',
        category: 'test',
        version: '1.0.0',
        creatorAddress: '0xcreator',
        creatorSignature: '0xsig',
        createdAt: new Date().toISOString(),
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
        inc: {
          supported: true,
          capabilities: ['test'],
          pricing: {
            model: 'per_task',
            basePrice: '1000000000000000000',
            currency: 'native',
          },
          requirements: {
            minBudget: '1000000000000000000',
            maxDepth: 10,
          },
        },
        riskParameters: {},
        moneyFlow: {
          validatorPayment: {
            enabled: true,
            percentage: 0.1,
            minPayment: '0',
            maxPayment: '0',
          },
        },
        registry: {
          ipfsCid: 'QmTest',
        },
      };

      const result = service.validateINC(inc, manifest);
      expect(result.valid).toBe(true);
    });
  });
});

