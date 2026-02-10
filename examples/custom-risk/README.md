# Custom Risk Scoring Example

**Alternative risk evaluation model for Tenseuron networks.**

This example shows how to replace the default exponential decay risk scoring with a custom linear decay model.

---

## What's Changed

### Risk Scoring Model
- **Decay function**: Linear (vs exponential)
- **Risk weights**: Custom distribution
- **Thresholds**: More forgiving
- **Recovery rate**: Faster

### What's Kept
- ✅ All other security features
- ✅ Collusion detection
- ✅ Reputation systems
- ✅ Economic policies
- ✅ Graduation mechanics

---

## Rationale

**Linear decay**:
- Simpler to understand
- More predictable recovery
- Suitable for environments with lower adversarial pressure

**Custom weights**:
- Emphasize different risk factors
- Adapt to specific use case
- Balance security vs accessibility

**Faster recovery**:
- Allow creators to recover from mistakes
- Encourage experimentation
- Lower barrier to re-entry

---

## Implementation

### Custom Risk Scoring Service

```typescript
import { RiskScoringService, RiskParameters, RiskScore } from '../../RiskScoringService';
import { ILogger } from '../../utils/ILogger';

/**
 * Custom Risk Scoring with Linear Decay
 */
export class LinearRiskScoringService extends RiskScoringService {
  constructor(logger: ILogger) {
    super(logger);
  }

  /**
   * Override risk calculation with custom weights
   */
  calculateRiskScore(params: RiskParameters): RiskScore {
    // Custom weight distribution (vs default)
    const payoutCapRisk = this.calculatePayoutCapRisk(params.payoutCap) * 0.25;  // 25% weight (vs 15%)
    const settlementDelayRisk = this.calculateSettlementDelayRisk(params.settlementDelay) * 0.15;  // 15% (vs 10%)
    const maxPayoutRisk = this.calculateMaxPayoutRisk(params.maxPayoutPerTask) * 0.20;  // 20% (vs 15%)
    const validatorCountRisk = this.calculateValidatorCountRisk(params.minValidators) * 0.15;  // 15% (vs 12%)
    const consensusThresholdRisk = this.calculateConsensusThresholdRisk(params.consensusThreshold) * 0.10;  // 10% (vs 10%)
    const disputeWindowRisk = this.calculateDisputeWindowRisk(params.disputeWindow) * 0.10;  // 10% (vs 8%)
    const stakeRequiredRisk = this.calculateStakeRequiredRisk(params.stakeRequired) * 0.05;  // 5% (vs 5%)

    // Binary risks (same as default)
    const customScoringRisk = params.customScoring ? 15 : 0;
    const instantPayoutRisk = params.instantPayout ? 20 : 0;
    const singleValidatorRisk = params.singleValidator ? 25 : 0;
    const nonDeterministicRisk = params.nonDeterministic ? 15 : 0;
    const validatorSelfSelectRisk = params.validatorSelfSelect ? 20 : 0;

    // Calculate total (0-100 scale)
    const totalRisk = Math.min(100,
      payoutCapRisk +
      settlementDelayRisk +
      maxPayoutRisk +
      validatorCountRisk +
      consensusThresholdRisk +
      disputeWindowRisk +
      stakeRequiredRisk +
      customScoringRisk +
      instantPayoutRisk +
      singleValidatorRisk +
      nonDeterministicRisk +
      validatorSelfSelectRisk
    );

    // More forgiving categories
    let riskCategory: 'safe' | 'moderate' | 'risky' | 'dangerous';
    if (totalRisk < 30) riskCategory = 'safe';        // vs 20
    else if (totalRisk < 55) riskCategory = 'moderate';  // vs 40
    else if (totalRisk < 75) riskCategory = 'risky';     // vs 60
    else riskCategory = 'dangerous';

    return {
      totalRisk,
      parameterBreakdown: {
        payoutCapRisk,
        settlementDelayRisk,
        customScoringRisk,
        instantPayoutRisk,
        singleValidatorRisk,
        nonDeterministicRisk,
        validatorSelfSelectRisk,
        maxPayoutRisk,
        validatorCountRisk,
        consensusThresholdRisk,
        disputeWindowRisk,
        stakeRequiredRisk
      },
      riskCategory
    };
  }

  /**
   * Linear decay instead of exponential
   * Faster recovery from high risk
   */
  calculateRiskDecay(initialRisk: number, successfulTasks: number): number {
    // Linear decay: reduce by 1 point per 10 successful tasks
    const decayRate = 0.1;  // 10% per 10 tasks
    const decayAmount = successfulTasks * decayRate;
    
    // Risk can't go below 0
    const currentRisk = Math.max(0, initialRisk - decayAmount);

    this.logger.info('Risk decay calculated', {
      initialRisk,
      successfulTasks,
      decayAmount,
      currentRisk,
      model: 'linear'
    });

    return currentRisk;
  }

  /**
   * More forgiving payout cap risk
   */
  protected calculatePayoutCapRisk(payoutCap: string): number {
    const cap = BigInt(payoutCap);
    const oneEth = BigInt('1000000000000000000');

    // More forgiving thresholds
    if (cap <= oneEth) return 0;                    // ≤1 ETH: safe
    if (cap <= oneEth * 5n) return 5;               // ≤5 ETH: low risk
    if (cap <= oneEth * 10n) return 10;             // ≤10 ETH: moderate
    if (cap <= oneEth * 50n) return 15;             // ≤50 ETH: risky
    return 20;                                       // >50 ETH: dangerous
  }

  /**
   * More forgiving settlement delay risk
   */
  protected calculateSettlementDelayRisk(settlementDelay: number): number {
    // Shorter delays acceptable
    if (settlementDelay >= 7 * 24 * 60 * 60) return 0;    // ≥7 days: safe
    if (settlementDelay >= 3 * 24 * 60 * 60) return 3;    // ≥3 days: low
    if (settlementDelay >= 24 * 60 * 60) return 7;        // ≥1 day: moderate
    if (settlementDelay >= 6 * 60 * 60) return 12;        // ≥6 hours: risky
    return 15;                                             // <6 hours: dangerous
  }
}
```

---

## Comparison: Default vs Custom

### Risk Decay

**Default (Exponential)**:
```typescript
decay = exp(-successfulTasks / 1000)

Examples:
- 100 tasks: 90.5% of initial risk remains
- 500 tasks: 60.7% remains
- 1000 tasks: 36.8% remains
- 2000 tasks: 13.5% remains
```

**Custom (Linear)**:
```typescript
decay = initialRisk - (successfulTasks * 0.1)

Examples:
- 100 tasks: 10 points reduced
- 500 tasks: 50 points reduced
- 1000 tasks: 100 points reduced (floor at 0)
- 2000 tasks: 100 points reduced (floor at 0)
```

### Risk Categories

**Default Thresholds**:
```
Safe: 0-20
Moderate: 20-40
Risky: 40-60
Dangerous: 60-100
```

**Custom Thresholds (More Forgiving)**:
```
Safe: 0-30
Moderate: 30-55
Risky: 55-75
Dangerous: 75-100
```

### Weight Distribution

**Default**:
```
Payout Cap: 15%
Settlement Delay: 10%
Max Payout: 15%
Validator Count: 12%
Consensus: 10%
Dispute Window: 8%
Stake Required: 5%
+ Binary flags
```

**Custom**:
```
Payout Cap: 25%  ↑
Settlement Delay: 15%  ↑
Max Payout: 20%  ↑
Validator Count: 15%  ↑
Consensus: 10%  =
Dispute Window: 10%  ↑
Stake Required: 5%  =
+ Binary flags
```

---

## Usage

### Factory Integration

```typescript
import { LinearRiskScoringService } from './LinearRiskScoringService';

export function createCustomRiskProtocol(logger, prisma) {
  // Create custom risk service
  const riskScoringService = new LinearRiskScoringService(logger);

  // Create protocol with custom risk scoring
  return new ProtocolServiceRefactored(logger, {
    // Standard services
    networkRepo: new PrismaNetworkRepository(prisma, logger),
    aiModuleRepo: new LaunchpadAIModuleRepository(aiModuleService),
    creatorReputationService: new LaunchpadCreatorReputationService(creatorRepService),
    storage: new IPFSStorageProvider(),
    blockchain: new EthereumProvider(rpcUrl, privateKey),
    
    // Custom risk scoring
    riskScoringService,  // Linear decay model
    
    // Keep default for others
    moneyFlowService: new MoneyFlowService(logger),
    settlementService: new SettlementService(logger),
    scamDefenseService: new ScamDefenseService(logger, prisma),
    decentralizedRegistry: new DecentralizedRegistryService(logger)
  });
}
```

### Direct Usage

```typescript
const protocol = createCustomRiskProtocol(logger, prisma);

const network = await protocol.createNetwork({
  creatorAddress: '0x...',
  aiModuleId: 'gpt-4',
  initialBudget: '10000000000000000000',
  taskType: 'text-generation',
  riskParameters: {
    payoutCap: '5000000000000000000',  // 5 ETH
    settlementDelay: 3 * 24 * 60 * 60,  // 3 days
    // ... other params
  }
});

// Risk calculated with linear decay model
// More forgiving thresholds
// Faster recovery from mistakes
```

---

## Risk Recovery Comparison

### Scenario: Creator with High Initial Risk (80)

**Default (Exponential Decay)**:
```
After 100 tasks: 72.4 risk
After 500 tasks: 48.6 risk
After 1000 tasks: 29.4 risk
After 2000 tasks: 10.8 risk
```

**Custom (Linear Decay)**:
```
After 100 tasks: 70 risk
After 500 tasks: 30 risk
After 1000 tasks: 0 risk
After 2000 tasks: 0 risk
```

**Result**: Linear model allows faster recovery

---

## Trade-offs

### What You Gain ✅
- **Faster recovery**: Linear decay is more forgiving
- **More predictable**: Easier to calculate risk reduction
- **Lower barrier**: More forgiving thresholds
- **Encourages experimentation**: Mistakes less costly
- **Simpler math**: No exponentials

### What You Lose ❌
- **Less conservative**: May allow risky networks sooner
- **No asymptotic behavior**: Risk can hit zero completely
- **Less nuanced**: Linear is less sophisticated
- **Potential for gaming**: Easier to predict and game

---

## When to Use

### ✅ Good Fit
- Lower-risk environments
- Want to encourage creator participation
- Predictability valued
- Faster recovery desired
- Simpler model preferred

### ❌ Bad Fit
- High-stakes networks
- Adversarial environments
- Need conservative risk management
- Sophisticated risk modeling required

---

## Testing

```typescript
describe('LinearRiskScoringService', () => {
  it('uses linear decay', () => {
    const service = new LinearRiskScoringService(logger);
    
    const initialRisk = 80;
    const after100 = service.calculateRiskDecay(initialRisk, 100);
    const after500 = service.calculateRiskDecay(initialRisk, 500);
    const after1000 = service.calculateRiskDecay(initialRisk, 1000);

    expect(after100).toBe(70);   // 80 - 10
    expect(after500).toBe(30);   // 80 - 50
    expect(after1000).toBe(0);   // 80 - 100 (floor at 0)
  });

  it('has more forgiving thresholds', () => {
    const service = new LinearRiskScoringService(logger);
    
    const score = service.calculateRiskScore({
      payoutCap: '5000000000000000000',  // 5 ETH
      // ... params that give 35 total risk
    });

    // 35 is "safe" in custom (< 30 threshold)
    // but "moderate" in default (> 20 threshold)
    expect(score.riskCategory).toBe('moderate');  // Still moderate at 35
  });

  it('emphasizes payout cap more', () => {
    const service = new LinearRiskScoringService(logger);
    
    const score = service.calculateRiskScore({
      payoutCap: '100000000000000000000',  // 100 ETH (high)
      settlementDelay: 7 * 24 * 60 * 60,   // 7 days (safe)
      // ... other safe params
    });

    // Payout cap has 25% weight (vs 15% default)
    // So high payout cap impacts score more
    expect(score.parameterBreakdown.payoutCapRisk).toBeGreaterThan(15);
  });
});
```

---

## Alternative Risk Models

### Logarithmic Decay

```typescript
calculateRiskDecay(initialRisk: number, successfulTasks: number): number {
  // Fast initial decay, then slows down
  const decayFactor = Math.log(successfulTasks + 1) / Math.log(1000);
  return initialRisk * (1 - decayFactor);
}
```

### Stepped Decay

```typescript
calculateRiskDecay(initialRisk: number, successfulTasks: number): number {
  // Decay in steps
  if (successfulTasks < 100) return initialRisk;
  if (successfulTasks < 500) return initialRisk * 0.7;
  if (successfulTasks < 1000) return initialRisk * 0.4;
  return initialRisk * 0.1;
}
```

### Hybrid Model

```typescript
calculateRiskDecay(initialRisk: number, successfulTasks: number): number {
  // Exponential for first 500, then linear
  if (successfulTasks < 500) {
    return initialRisk * Math.exp(-successfulTasks / 1000);
  } else {
    const baseRisk = initialRisk * Math.exp(-0.5);
    return Math.max(0, baseRisk - ((successfulTasks - 500) * 0.05));
  }
}
```

---

## Further Customization

### Domain-Specific Risk Factors

```typescript
calculateRiskScore(params: RiskParameters & { domain?: string }): RiskScore {
  const baseScore = super.calculateRiskScore(params);
  
  // Add domain-specific adjustments
  if (params.domain === 'financial') {
    baseScore.totalRisk *= 1.5;  // Higher risk for financial
  } else if (params.domain === 'research') {
    baseScore.totalRisk *= 0.7;  // Lower risk for research
  }
  
  return baseScore;
}
```

### Time-Based Risk

```typescript
calculateRiskScore(params: RiskParameters & { networkAge?: number }): RiskScore {
  const baseScore = super.calculateRiskScore(params);
  
  // New networks are riskier
  if (params.networkAge < 30 * 24 * 60 * 60) {  // < 30 days
    baseScore.totalRisk += 10;
  }
  
  return baseScore;
}
```

---

## Summary

**Custom Risk Scoring**:
- ✅ Linear decay (faster recovery)
- ✅ More forgiving thresholds
- ✅ Custom weight distribution
- ✅ Simpler and more predictable
- ✅ Keeps all other security features

**Use when**:
- Lower-risk environment
- Want to encourage participation
- Predictability valued
- Faster recovery desired

**Avoid when**:
- High-stakes networks
- Adversarial environments
- Need conservative risk management

---

**This shows risk model flexibility while maintaining security.**

**Experiment with decay functions that fit your threat model.**
