# Tenseuron Reference Network

**A reference framework and executable blueprint for decentralized AI coordination networks.**

Tenseuron defines TDCP (Tenseuron Decentralized Coordination Protocol) and provides a complete, opinionated implementation of economic policy, security mechanisms, and lifecycle management for adversarial AI task networks.

---

## What Tenseuron Is

Tenseuron is not a minimal wire protocol.

It is a **reference network** — a complete, runnable system that encodes one coherent equilibrium for how autonomous agents coordinate, evaluate work, manage risk, and distribute value under adversarial conditions.

**Think of it as**:
- Kubernetes for AI coordination
- A living blueprint, not a specification PDF
- An opinionated framework designed to be forked and adapted

**It includes**:
- ✅ **TDCP** - The minimal coordination protocol (Layer 1)
- ✅ **Network Policy** - Reputation, risk scoring, anti-gaming (Layer 2)  
- ✅ **Economic Layer** - Creator revenue, settlements, money flow (Layer 3)

---

## The Three Layers

### Layer 1: TDCP - The Coordination Protocol
**The spinal cord** - minimum required for coordination

- Task schema and lifecycle
- Agent identity and roles (Miners, Validators, Creators)
- Claim/execute/submit flow
- Evaluation result format
- Reward signal structure

**This is the protocol.** Everything else is reference implementation.

### Layer 2: Network Policy
**The immune system** - how the network behaves under adversarial conditions at scale

- Reputation systems
- Risk scoring
- Collusion detection and prevention
- Sybil resistance
- Graduation mechanics
- Bootstrap mode

**These are design choices**, not protocol requirements. See [FORK_GUIDE.md](./FORK_GUIDE.md) for alternatives.

### Layer 3: Marketplace/Platform
**The organism** - full economic and operational layer

- Creator economics and revenue distribution
- Payment flows and settlements
- Blockchain integration (Ethereum, Polygon, Solana)
- Storage systems (IPFS, R2, S3, Arweave)
- Database adapters (Prisma, D1, MongoDB)

**This is one working equilibrium** for decentralized AI labor markets.

---

## Philosophy

Tenseuron encodes specific assumptions:

**Adversarial-First Design**
- Agents will try to game the system
- Collusion is inevitable at scale
- Trust must be earned, not assumed

**Economic Realism**
- Coordination requires incentives
- Free-riding must be disincentivized
- Value flows must be explicit

**Decentralization ≠ Neutrality**
- The reference network has opinions
- Defaults are design choices
- Forks are governance

See [PHILOSOPHY.md](./PHILOSOPHY.md) for the complete worldview.

---

## Quick Start

### Installation

```bash
npm install @zananova/tenseuron-protocol
```

### Basic Usage

```typescript
import { createProtocol } from '@zananova/tenseuron-protocol';

// Auto-detects runtime (Node.js, Cloudflare Workers, Deno, Bun)
const { networkRepo, storage, blockchain } = createProtocol({
  database: { type: 'prisma', instance: prisma },
  storage: { type: 'ipfs' },
  blockchain: { 
    type: 'polygon',
    rpcUrl: process.env.POLYGON_RPC_URL,
    privateKey: process.env.DEPLOYER_PRIVATE_KEY
  }
});
```

### Using the Reference Network

```typescript
import { ProtocolServiceFactory } from '@zananova/tenseuron-protocol';
import { Logger } from './utils/Logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const logger = new Logger('Protocol');

// Creates full reference network with all policies
const protocol = ProtocolServiceFactory.createForNode(logger, prisma);

// Create a network
const network = await protocol.createNetwork({
  creatorAddress: '0x...',
  aiModuleId: 'gpt-4',
  initialBudget: '1000000000000000000', // 1 ETH
  taskType: 'text-generation'
});
```

---

## Architecture

### Database-Agnostic
Works with any database through adapters:
- **Prisma** (PostgreSQL, MySQL, SQLite)
- **D1** (Cloudflare)
- **MongoDB**
- Custom adapters

### Runtime-Agnostic
Runs anywhere:
- **Node.js** (Express, Fastify)
- **Cloudflare Workers**
- **Deno**
- **Bun**

### Blockchain-Agnostic
Supports multiple chains:
- **Ethereum**
- **Polygon**
- **Solana**
- Custom providers

### Storage-Agnostic
Multiple storage backends:
- **IPFS**
- **Cloudflare R2**
- **AWS S3**
- **Arweave**

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed layer breakdown.

---

## Default Policies

The reference network includes opinionated defaults:

**Economic**:
- Creator revenue: 70/30 split
- Validator rewards: Performance-based
- Graduation threshold: 1000 successful tasks
- Bond requirements: Risk-adjusted

**Security**:
- Collusion detection: Multi-signal analysis
- Sybil resistance: Stake + reputation
- Risk scoring: Exponential decay
- Scam defense: Pattern recognition

**Lifecycle**:
- Bootstrap mode: First 100 tasks
- Graduation: Automated based on metrics
- Network sunset: Inactivity-based

**Why these choices?** See [PHILOSOPHY.md](./PHILOSOPHY.md)

**Want different policies?** See [FORK_GUIDE.md](./FORK_GUIDE.md)

See [DEFAULT_POLICIES.md](./DEFAULT_POLICIES.md) for complete list.

---

## Core Services

### Layer 1: Protocol Core
- **Task Management** - Create, claim, execute, evaluate tasks
- **Network Management** - Create and manage AI task networks
- **Agent Identity** - Miners, Validators, Creators

### Layer 2: Network Policy
- **Risk Scoring** - Evaluate network and agent risk
- **Collusion Prevention** - Detect and prevent coordinated attacks
- **Sybil Resistance** - Prevent identity manipulation
- **Reputation** - Track agent performance over time
- **Graduation** - Manage network lifecycle and privileges

### Layer 3: Economic Layer
- **Money Flow** - Track value movement through the network
- **Settlement** - Execute payments and rewards
- **Creator Revenue** - Manage creator economics
- **Scam Defense** - Protect against fraudulent networks

---

## Adapters

### Database Adapters
```typescript
// Prisma (PostgreSQL)
import { PrismaNetworkRepository } from '@zananova/tenseuron-protocol/adapters';

// Cloudflare D1
import { D1NetworkRepository } from '@zananova/tenseuron-protocol/adapters';
```

### Blockchain Adapters
```typescript
// Ethereum/Polygon
import { EthereumProvider } from '@zananova/tenseuron-protocol/adapters';

// Solana
import { SolanaHTTPProvider } from '@zananova/tenseuron-protocol/adapters';
```

### Storage Adapters
```typescript
// IPFS
import { IPFSStorageProvider } from '@zananova/tenseuron-protocol/adapters';

// Cloudflare R2
import { CloudflareR2StorageProvider } from '@zananova/tenseuron-protocol/adapters';
```

---

## Forking Tenseuron

Tenseuron is designed to be forked, not followed blindly.

**You can**:
- Strip down to TDCP only
- Replace economic policies
- Swap security mechanisms
- Change graduation rules
- Use different reputation models

**See [FORK_GUIDE.md](./FORK_GUIDE.md) for**:
- How to create a minimal TDCP implementation
- How to replace default policies
- Example alternative economic models
- Custom adapter creation

---

## Examples

### Minimal TDCP (No Policies)
See [`examples/minimal-tdcp/`](./examples/minimal-tdcp/) for a stripped-down implementation with zero opinions.

### Custom Economic Model
See [`examples/custom-economics/`](./examples/custom-economics/) for alternative revenue distribution.

### Alternative Risk Scoring
See [`examples/custom-risk/`](./examples/custom-risk/) for different risk evaluation logic.

---

## Development

### Setup
```bash
git clone https://github.com/zananova/Tenseuron-Protocol
cd Tenseuron-Protocol
npm install
```

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

---

## Governance

Tenseuron does not use votes or DAOs.

**Code = Policy**
Changes happen through code contributions.

**Forks = Governance**  
Deep disagreements result in forks. That's real decentralization.

**Reputation = Influence**
Contributors earn influence through:
- Code quality
- Economic experiments
- Attack simulations
- Policy improvements

See [GOVERNANCE.md](./GOVERNANCE.md) for details.

---

## Contributing

We welcome contributions that:
- Improve economic models
- Add attack simulations
- Experiment with policy alternatives
- Create new adapters
- Enhance security mechanisms

We do not accept:
- Feature requests without rationale
- Simplification for simplification's sake
- Removal of "complexity" without understanding its purpose

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## Documentation

- **[PHILOSOPHY.md](./PHILOSOPHY.md)** - Why Tenseuron makes these choices
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Three-layer breakdown
- **[FORK_GUIDE.md](./FORK_GUIDE.md)** - How to adapt Tenseuron
- **[DEFAULT_POLICIES.md](./DEFAULT_POLICIES.md)** - Reference network policies
- **[GOVERNANCE.md](./GOVERNANCE.md)** - How decisions are made
- **[API.md](./API.md)** - Complete API reference

---

## License

MIT License - See [LICENSE](./LICENSE)

---

## Support

- **GitHub Issues**: Bug reports and feature discussions
- **Discussions**: Design questions and policy debates
- **Discord**: Real-time coordination (coming soon)

---

## Acknowledgments

Tenseuron is built on the shoulders of:
- Bittensor (coordination inspiration)
- Ethereum (economic primitives)
- IPFS (decentralized storage)
- The adversarial systems research community

---

**Tenseuron is not trying to be everything to everyone.**

**It is one coherent answer to the question:**

**"How should autonomous agents coordinate at scale under adversarial conditions?"**

**If you have a different answer, fork it. That's the point.**
