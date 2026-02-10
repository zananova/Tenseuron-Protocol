# Custom Economic Model Example

**Alternative revenue distribution for Tenseuron networks.**

This example shows how to customize the economic parameters while keeping the security and policy layers intact.

---

## What's Changed

### Economic Parameters
- **Revenue split**: 80/20 (vs default 70/30)
- **Validator rewards**: Fixed (vs performance-based)
- **Bond requirements**: Flat 10% (vs risk-adjusted 5-20%)
- **Creator fees**: Lower (2% vs 3%)

### What's Kept
- ✅ Risk scoring
- ✅ Collusion detection
- ✅ Reputation systems
- ✅ Graduation mechanics
- ✅ All security features

---

## Rationale

**Higher creator share (80%)**:
- Incentivizes quality network creation
- Attracts more creators
- Suitable for creator-focused platforms

**Fixed validator rewards**:
- Simpler and more predictable
- Easier for validators to calculate earnings
- Reduces gas costs (no performance calculation)

**Flat bond (10%)**:
- Easier to understand
- Lower barrier to entry
- Suitable for lower-risk environments

---

## Implementation

### Custom Money Flow Service

```typescript
import { MoneyFlowService } from '../../MoneyFlowService';
import { MoneyFlowConfig } from '../../types';
import { ILogger } from '../../utils/ILogger';

/**
 * Custom Money Flow with 80/20 split
 */
export class CustomMoneyFlowService extends MoneyFlowService {
  constructor(logger: ILogger) {
    super(logger);
  }

  /**
   * Override default config with 80/20 split
   */
  getDefaultMoneyFlowConfig(): MoneyFlowConfig {
    return {
      creationFeeSplit: {
        creatorReward: 0.80,      // 80% to creator (vs 70%)
        minerPool: 0.10,          // 10% to miner pool
        purposeBoundSinks: 0.05,  // 5% to sinks
        burn: 0.05                // 5% burn
      },
      usageCut: {
        enabled: true,
        percentage: 0.02,         // 2% creator cut (vs 3%)
        minCut: '1000000000000000',    // 0.001 ETH
        maxCut: '100000000000000000'   // 0.1 ETH
      },
      validatorPayment: {
        enabled: true,
        percentage: 0.10,         // Fixed 10% to validators
        minPayment: '5000000000000000',    // 0.005 ETH
        maxPayment: '50000000000000000'    // 0.05 ETH
      }
    };
  }

  /**
   * Override recommended config for all risk levels
   * Always use 80/20 regardless of risk
   */
  getRecommendedMoneyFlowConfig(
    riskCategory: 'safe' | 'moderate' | 'risky' | 'dangerous'
  ): MoneyFlowConfig {
    // Same config for all risk levels
    // (In production, you might still want to vary by risk)
    return this.getDefaultMoneyFlowConfig();
  }
}
```

### Custom Settlement Service (Fixed Validator Rewards)

```typescript
import { SettlementService } from '../../SettlementService';
import { ILogger } from '../../utils/ILogger';

/**
 * Custom Settlement with fixed validator rewards
 */
export class CustomSettlementService extends SettlementService {
  // Fixed reward per validation (0.01 ETH)
  private readonly FIXED_VALIDATOR_REWARD = '10000000000000000';

  constructor(logger: ILogger) {
    super(logger);
  }

  /**
   * Calculate fixed validator reward
   * Ignores performance metrics
   */
  async calculateValidatorReward(
    validatorAddress: string,
    taskValue: string,
    performance?: {
      accuracy: number;
      speed: number;
    }
  ): Promise<string> {
    // Fixed reward regardless of performance
    return this.FIXED_VALIDATOR_REWARD;
  }
}
```

### Custom Creator Reputation (Flat Bonds)

```typescript
import { ICreatorReputationService, CreatorReputation } from '../../interfaces';
import { ILogger } from '../../utils/ILogger';

/**
 * Custom reputation service with flat 10% bonds
 */
export class CustomCreatorReputationService implements ICreatorReputationService {
  // Flat 10% bond for all creators
  private readonly FLAT_BOND_PERCENTAGE = 0.10;

  constructor(private logger: ILogger) {}

  async getCreatorReputation(creatorAddress: string): Promise<CreatorReputation | null> {
    // Implement reputation tracking
    // (Same as default, just bond calculation differs)
    return null; // Placeholder
  }

  async canCreateNetwork(creatorAddress: string): Promise<boolean> {
    // Same eligibility rules as default
    const reputation = await this.getCreatorReputation(creatorAddress);
    return reputation ? reputation.score >= 0 : true;
  }

  /**
   * Flat 10% bond for everyone
   * No risk adjustment
   */
  async calculateRequiredBond(
    creatorAddress: string,
    networkValue: string
  ): Promise<string> {
    // Simple 10% calculation
    const value = BigInt(networkValue);
    const bond = (value * BigInt(10)) / BigInt(100);
    
    this.logger.info('Calculated flat bond', {
      creator: creatorAddress,
      networkValue,
      bond: bond.toString(),
      percentage: '10%'
    });

    return bond.toString();
  }

  async recordNetworkCreation(
    creatorAddress: string,
    networkId: string,
    bondPaid: string
  ): Promise<void> {
    // Record creation (same as default)
    this.logger.info('Network created', {
      creator: creatorAddress,
      network: networkId,
      bond: bondPaid
    });
  }
}
```

---

## Usage

### Factory Integration

```typescript
import { ProtocolServiceFactory } from '../../ProtocolServiceFactory';
import { CustomMoneyFlowService } from './CustomMoneyFlowService';
import { CustomSettlementService } from './CustomSettlementService';
import { CustomCreatorReputationService } from './CustomCreatorReputationService';

/**
 * Create protocol with custom economics
 */
export function createCustomEconomicsProtocol(logger, prisma) {
  // Create custom services
  const moneyFlowService = new CustomMoneyFlowService(logger);
  const settlementService = new CustomSettlementService(logger);
  const creatorReputationService = new CustomCreatorReputationService(logger);

  // Create protocol with custom economics
  return new ProtocolServiceRefactored(logger, {
    // Standard services
    networkRepo: new PrismaNetworkRepository(prisma, logger),
    aiModuleRepo: new LaunchpadAIModuleRepository(aiModuleService),
    storage: new IPFSStorageProvider(),
    blockchain: new EthereumProvider(rpcUrl, privateKey),
    
    // Keep default security
    riskScoringService: new RiskScoringService(logger),
    scamDefenseService: new ScamDefenseService(logger, prisma),
    decentralizedRegistry: new DecentralizedRegistryService(logger),
    
    // Custom economics
    moneyFlowService,           // 80/20 split
    settlementService,          // Fixed rewards
    creatorReputationService    // Flat bonds
  });
}
```

### Direct Usage

```typescript
const protocol = createCustomEconomicsProtocol(logger, prisma);

const network = await protocol.createNetwork({
  creatorAddress: '0x...',
  aiModuleId: 'gpt-4',
  initialBudget: '10000000000000000000', // 10 ETH
  taskType: 'text-generation'
});

// Creator pays 10% bond (1 ETH) - flat rate
// Creator receives 80% of fees (vs 70%)
// Validators receive fixed 0.01 ETH per validation
```

---

## Comparison: Default vs Custom

### Revenue Distribution

**Default (70/30)**:
```
Creation Fee: 1 ETH
├─ Creator: 0.70 ETH (70%)
├─ Miner Pool: 0.15 ETH (15%)
├─ Sinks: 0.10 ETH (10%)
└─ Burn: 0.05 ETH (5%)
```

**Custom (80/20)**:
```
Creation Fee: 1 ETH
├─ Creator: 0.80 ETH (80%)
├─ Miner Pool: 0.10 ETH (10%)
├─ Sinks: 0.05 ETH (5%)
└─ Burn: 0.05 ETH (5%)
```

### Validator Rewards

**Default (Performance-based)**:
```typescript
reward = baseReward * (accuracy * 0.6 + speed * 0.4)

Example:
- High performer (95% accuracy, fast): 0.0095 ETH
- Low performer (70% accuracy, slow): 0.0070 ETH
```

**Custom (Fixed)**:
```typescript
reward = 0.01 ETH (always)

Example:
- All validators: 0.01 ETH
- No performance calculation
- Simpler, more predictable
```

### Bond Requirements

**Default (Risk-adjusted)**:
```
Network Value: 10 ETH

Low risk creator: 0.5 ETH (5%)
Medium risk creator: 1.0 ETH (10%)
High risk creator: 2.0 ETH (20%)
```

**Custom (Flat 10%)**:
```
Network Value: 10 ETH

All creators: 1.0 ETH (10%)
No risk adjustment
Simpler calculation
```

---

## Trade-offs

### What You Gain ✅
- **Higher creator incentive**: 80% vs 70%
- **Simpler validator rewards**: Fixed vs calculated
- **Lower barrier to entry**: Flat 10% bond
- **Predictability**: Easier to calculate earnings
- **Lower gas costs**: Less computation

### What You Lose ❌
- **Less protocol revenue**: 20% vs 30%
- **No performance incentive**: Validators paid equally
- **Less risk protection**: No bond adjustment
- **Potential for lazy validation**: No reward for quality

---

## When to Use

### ✅ Good Fit
- Creator-focused platforms
- Lower-risk environments
- Predictability valued over optimization
- Simpler economics preferred
- Lower gas costs important

### ❌ Bad Fit
- High-risk networks
- Need to incentivize validator performance
- Protocol sustainability concerns (lower fees)
- Adversarial environments (flat bonds)

---

## Testing

```typescript
describe('CustomEconomicsProtocol', () => {
  it('uses 80/20 revenue split', async () => {
    const protocol = createCustomEconomicsProtocol(logger, prisma);
    
    const result = await protocol.createNetwork({
      creatorAddress: '0x...',
      initialBudget: '10000000000000000000'
    });

    // Check creator receives 80%
    expect(result.creationFees.creatorReward).toBe('800000000000000000');
  });

  it('pays fixed validator rewards', async () => {
    const settlement = new CustomSettlementService(logger);
    
    const reward = await settlement.calculateValidatorReward(
      '0xvalidator',
      '1000000000000000000',
      { accuracy: 0.95, speed: 0.9 }  // Performance ignored
    );

    expect(reward).toBe('10000000000000000');  // Always 0.01 ETH
  });

  it('requires flat 10% bond', async () => {
    const reputation = new CustomCreatorReputationService(logger);
    
    const bond = await reputation.calculateRequiredBond(
      '0xcreator',
      '10000000000000000000'  // 10 ETH
    );

    expect(bond).toBe('1000000000000000000');  // Always 10% = 1 ETH
  });
});
```

---

## Migration from Default

### Step 1: Deploy Custom Services

```typescript
const customMoneyFlow = new CustomMoneyFlowService(logger);
const customSettlement = new CustomSettlementService(logger);
const customReputation = new CustomCreatorReputationService(logger);
```

### Step 2: Update Factory

```typescript
const protocol = new ProtocolServiceRefactored(logger, {
  ...defaultDeps,
  moneyFlowService: customMoneyFlow,
  settlementService: customSettlement,
  creatorReputationService: customReputation
});
```

### Step 3: Test Thoroughly

```bash
npm run test:custom-economics
```

### Step 4: Deploy

```bash
npm run deploy:custom-economics
```

---

## Further Customization

### Dynamic Split Based on Network Type

```typescript
getDefaultMoneyFlowConfig(networkType?: string): MoneyFlowConfig {
  if (networkType === 'premium') {
    return {
      creationFeeSplit: {
        creatorReward: 0.90,  // 90% for premium
        minerPool: 0.05,
        purposeBoundSinks: 0.03,
        burn: 0.02
      },
      // ...
    };
  }
  
  return this.getStandardConfig();  // 80/20
}
```

### Tiered Validator Rewards

```typescript
calculateValidatorReward(
  validatorAddress: string,
  taskValue: string,
  tier: 'bronze' | 'silver' | 'gold'
): Promise<string> {
  const rewards = {
    bronze: '5000000000000000',   // 0.005 ETH
    silver: '10000000000000000',  // 0.01 ETH
    gold: '20000000000000000'     // 0.02 ETH
  };
  
  return rewards[tier];
}
```

---

## Summary

**Custom Economics**:
- ✅ 80/20 revenue split (higher creator share)
- ✅ Fixed validator rewards (simpler)
- ✅ Flat 10% bonds (lower barrier)
- ✅ Keeps all security features
- ✅ Easy to customize further

**Use when**:
- Creator incentive is priority
- Predictability valued
- Lower risk environment

**Avoid when**:
- Need performance incentives
- High-risk networks
- Protocol sustainability concerns

---

**This shows economic flexibility while maintaining security.**

**Fork and experiment with your own parameters.**
