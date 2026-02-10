# Tenseuron Fork Guide

**How to adapt Tenseuron for your use case.**

Tenseuron is designed to be forked, not followed blindly. This guide shows you how to strip it down, swap components, or build your own variant.

---

## Why Fork?

You should fork Tenseuron if you:

- **Disagree with default policies** (economic parameters, security thresholds)
- **Have a different threat model** (trusted environment vs adversarial)
- **Want a minimal implementation** (TDCP only, no opinions)
- **Need different trade-offs** (speed vs security, simplicity vs robustness)

**Forking is governance.** Deep disagreements result in variants, and that's healthy.

---

## The Three Layers

Before forking, understand what you're keeping vs changing:

### Layer 1: TDCP (Protocol Core)
- Task schema
- Agent roles
- Claim/execute/submit flow
- Evaluation format
- Reward signal

**Most forks keep this** - it's the coordination spine.

### Layer 2: Network Policy
- Reputation
- Risk scoring
- Collusion detection
- Graduation
- Bootstrap mode

**Most forks modify this** - different policies for different contexts.

### Layer 3: Marketplace/Platform
- Creator economics
- Revenue distribution
- Payment flows
- Blockchain integration

**Most forks customize this** - economics vary by use case.

---

## Fork Patterns

### Pattern 1: Minimal TDCP

**Goal**: Strip everything except the coordination protocol

**Keep**:
- Task schema (`/specs/Task.md`)
- Agent identity
- Basic repositories (ITaskRepository, INetworkRepository)
- Claim/execute/submit logic

**Remove**:
- All Layer 2 services (Risk, Collusion, Reputation, Graduation)
- All Layer 3 services (MoneyFlow, CreatorRevenue, Settlement)
- Complex validation logic

**Use case**: Trusted environments, research prototypes, minimal overhead

**See**: [`examples/minimal-tdcp/`](./examples/minimal-tdcp/)

---

### Pattern 2: Alternative Economics

**Goal**: Keep security, change economic model

**Keep**:
- TDCP core
- Risk scoring
- Collusion detection
- Reputation

**Change**:
- Revenue split (default 70/30)
- Validator rewards (performance-based → fixed)
- Bond requirements (risk-adjusted → flat)
- Graduation thresholds

**Use case**: Different incentive structures, experimental economics

**See**: [`examples/custom-economics/`](./examples/custom-economics/)

---

### Pattern 3: Simplified Security

**Goal**: Reduce anti-gaming overhead for trusted contexts

**Keep**:
- TDCP core
- Basic reputation
- Economics

**Remove**:
- Collusion detection
- Sybil resistance
- Advanced risk scoring

**Use case**: Private networks, known participants, lower stakes

**See**: [`examples/simplified-security/`](./examples/simplified-security/)

---

### Pattern 4: Custom Risk Model

**Goal**: Replace risk scoring logic

**Keep**:
- TDCP core
- Collusion detection
- Economics

**Replace**:
- RiskScoringService with custom logic
- Risk thresholds
- Risk decay functions

**Use case**: Domain-specific risk models, different threat assumptions

**See**: [`examples/custom-risk/`](./examples/custom-risk/)

---

## Step-by-Step: Creating a Minimal Fork

### Step 1: Clone the Repository

```bash
git clone https://github.com/zananova/Tenseuron-Protocol
cd Tenseuron-Protocol
git checkout -b minimal-fork
```

### Step 2: Identify Core Files

**Keep these** (TDCP core):
```
/specs/
/interfaces/ITaskRepository.ts
/interfaces/INetworkRepository.ts
/interfaces/IValidatorRepository.ts
/types.ts
/adapters/database/
/adapters/blockchain/
/adapters/storage/
```

**Remove these** (Layer 2 & 3):
```
RiskScoringService.ts
CollusionTrackingService.ts
CollusionPreventionService.ts
SybilResistanceService.ts
GraduationService.ts
BootstrapModeService.ts
MoneyFlowService.ts
CreatorRevenueService.ts
SettlementService.ts
ScamDefenseService.ts
```

### Step 3: Simplify ProtocolServiceRefactored

Remove dependencies on Layer 2/3 services:

```typescript
// Before (full reference network)
export interface ProtocolServiceDependencies {
  networkRepo: INetworkRepository;
  aiModuleRepo: IAIModuleRepository;
  creatorReputationService: ICreatorReputationService;
  storage: IStorageProvider;
  blockchain: IBlockchainProvider;
  decentralizedRegistry: DecentralizedRegistryService;
  settlementService: SettlementService;
  scamDefenseService: ScamDefenseService;
  riskScoringService: RiskScoringService;
  moneyFlowService: MoneyFlowService;
}

// After (minimal TDCP)
export interface MinimalProtocolDependencies {
  networkRepo: INetworkRepository;
  taskRepo: ITaskRepository;
  storage: IStorageProvider;
  blockchain: IBlockchainProvider;
}
```

### Step 4: Update createNetwork Logic

Remove policy checks:

```typescript
// Before (with policies)
async createNetwork(params: CreateNetworkParams): Promise<Network> {
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
  
  // Create network...
}

// After (minimal)
async createNetwork(params: CreateNetworkParams): Promise<Network> {
  // Direct creation, no policy checks
  const network = await this.networkRepo.create({
    ...params,
    status: 'ACTIVE',
    createdAt: new Date()
  });
  
  return network;
}
```

### Step 5: Update README

Document what you changed and why:

```markdown
# Minimal TDCP Implementation

This is a stripped-down fork of Tenseuron containing only the coordination protocol.

**Removed**:
- Reputation systems
- Risk scoring
- Collusion detection
- Graduation mechanics
- Complex economics

**Use case**: Trusted environments where adversarial resistance is not required.

**Trade-offs**: Simpler, faster, but vulnerable to gaming.
```

### Step 6: Test and Deploy

```bash
npm test
npm run build
```

---

## Step-by-Step: Customizing Economics

### Step 1: Fork and Branch

```bash
git clone https://github.com/zananova/Tenseuron-Protocol
cd Tenseuron-Protocol
git checkout -b custom-economics
```

### Step 2: Modify Revenue Split

**File**: `MoneyFlowService.ts`

```typescript
// Before (70/30 split)
const CREATOR_REVENUE_SHARE = 0.7;
const PROTOCOL_FEE = 0.3;

// After (80/20 split)
const CREATOR_REVENUE_SHARE = 0.8;
const PROTOCOL_FEE = 0.2;
```

### Step 3: Change Validator Rewards

**File**: `SettlementService.ts`

```typescript
// Before (performance-based)
const validatorReward = calculatePerformanceReward(
  validator.accuracy,
  validator.speed,
  taskValue
);

// After (fixed reward)
const validatorReward = FIXED_VALIDATOR_REWARD;
```

### Step 4: Adjust Bond Requirements

**File**: `CreatorReputationService.ts` (or your adapter)

```typescript
// Before (risk-adjusted)
async calculateRequiredBond(
  creatorAddress: string,
  networkValue: string
): Promise<string> {
  const reputation = await this.getCreatorReputation(creatorAddress);
  const riskMultiplier = this.calculateRiskMultiplier(reputation);
  return (BigInt(networkValue) * BigInt(riskMultiplier)) / 100n;
}

// After (flat 10%)
async calculateRequiredBond(
  creatorAddress: string,
  networkValue: string
): Promise<string> {
  return (BigInt(networkValue) * 10n) / 100n; // Always 10%
}
```

### Step 5: Document Changes

**File**: `ECONOMICS.md`

```markdown
# Custom Economic Model

This fork uses different economic parameters than the reference network:

**Revenue Split**: 80/20 (vs 70/30)
- Rationale: Higher creator incentive for our use case

**Validator Rewards**: Fixed (vs performance-based)
- Rationale: Simpler, more predictable

**Bond Requirements**: Flat 10% (vs risk-adjusted)
- Rationale: Easier to understand, lower barrier to entry

**Trade-offs**: See PHILOSOPHY.md
```

---

## Common Customizations

### Change Graduation Threshold

**File**: `GraduationService.ts`

```typescript
// Default: 1000 tasks
const GRADUATION_THRESHOLD = 1000;

// Custom: 500 tasks (faster graduation)
const GRADUATION_THRESHOLD = 500;

// Custom: 2000 tasks (more conservative)
const GRADUATION_THRESHOLD = 2000;
```

### Modify Risk Decay

**File**: `RiskScoringService.ts`

```typescript
// Default: Exponential decay
private calculateDecay(age: number): number {
  return Math.exp(-age / 1000);
}

// Custom: Linear decay
private calculateDecay(age: number): number {
  return Math.max(0, 1 - (age / 10000));
}

// Custom: No decay (permanent scores)
private calculateDecay(age: number): number {
  return 1;
}
```

### Change Collusion Thresholds

**File**: `CollusionPreventionService.ts`

```typescript
// Default: 3 strikes
const COLLUSION_STRIKE_LIMIT = 3;

// Custom: 1 strike (zero tolerance)
const COLLUSION_STRIKE_LIMIT = 1;

// Custom: 5 strikes (more forgiving)
const COLLUSION_STRIKE_LIMIT = 5;
```

---

## Creating Custom Adapters

### Custom Database Adapter

```typescript
import { INetworkRepository, Network } from '@zananova/tenseuron-protocol';

export class CustomDatabaseRepository implements INetworkRepository {
  constructor(private db: YourDatabaseClient) {}

  async create(network: Omit<Network, 'id'>): Promise<Network> {
    // Your database logic
  }

  async findById(id: string): Promise<Network | null> {
    // Your database logic
  }

  // ... implement all interface methods
}
```

### Custom Blockchain Provider

```typescript
import { IBlockchainProvider } from '@zananova/tenseuron-protocol';

export class CustomBlockchainProvider implements IBlockchainProvider {
  async deployContract(bytecode: string): Promise<string> {
    // Your blockchain logic
  }

  async callContract(address: string, method: string, params: any[]): Promise<any> {
    // Your blockchain logic
  }

  // ... implement all interface methods
}
```

---

## Testing Your Fork

### Unit Tests

```typescript
import { MinimalProtocolService } from './MinimalProtocolService';

describe('MinimalProtocolService', () => {
  it('creates network without policy checks', async () => {
    const service = new MinimalProtocolService(deps);
    const network = await service.createNetwork(params);
    
    expect(network.status).toBe('ACTIVE');
    // No reputation check
    // No risk scoring
    // No bond requirement
  });
});
```

### Integration Tests

```bash
# Test with your custom adapters
npm run test:integration

# Test deployment
npm run build
npm run deploy:testnet
```

---

## Publishing Your Fork

### Option 1: Separate Package

```json
{
  "name": "@yourorg/tenseuron-minimal",
  "version": "1.0.0",
  "description": "Minimal TDCP implementation without policy layer"
}
```

### Option 2: Fork on GitHub

```bash
# Push your fork
git push origin minimal-fork

# Create pull request (if contributing back)
# Or keep as separate fork
```

---

## When to Contribute Back vs Fork

### Contribute Back (Pull Request)
- Bug fixes
- Performance improvements
- New adapters (database, blockchain, storage)
- Documentation improvements
- Test coverage

### Keep as Fork
- Different economic model
- Different security assumptions
- Simplified version
- Domain-specific customization

---

## Fork Examples

### Example 1: Trusted Network Fork
**Changes**: Removed all adversarial defenses
**Use case**: Private corporate network
**Trade-off**: Faster, simpler, but requires trust

### Example 2: High-Stakes Fork
**Changes**: Stricter policies, higher bonds, longer graduation
**Use case**: Financial applications
**Trade-off**: Safer, but higher barrier to entry

### Example 3: Research Fork
**Changes**: Minimal TDCP + experimental reputation model
**Use case**: Academic research
**Trade-off**: Flexibility for experiments

---

## Support for Forkers

**Questions?**
- GitHub Discussions: Design questions
- Discord: Real-time help
- Documentation: This guide + PHILOSOPHY.md

**Want to share your fork?**
- Add it to the [Forks Registry](./FORKS.md)
- Help others learn from your choices

---

## The Meta-Point

**Tenseuron is not trying to be the only answer.**

**It's one reference point in a design space.**

**Your fork might be better for your use case.**

**That's the point of forkability.**

**Code your disagreement. That's real governance.**
