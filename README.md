<<<<<<< HEAD
# Tenseuron Protocol

**Database-agnostic, runtime-agnostic protocol for decentralized AI task networks**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

The Tenseuron Protocol is an open-source framework for building decentralized AI task marketplaces. It provides a complete, production-ready architecture that works with **any database**, **any runtime**, and **any blockchain**.

### Key Features

- 🗄️ **Database Agnostic** - Works with Prisma, D1, MongoDB, Supabase, or any database via adapters
- ⚡ **Runtime Agnostic** - Deploy to Node.js, Cloudflare Workers, Deno, or Bun
- 🔗 **Blockchain Agnostic** - Supports Ethereum, Polygon, Solana, and more
- 📦 **Storage Agnostic** - Use IPFS, Arweave, S3, R2, or any storage provider
- 🏗️ **Production Ready** - Battle-tested architecture with comprehensive validation
- 🔒 **Security First** - Built-in scam defense, risk scoring, and reputation systems

## What is Tenseuron?

Tenseuron enables decentralized AI task networks where:
- **Miners** (AI models) solve tasks and compete for rewards
- **Validators** evaluate outputs and ensure quality
- **Users** submit tasks and pay for results
- **Creators** launch AI networks for specific capabilities

## Quick Start

### Installation

```bash
npm install @zananova/tenseuron-protocol
```

### Basic Usage

```typescript
import { createProtocol } from '@zananova/tenseuron-protocol';

// Auto-detect runtime and use defaults
const protocol = createProtocol();

// Or configure explicitly
const protocol = createProtocol({
  database: { type: 'd1', instance: env.DB },
  storage: { type: 'r2', config: env.R2_BUCKET },
  blockchain: {
    type: 'polygon',
    rpcUrl: 'https://polygon-rpc.com',
    privateKey: env.DEPLOYER_PRIVATE_KEY
  }
});
```

## Architecture

### Core Concepts

#### 1. AI Modules
Define **what** is being solved (e.g., "text-to-code", "image-classification"):
- Task input/output schemas (JSON Schema)
- Scoring rules (deterministic, statistical, or WASM)
- Validation criteria
- Evaluation mode

#### 2. AI Networks
Specific instances using a module:
- Settlement contract (escrow or receipt mode)
- Optional network token (ERC20)
- Money flow configuration
- Risk parameters
- Graduation status

#### 3. Tasks
Specific jobs submitted to a network:
- Input data
- Deposit amount
- Miner outputs
- Validator evaluations
- Final consensus score

#### 4. Settlement
Payment mechanisms:
- **Escrow mode**: Funds locked until consensus
- **Receipt mode**: Pay-as-you-go with receipts

## Adapters

### Database Adapters

```typescript
// Cloudflare D1
import { D1NetworkRepository } from '@zananova/tenseuron-protocol';
const networkRepo = new D1NetworkRepository(env.DB, logger);

// Prisma (Node.js)
import { PrismaNetworkRepository } from '@zananova/tenseuron-protocol';
const networkRepo = new PrismaNetworkRepository(prisma, logger);

// Create your own
import { INetworkRepository } from '@zananova/tenseuron-protocol';
class MongoNetworkRepository implements INetworkRepository {
  // Implement interface methods
}
```

### Storage Adapters

```typescript
// Cloudflare R2
import { CloudflareR2StorageProvider } from '@zananova/tenseuron-protocol';
const storage = new CloudflareR2StorageProvider(env.R2_BUCKET, logger);

// IPFS
import { IPFSStorageProvider } from '@zananova/tenseuron-protocol';
const storage = new IPFSStorageProvider(ipfsConfig, logger);
```

### Blockchain Adapters

```typescript
// Ethereum (Workers-compatible)
import { EthereumHTTPProvider } from '@zananova/tenseuron-protocol';
const blockchain = new EthereumHTTPProvider(rpcUrl);

// Ethereum (Node.js with ethers.js)
import { EthereumProvider } from '@zananova/tenseuron-protocol';
const blockchain = new EthereumProvider(rpcUrl, privateKey);
```

## Usage Examples

### Creating a Network

```typescript
import { 
  ProtocolServiceRefactored,
  D1NetworkRepository,
  CloudflareR2StorageProvider,
  EthereumHTTPProvider,
  ConsoleLogger
} from '@zananova/tenseuron-protocol';

const logger = new ConsoleLogger('MyApp');

const protocolService = new ProtocolServiceRefactored(logger, {
  networkRepo: new D1NetworkRepository(env.DB, logger),
  aiModuleRepo: new D1AIModuleRepository(env.DB, logger),
  creatorReputationService: myReputationService,
  storage: new CloudflareR2StorageProvider(env.R2_BUCKET, logger),
  blockchain: new EthereumHTTPProvider(env.POLYGON_RPC_URL),
  decentralizedRegistry: myRegistryService,
  settlementService: mySettlementService,
  scamDefenseService: myScamDefenseService,
  riskScoringService: myRiskScoringService,
  moneyFlowService: myMoneyFlowService
});

const result = await protocolService.createNetwork({
  name: "Code Generation Network",
  moduleId: "text-to-code-v1",
  creatorAddress: "0x...",
  settlementChain: "polygon",
  // ... other parameters
});
```

### Custom Logger

```typescript
import { ILogger } from '@zananova/tenseuron-protocol';

class MyCustomLogger implements ILogger {
  debug(message: string, meta?: any): void {
    // Send to your logging service
  }
  
  info(message: string, meta?: any): void {
    // Send to your logging service
  }
  
  warn(message: string, meta?: any): void {
    // Send to your logging service
  }
  
  error(message: string, meta?: any): void {
    // Send to your logging service
  }
}

const logger = new MyCustomLogger();
```

## Interfaces

All core functionality is defined through interfaces, making the protocol fully extensible:

- `ILogger` - Logging interface
- `INetworkRepository` - Network data storage
- `ITaskRepository` - Task data storage
- `IValidatorRepository` - Validator data storage
- `IAIModuleRepository` - AI module data storage
- `IStorageProvider` - File/manifest storage
- `IBlockchainProvider` - Blockchain interactions
- `ICreatorReputationService` - Creator reputation management

## Money Flow

### Creation Fees
When creating a network:
- Creator bond (based on reputation)
- Deployment cost (gas fees)
- Registry fee (protocol fee)

### Usage Fees
When tasks are completed:
- Creator cut (% of task payment)
- Validator payment (for evaluation)
- Miner pool (for AI models)
- Purpose-bound sinks (protocol treasury)
- Burn (deflationary mechanism)

## Risk Scoring

Networks are scored based on:
- Payout cap
- Settlement delay
- Custom scoring
- Instant payout
- Single validator
- Non-deterministic evaluation
- Validator self-selection
- Max payout per task

**Higher risk → Higher required bond/stake**

## Graduation System

Networks progress through levels:
1. **Sandbox** - New networks, limited functionality
2. **Active** - Proven track record, more features
3. **Trusted** - High reputation, full features
4. **Open Economic** - Fully decentralized, no restrictions

## Development

### Building from Source

```bash
git clone https://github.com/zananova/Tenseuron-Protocol.git
cd Tenseuron-Protocol
npm install
npm run build
```

### Running Tests

```bash
npm test
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- **Documentation**: [docs.tenseuron.com](https://docs.tenseuron.com)
- **Website**: [tenseuron.com](https://tenseuron.com)
- **GitHub**: [github.com/zananova/Tenseuron-Protocol](https://github.com/zananova/Tenseuron-Protocol)
- **Discord**: [discord.gg/tenseuron](https://discord.gg/tenseuron)

## Support

- **Issues**: [GitHub Issues](https://github.com/zananova/Tenseuron-Protocol/issues)
- **Discussions**: [GitHub Discussions](https://github.com/zananova/Tenseuron-Protocol/discussions)
- **Email**: protocol@tenseuron.com

---

Built with ❤️ by the Tenseuron team
=======
# Tenseuron-Protocol
"Tenseuron-Distributed-Coordination-Protocol-TDCP, Database-agnostic, runtime-agnostic protocol for decentralized AI task networks
>>>>>>> 6ac775163e816546fe3058bd83adaf91ab719a50
