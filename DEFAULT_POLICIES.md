# Tenseuron Default Policies

**Reference network policies and parameters.**

These are design choices, not universal truths. They represent one working equilibrium for decentralized AI coordination under adversarial conditions.

---

## Economic Policies

### Creator Revenue Share
**Default**: 70/30 split (creator/protocol)

**Rationale**:
- Creators bear the risk of network creation
- High creator share incentivizes quality networks
- Protocol fee funds infrastructure and development

**Configurable**: Yes
**Alternative values**: 80/20 (higher creator incentive), 60/40 (higher protocol revenue)

**See**: `MoneyFlowService.ts`

---

### Validator Rewards
**Default**: Performance-based

**Formula**:
```
reward = baseReward * (accuracyScore * 0.6 + speedScore * 0.4)
```

**Rationale**:
- Incentivizes accurate evaluation
- Rewards fast response times
- Prevents lazy validation

**Configurable**: Yes
**Alternative**: Fixed rewards per evaluation

**See**: `SettlementService.ts`

---

### Bond Requirements
**Default**: Risk-adjusted (5-20% of network value)

**Formula**:
```
bond = networkValue * bondPercentage * riskMultiplier
```

**Risk multipliers**:
- Low risk (established creator): 1.0x (5%)
- Medium risk (new creator): 2.0x (10%)
- High risk (flagged creator): 4.0x (20%)

**Rationale**:
- High-risk creators must have skin in the game
- Bonds are returned after successful graduation
- Prevents throwaway scam networks

**Configurable**: Yes
**Alternative**: Flat percentage, no bonds

**See**: `CreatorReputationService.ts` (interface)

---

### Graduation Threshold
**Default**: 1000 successful tasks

**Rationale**:
- Sufficient data to assess network quality
- High enough to prevent gaming
- Low enough to be achievable

**Configurable**: Yes
**Alternative values**: 500 (faster), 2000 (more conservative)

**See**: `GraduationService.ts`

---

## Security Policies

### Collusion Detection
**Default**: Multi-signal analysis with 3-strike system

**Detection signals**:
- Timing patterns (validators always agree within seconds)
- Relationship patterns (same validators repeatedly paired)
- Behavior patterns (suspiciously high agreement rates)

**Strike system**:
- Strike 1: Warning
- Strike 2: Temporary suspension (24h)
- Strike 3: Permanent ban

**Rationale**:
- Single-signal detection is easy to evade
- Collusion manifests in multiple ways
- Progressive penalties allow for false positives

**Configurable**: Yes
**Alternative**: 1-strike (zero tolerance), 5-strike (more forgiving)

**See**: `CollusionPreventionService.ts`

---

### Sybil Resistance
**Default**: Stake + Reputation requirement

**Requirements**:
- Minimum stake: 0.1 ETH (or equivalent)
- Minimum reputation: 100 points
- Account age: 30 days

**Rationale**:
- Stake alone can be split across identities
- Reputation alone can be gamed
- Combination is harder to fake

**Configurable**: Yes
**Alternative**: Stake-only, reputation-only, or different thresholds

**See**: `SybilResistanceService.ts`

---

### Risk Scoring
**Default**: Exponential decay model

**Risk factors**:
- Creator history (40% weight)
- Network parameters (30% weight)
- Task complexity (20% weight)
- External signals (10% weight)

**Decay function**:
```
currentRisk = initialRisk * exp(-successfulTasks / 1000)
```

**Rationale**:
- Recent behavior matters more than distant past
- Allows redemption for reformed bad actors
- Prevents permanent blacklisting

**Configurable**: Yes
**Alternative**: Linear decay, no decay, different weights

**See**: `RiskScoringService.ts`

---

### Scam Defense
**Default**: Multi-factor pattern recognition

**Detection factors**:
- Unrealistic promises (>100% APY)
- Rapid fund withdrawal attempts
- Suspicious creator history
- Network parameter anomalies
- Community reports

**Response**:
- Automatic flagging (2+ factors)
- Manual review (3+ factors)
- Immediate suspension (4+ factors)

**Rationale**:
- Scams often exhibit multiple red flags
- Automated detection reduces response time
- Manual review prevents false positives

**Configurable**: Yes
**Alternative**: Different thresholds, automated-only, manual-only

**See**: `ScamDefenseService.ts`

---

## Lifecycle Policies

### Bootstrap Mode
**Default**: First 100 tasks

**Restrictions during bootstrap**:
- Lower task limits (10 concurrent vs 100)
- Higher oversight (more frequent checks)
- Limited privileges (no graduation benefits)

**Rationale**:
- Protects early participants from scams
- Allows network to prove viability
- Reduces systemic risk

**Configurable**: Yes
**Alternative values**: 50 tasks (faster), 200 tasks (more conservative)

**See**: `BootstrapModeService.ts`

---

### Graduation
**Default**: Automated based on metrics

**Graduation criteria**:
- 1000 successful tasks
- <5% failure rate
- No active scam flags
- Positive creator reputation

**Benefits after graduation**:
- Increased task limits (100 concurrent)
- Lower protocol fees (25% vs 30%)
- Bond refund
- Priority in discovery

**Rationale**:
- Automated graduation reduces overhead
- Metrics-based is objective
- Benefits incentivize quality

**Configurable**: Yes
**Alternative**: Manual graduation, different thresholds

**See**: `GraduationService.ts`

---

### Network Sunset
**Default**: 90 days of inactivity

**Sunset process**:
1. Warning at 60 days
2. Final notice at 80 days
3. Automatic sunset at 90 days
4. Funds returned to creator

**Rationale**:
- Prevents zombie networks
- Frees up resources
- Maintains network quality

**Configurable**: Yes
**Alternative**: Longer period, manual sunset, no sunset

**See**: `GraduationService.ts`

---

## Reputation Policies

### Reputation Calculation
**Default**: Weighted average of recent performance

**Formula**:
```
reputation = Σ(taskScore * timeDecay) / totalTasks
```

**Time decay**:
```
decay = exp(-taskAge / 30days)
```

**Rationale**:
- Recent performance matters more
- Allows recovery from past mistakes
- Incentivizes consistent quality

**Configurable**: Yes
**Alternative**: Simple average, no decay, different decay rate

**See**: Implemented in launchpad adapters

---

### Reputation Recovery
**Default**: Exponential improvement with good behavior

**Recovery rate**:
```
newReputation = oldReputation + (100 - oldReputation) * 0.1 * successRate
```

**Rationale**:
- Allows redemption
- Faster recovery for consistent good behavior
- Prevents permanent punishment

**Configurable**: Yes
**Alternative**: Linear recovery, no recovery, different rates

**See**: Implemented in launchpad adapters

---

## Task Policies

### Task Timeout
**Default**: 24 hours

**Rationale**:
- Sufficient time for complex tasks
- Prevents indefinite holds
- Allows reassignment if needed

**Configurable**: Yes
**Alternative values**: 12h (faster), 48h (more time)

**See**: `TaskService.ts`

---

### Evaluation Consensus
**Default**: Majority of validators (51%)

**Rationale**:
- Simple and fast
- Resistant to single validator manipulation
- Scales with validator count

**Configurable**: Yes
**Alternative**: Supermajority (67%), unanimous, weighted

**See**: `TaskService.ts`

---

### Task Reassignment
**Default**: After 3 failed attempts

**Rationale**:
- Gives miners multiple chances
- Prevents task abandonment
- Maintains network throughput

**Configurable**: Yes
**Alternative values**: 1 attempt (strict), 5 attempts (forgiving)

**See**: `TaskService.ts`

---

## Payment Policies

### Payment Timing
**Default**: After evaluation consensus

**Rationale**:
- Ensures work quality before payment
- Prevents payment for failed tasks
- Aligns incentives

**Configurable**: No (core to protocol)

**See**: `SettlementService.ts`

---

### Payment Currency
**Default**: Native blockchain tokens (ETH, MATIC, SOL)

**Rationale**:
- Simplicity
- No additional token required
- Immediate liquidity

**Configurable**: Yes
**Alternative**: Stablecoins, custom tokens

**See**: `SettlementService.ts`

---

### Fee Structure
**Default**: Percentage-based

**Fees**:
- Protocol fee: 30% of task value (25% after graduation)
- Network fee: 0% (creator keeps remainder)
- Validator fee: From protocol fee pool

**Rationale**:
- Percentage scales with value
- Incentivizes high-value tasks
- Funds protocol development

**Configurable**: Yes
**Alternative**: Flat fees, tiered fees

**See**: `MoneyFlowService.ts`

---

## How to Change Policies

### Option 1: Configuration
Some policies can be changed via configuration:

```typescript
const protocol = ProtocolServiceFactory.create(logger, {
  // ... other config
  policies: {
    graduationThreshold: 500,  // Default: 1000
    bondPercentage: 0.15,       // Default: 0.05-0.20
    collusionStrikes: 5         // Default: 3
  }
});
```

### Option 2: Service Replacement
Replace entire services with custom implementations:

```typescript
import { CustomRiskScoringService } from './custom/RiskScoring';

const protocol = new ProtocolServiceRefactored(logger, {
  // ... other deps
  riskScoringService: new CustomRiskScoringService(logger)
});
```

### Option 3: Fork
For fundamental changes, fork the repository:

See [FORK_GUIDE.md](./FORK_GUIDE.md) for detailed instructions.

---

## Policy Rationale Summary

**Why these specific values?**

These policies represent one equilibrium that balances:
- **Security** vs **Accessibility**
- **Quality** vs **Speed**
- **Decentralization** vs **Efficiency**
- **Forgiveness** vs **Accountability**

**Are they optimal?**

For some use cases, yes. For others, no.

**Should you change them?**

If your threat model, use case, or values differ: absolutely.

**How do we know they work?**

They encode assumptions about adversarial behavior at scale. Real-world testing will validate or refute them.

---

## For Researchers

These policies are hypotheses, not laws.

**Experiment with**:
- Different economic parameters
- Alternative security models
- Novel reputation systems
- Custom lifecycle rules

**Document your findings**.
**Share your forks**.
**That's how we learn**.

---

**These are not the only answers.**

**They are one coherent set of answers.**

**Fork and prove us wrong. That's the point.**
