# Minimal TDCP Implementation

**Stripped-down Tenseuron with only Layer 1 (coordination protocol).**

This example shows TDCP with **zero opinions** - no reputation, no risk scoring, no collusion detection, no economics beyond basic payments.

---

## What's Included

### Layer 1: TDCP Core ✅
- Task creation and lifecycle
- Agent identity (Miners, Validators, Creators)
- Claim/execute/submit flow
- Basic evaluation
- Simple rewards

### Removed (Layer 2 & 3) ❌
- Risk scoring
- Collusion detection
- Reputation systems
- Graduation mechanics
- Creator economics
- Scam defense

---

## Use Case

**Trusted environments** where:
- Participants are known
- Adversarial behavior is unlikely
- Overhead must be minimal
- Speed > Security

**Examples**:
- Private corporate networks
- Research prototypes
- Academic experiments
- Proof-of-concept demos

---

## Implementation

### Minimal Protocol Service

```typescript
import { ILogger } from '../utils/ILogger';
import {
  INetworkRepository,
  ITaskRepository,
  IStorageProvider,
  IBlockchainProvider
} from '../interfaces';
import { NetworkCreationRequest, Network } from '../types';

/**
 * Minimal TDCP Service
 * 
 * Layer 1 only - no policies, no economics, just coordination
 */
export class MinimalProtocolService {
  constructor(
    private logger: ILogger,
    private networkRepo: INetworkRepository,
    private taskRepo: ITaskRepository,
    private storage: IStorageProvider,
    private blockchain: IBlockchainProvider
  ) {}

  /**
   * Create network - no policy checks
   */
  async createNetwork(request: NetworkCreationRequest): Promise<Network> {
    this.logger.info('Creating network (minimal TDCP)', { 
      creator: request.creatorAddress 
    });

    // Direct creation - no reputation check, no risk scoring, no bonds
    const network = await this.networkRepo.create({
      creatorAddress: request.creatorAddress,
      aiModuleId: request.aiModuleId,
      initialBudget: request.initialBudget,
      taskType: request.taskType,
      status: 'ACTIVE',
      createdAt: new Date()
    });

    this.logger.info('Network created', { networkId: network.id });
    return network;
  }

  /**
   * Create task - no validation beyond schema
   */
  async createTask(networkId: string, taskData: any): Promise<any> {
    // Basic schema validation only
    const task = await this.taskRepo.create({
      networkId,
      ...taskData,
      status: 'PENDING',
      createdAt: new Date()
    });

    return task;
  }

  /**
   * Evaluate task - simple majority consensus
   */
  async evaluateTask(taskId: string, evaluations: any[]): Promise<any> {
    // Simple majority - no weighted voting, no reputation
    const approvals = evaluations.filter(e => e.approved).length;
    const approved = approvals > evaluations.length / 2;

    await this.taskRepo.update(taskId, {
      status: approved ? 'COMPLETED' : 'FAILED',
      evaluations
    });

    return { approved, evaluations };
  }
}
```

---

## Comparison: Full vs Minimal

### Network Creation

**Full Reference Network**:
```typescript
// Check creator reputation
const canCreate = await this.creatorReputationService.canCreateNetwork(
  params.creatorAddress
);

// Calculate risk-adjusted bond
const bond = await this.creatorReputationService.calculateRequiredBond(
  params.creatorAddress,
  params.initialBudget
);

// Risk scoring
const riskScore = await this.riskScoringService.calculateNetworkRisk(params);

// Collusion check
await this.collusionService.checkCreator(params.creatorAddress);

// Create with all checks
const network = await this.networkRepo.create({...});
```

**Minimal TDCP**:
```typescript
// Direct creation - no checks
const network = await this.networkRepo.create({
  ...params,
  status: 'ACTIVE'
});
```

---

## Trade-offs

### What You Gain ✅
- **Simplicity**: ~70% less code
- **Speed**: No policy checks = faster
- **Lower overhead**: Minimal computational cost
- **Easy to understand**: Just coordination logic

### What You Lose ❌
- **No adversarial resistance**: Vulnerable to gaming
- **No economic incentives**: Basic payments only
- **No quality control**: No reputation tracking
- **No lifecycle management**: All networks equal
- **No scam protection**: Trust required

---

## When to Use

### ✅ Good Fit
- Private networks with known participants
- Research and experimentation
- Proof-of-concept demos
- Low-stakes applications
- Trusted environments

### ❌ Bad Fit
- Public networks
- High-value transactions
- Adversarial environments
- Production systems
- Financial applications

---

## Migration Path

### From Minimal to Full

If you start with minimal TDCP and later need policies:

1. **Add risk scoring** first (protects against dangerous parameters)
2. **Add reputation** second (tracks agent behavior)
3. **Add collusion detection** third (prevents coordinated attacks)
4. **Add economics** last (incentive alignment)

Each layer can be added incrementally.

---

## Example Usage

```typescript
import { MinimalProtocolService } from './MinimalProtocolService';
import { PrismaNetworkRepository } from '../adapters/database/PrismaNetworkRepository';
import { ConsoleLogger } from '../utils/ILogger';

// Setup
const logger = new ConsoleLogger('MinimalProtocol');
const networkRepo = new PrismaNetworkRepository(prisma, logger);
const taskRepo = new PrismaTaskRepository(prisma, logger);
const storage = new IPFSStorageProvider();
const blockchain = new EthereumProvider(rpcUrl, privateKey);

// Create minimal service
const protocol = new MinimalProtocolService(
  logger,
  networkRepo,
  taskRepo,
  storage,
  blockchain
);

// Use it
const network = await protocol.createNetwork({
  creatorAddress: '0x...',
  aiModuleId: 'gpt-4',
  initialBudget: '1000000000000000000',
  taskType: 'text-generation'
});

console.log('Network created:', network.id);
// No bonds, no risk checks, no reputation - just coordination
```

---

## Code Size Comparison

**Full Reference Network**: ~5000 lines
**Minimal TDCP**: ~500 lines

**Reduction**: 90%

---

## Performance Comparison

**Network Creation**:
- Full: ~500ms (reputation + risk + collusion checks)
- Minimal: ~50ms (direct creation)

**Task Evaluation**:
- Full: ~200ms (weighted consensus + reputation update)
- Minimal: ~20ms (simple majority)

---

## Security Comparison

**Full Reference Network**:
- Collusion detection: ✅
- Sybil resistance: ✅
- Scam protection: ✅
- Risk scoring: ✅

**Minimal TDCP**:
- Collusion detection: ❌
- Sybil resistance: ❌
- Scam protection: ❌
- Risk scoring: ❌

---

## Extending Minimal TDCP

### Add Custom Policy

```typescript
class MinimalWithCustomPolicy extends MinimalProtocolService {
  async createNetwork(request: NetworkCreationRequest): Promise<Network> {
    // Add your custom check
    if (request.initialBudget > '10000000000000000000') {
      throw new Error('Budget too high for minimal network');
    }

    // Call parent
    return super.createNetwork(request);
  }
}
```

### Add Simple Reputation

```typescript
class MinimalWithReputation extends MinimalProtocolService {
  private reputation = new Map<string, number>();

  async createNetwork(request: NetworkCreationRequest): Promise<Network> {
    const rep = this.reputation.get(request.creatorAddress) || 0;
    
    if (rep < 0) {
      throw new Error('Creator has negative reputation');
    }

    return super.createNetwork(request);
  }

  async evaluateTask(taskId: string, evaluations: any[]): Promise<any> {
    const result = await super.evaluateTask(taskId, evaluations);
    
    // Update reputation based on result
    if (result.approved) {
      this.updateReputation(taskId, +10);
    } else {
      this.updateReputation(taskId, -5);
    }

    return result;
  }
}
```

---

## Testing

```typescript
describe('MinimalProtocolService', () => {
  it('creates network without policy checks', async () => {
    const service = new MinimalProtocolService(deps);
    
    const network = await service.createNetwork({
      creatorAddress: '0xnew',  // No reputation check
      initialBudget: '999999999999999999999',  // No risk check
      aiModuleId: 'test',
      taskType: 'test'
    });

    expect(network.status).toBe('ACTIVE');
    // Created immediately, no bonds, no checks
  });

  it('evaluates with simple majority', async () => {
    const service = new MinimalProtocolService(deps);
    
    const result = await service.evaluateTask('task1', [
      { validator: '0x1', approved: true },
      { validator: '0x2', approved: true },
      { validator: '0x3', approved: false }
    ]);

    expect(result.approved).toBe(true);  // 2/3 = majority
    // No weighted voting, no reputation impact
  });
});
```

---

## Summary

**Minimal TDCP is**:
- ✅ Fast and simple
- ✅ Easy to understand
- ✅ Good for trusted environments
- ❌ Not production-ready for public networks
- ❌ Vulnerable to gaming
- ❌ No economic incentives

**Use it when**:
- You trust all participants
- Speed > Security
- Experimentation > Production

**Don't use it when**:
- Network is public
- Stakes are high
- Adversarial behavior is possible

---

**This is TDCP without opinions.**

**For production use, see the full reference network.**
