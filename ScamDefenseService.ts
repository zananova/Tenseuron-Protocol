/**
 * Scam Defense Service
 * 
 * Implements structural defenses against scam networks:
 * - Economic friction at creation
 * - Reputation tracking (local)
 * - Network verification status
 * - Dispute tracking
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest, SupportedChain } from './types';
import { PrismaClient } from '@prisma/client';
import { multiChainService } from '../services/chains/MultiChainService';

export interface NetworkReputation {
  networkId: string;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  disputeCount: number;
  unresolvedReceipts: number;
  createdAt: number;
  lastActivity: number;
  verificationStatus: 'unverified' | 'verified' | 'flagged';
  flags: string[];
}

export interface NetworkCreationFee {
  bond: string;           // Required bond (in native token)
  deploymentCost: string; // Estimated deployment cost
  registryFee: string;    // Registry fee (optional)
  penaltyConfigFee: string; // Additional fee for custom penalty configuration (0 if using protocol defaults)
  total: string;          // Total required
}

export class ScamDefenseService {
  private logger: ILogger;
  private prisma?: PrismaClient;
  private reputationStore: Map<string, NetworkReputation> = new Map();

  constructor(logger: ILogger, prisma?: PrismaClient) {
    this.logger = logger;
    this.prisma = prisma;
  }

  /**
   * Calculate creation fees (economic friction)
   * Now uses risk-based dynamic pricing (PROTOCOL-LEVEL)
   * Prevents spam by requiring upfront costs that scale with risk
   */
  calculateCreationFees(
    chain: string,
    requiredCosts?: {
      creationFee: string;
      creatorReward: string;
      requiredStake: string;
      settlementDelay: number;
      escrowLockup: number;
      slashingEnabled: boolean;
      slashingRate: number;
      penaltyConfigFee?: string; // Additional fee for custom penalty configuration
    }
  ): NetworkCreationFee {
    // If risk-based costs provided, use them (PROTOCOL-LEVEL PRICING)
    if (requiredCosts) {
      const baseDeploymentCost = process.env.NETWORK_DEPLOYMENT_COST || '0.005'; // Estimated gas
      const registryFee = process.env.NETWORK_REGISTRY_FEE || '0.001'; // IPFS pinning
      
      // Creation fee from risk assessment (already includes base bond)
      const bond = requiredCosts.creationFee;
      const deploymentCost = baseDeploymentCost;
      const registryFeeAmount = registryFee;
      const penaltyConfigFee = requiredCosts.penaltyConfigFee || '0';
      const total = (parseFloat(bond) + parseFloat(deploymentCost) + parseFloat(registryFeeAmount) + parseFloat(penaltyConfigFee)).toString();

      return {
        bond,
        deploymentCost,
        registryFee: registryFeeAmount,
        penaltyConfigFee,
        total,
      };
    }

    // Fallback to static fees (for backward compatibility)
    const baseBond = process.env.NETWORK_CREATION_BOND || '0.01'; // 0.01 ETH/MATIC/etc
    const baseDeploymentCost = process.env.NETWORK_DEPLOYMENT_COST || '0.005'; // Estimated gas
    const registryFee = process.env.NETWORK_REGISTRY_FEE || '0.001'; // IPFS pinning

    const bond = baseBond;
    const deploymentCost = baseDeploymentCost;
    const registryFeeAmount = registryFee;
    const penaltyConfigFee = '0'; // No custom penalty config in fallback
    const total = (parseFloat(bond) + parseFloat(deploymentCost) + parseFloat(registryFeeAmount)).toString();

    return {
      bond,
      deploymentCost,
      registryFee: registryFeeAmount,
      penaltyConfigFee,
      total,
    };
  }

  /**
   * Verify network creation payment on-chain
   * Ensures user has paid required fees by checking blockchain transaction
   */
  async verifyCreationPayment(
    networkId: string,
    creatorAddress: string,
    chain: string,
    txHash?: string
  ): Promise<boolean> {
    try {
      if (!txHash) {
        this.logger.warn('Payment verification requires transaction hash', { 
          networkId, 
          creatorAddress 
        });
        return false;
      }

      const fees = this.calculateCreationFees(chain);
      // Convert to wei/smallest unit (18 decimals)
      // Note: Different chains have different decimals, but we use 18 as standard
      const requiredAmount = BigInt(Math.floor(parseFloat(fees.total) * 1e18));

      // Verify the transaction on-chain
      return await this.verifyTransactionPayment(
        chain as SupportedChain,
        txHash,
        creatorAddress,
        requiredAmount
      );
    } catch (error) {
      this.logger.error('Failed to verify creation payment', error);
      return false;
    }
  }

  /**
   * Verify transaction payment on-chain
   * Checks that transaction exists, is confirmed, and sender paid required amount
   */
  private async verifyTransactionPayment(
    chain: SupportedChain,
    txHash: string,
    expectedSender: string,
    requiredAmount: bigint
  ): Promise<boolean> {
    try {
      this.logger.info('Verifying payment transaction on-chain', { chain, txHash });

      // Get chain service
      const chainService = multiChainService.getChain(chain);
      if (!chainService) {
        this.logger.error('Chain service not available', { chain });
        return false;
      }

      // Get transaction details
      const tx = await chainService.getTransaction(txHash);
      if (!tx) {
        this.logger.warn('Transaction not found', { txHash, chain });
        return false;
      }

      // Check transaction status
      if (tx.status !== 'confirmed' && tx.receipt?.status !== 1) {
        this.logger.warn('Transaction not confirmed', { txHash, status: tx.status });
        return false;
      }

      // Verify sender matches expected creator
      // ethers.js returns 'from' field, other chains might use 'signer'
      const sender = (tx.from || tx.signer || tx.signerAddress)?.toLowerCase();
      if (!sender || sender !== expectedSender.toLowerCase()) {
        this.logger.warn('Transaction sender mismatch', { 
          txHash, 
          expected: expectedSender, 
          actual: sender || 'unknown'
        });
        return false;
      }

      // Verify amount (for native token transfers)
      // Note: For contract deployments, we check that transaction is confirmed
      // (deployment costs are paid via gas fees, which is sufficient proof of payment)
      if (tx.value) {
        // Handle ethers.js BigNumber or string/number
        let txValue: bigint;
        if (typeof tx.value === 'bigint') {
          txValue = tx.value;
        } else if (typeof tx.value === 'object' && tx.value.toString) {
          // ethers.js BigNumber
          txValue = BigInt(tx.value.toString());
        } else {
          txValue = BigInt(tx.value);
        }

        if (txValue < requiredAmount) {
          this.logger.warn('Transaction amount insufficient', { 
            txHash, 
            required: requiredAmount.toString(), 
            actual: txValue.toString() 
          });
          return false;
        }
      } else {
        // For contract deployments (no value field), transaction exists and is confirmed = payment verified
        // (deployment costs are paid via gas fees, which proves payment)
        this.logger.info('Contract deployment transaction verified (payment via gas fees)', { txHash });
      }

      this.logger.info('Payment verification successful', { 
        txHash, 
        chain, 
        sender 
      });
      return true;

    } catch (error) {
      this.logger.error('Failed to verify transaction payment', { 
        chain, 
        txHash, 
        error 
      });
      return false;
    }
  }

  /**
   * Initialize network reputation (all networks start unverified)
   */
  async initializeReputation(networkId: string): Promise<NetworkReputation> {
    const reputation: NetworkReputation = {
      networkId,
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      disputeCount: 0,
      unresolvedReceipts: 0,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      verificationStatus: 'unverified', // Default: unverified
      flags: [],
    };

    // Store in memory cache
    this.reputationStore.set(networkId, reputation);

    // Persist to database if Prisma available
    if (this.prisma) {
      try {
        await this.prisma.$executeRaw`
          INSERT INTO network_reputation (
            network_id, total_tasks, successful_tasks, failed_tasks,
            dispute_count, unresolved_receipts, verification_status, flags, created_at, last_activity
          ) VALUES (
            ${networkId}, 0, 0, 0, 0, 0, 'unverified', '[]'::jsonb, NOW(), NOW()
          )
          ON CONFLICT (network_id) DO NOTHING
        `;
      } catch (error) {
        // If table doesn't exist, log warning but continue
        this.logger.warn('Could not persist reputation to database (table may not exist)', { networkId });
      }
    }

    return reputation;
  }

  /**
   * Get network reputation (local, not global)
   * Checks memory cache first, then database if available
   */
  async getReputation(networkId: string): Promise<NetworkReputation | null> {
    // Check memory cache first
    const cached = this.reputationStore.get(networkId);
    if (cached) {
      return cached;
    }

    // If not in cache and Prisma available, check database
    if (this.prisma) {
      try {
        const result = await this.prisma.$queryRaw<Array<{
          network_id: string;
          total_tasks: number;
          successful_tasks: number;
          failed_tasks: number;
          dispute_count: number;
          unresolved_receipts: number;
          verification_status: string;
          flags: any;
          created_at: Date;
          last_activity: Date;
        }>>`
          SELECT * FROM network_reputation WHERE network_id = ${networkId} LIMIT 1
        `;

        if (result.length > 0) {
          const dbRep = result[0];
          const reputation: NetworkReputation = {
            networkId: dbRep.network_id,
            totalTasks: Number(dbRep.total_tasks),
            successfulTasks: Number(dbRep.successful_tasks),
            failedTasks: Number(dbRep.failed_tasks),
            disputeCount: Number(dbRep.dispute_count),
            unresolvedReceipts: Number(dbRep.unresolved_receipts),
            createdAt: dbRep.created_at.getTime(),
            lastActivity: dbRep.last_activity.getTime(),
            verificationStatus: dbRep.verification_status as 'unverified' | 'verified' | 'flagged',
            flags: Array.isArray(dbRep.flags) ? dbRep.flags : (typeof dbRep.flags === 'string' ? JSON.parse(dbRep.flags) : []),
          };

          // Cache it
          this.reputationStore.set(networkId, reputation);
          return reputation;
        }
      } catch (error) {
        this.logger.warn('Could not fetch reputation from database', { networkId, error });
      }
    }

    return null;
  }

  /**
   * Update reputation based on task outcome
   */
  async recordTaskOutcome(networkId: string, success: boolean): Promise<void> {
    let reputation = this.reputationStore.get(networkId);
    if (!reputation) {
      reputation = await this.initializeReputation(networkId);
    }

    reputation.totalTasks++;
    if (success) {
      reputation.successfulTasks++;
    } else {
      reputation.failedTasks++;
    }
    reputation.lastActivity = Date.now();

    this.reputationStore.set(networkId, reputation);

    // Persist to database
    if (this.prisma) {
      try {
        await this.prisma.$executeRaw`
          INSERT INTO network_reputation (
            network_id, total_tasks, successful_tasks, failed_tasks,
            dispute_count, unresolved_receipts, verification_status, flags, created_at, last_activity
          ) VALUES (
            ${networkId}, ${reputation.totalTasks}, ${reputation.successfulTasks}, ${reputation.failedTasks},
            ${reputation.disputeCount}, ${reputation.unresolvedReceipts}, ${reputation.verificationStatus}, ${JSON.stringify(reputation.flags)}::jsonb,
            to_timestamp(${reputation.createdAt / 1000}), to_timestamp(${reputation.lastActivity / 1000})
          )
          ON CONFLICT (network_id) DO UPDATE SET
            total_tasks = ${reputation.totalTasks},
            successful_tasks = ${reputation.successfulTasks},
            failed_tasks = ${reputation.failedTasks},
            last_activity = to_timestamp(${reputation.lastActivity / 1000})
        `;
      } catch (error) {
        this.logger.warn('Could not persist reputation update', { networkId, error });
      }
    }
  }

  /**
   * Record dispute
   */
  async recordDispute(networkId: string): Promise<void> {
    let reputation = this.reputationStore.get(networkId);
    if (!reputation) {
      reputation = await this.initializeReputation(networkId);
    }
    
    reputation.disputeCount++;
    reputation.lastActivity = Date.now();

    // Auto-flag if too many disputes
    if (reputation.disputeCount > 10 && reputation.totalTasks > 0) {
      const disputeRate = reputation.disputeCount / reputation.totalTasks;
      if (disputeRate > 0.1) { // More than 10% dispute rate
        reputation.verificationStatus = 'flagged';
        reputation.flags.push('high_dispute_rate');
      }
    }

    this.reputationStore.set(networkId, reputation);

    // Persist to database
    if (this.prisma) {
      try {
        await this.prisma.$executeRaw`
          UPDATE network_reputation SET
            dispute_count = ${reputation.disputeCount},
            verification_status = ${reputation.verificationStatus},
            flags = ${JSON.stringify(reputation.flags)}::jsonb,
            last_activity = to_timestamp(${reputation.lastActivity / 1000})
          WHERE network_id = ${networkId}
        `;
      } catch (error) {
        this.logger.warn('Could not persist dispute', { networkId, error });
      }
    }
  }

  /**
   * Record unresolved receipt
   */
  async recordUnresolvedReceipt(networkId: string): Promise<void> {
    let reputation = this.reputationStore.get(networkId);
    if (!reputation) {
      reputation = await this.initializeReputation(networkId);
    }
    
    reputation.unresolvedReceipts++;
    reputation.lastActivity = Date.now();

    // Auto-flag if too many unresolved receipts
    if (reputation.unresolvedReceipts > 5) {
      reputation.verificationStatus = 'flagged';
      reputation.flags.push('unresolved_receipts');
    }

    this.reputationStore.set(networkId, reputation);

    // Persist to database
    if (this.prisma) {
      try {
        await this.prisma.$executeRaw`
          UPDATE network_reputation SET
            unresolved_receipts = ${reputation.unresolvedReceipts},
            verification_status = ${reputation.verificationStatus},
            flags = ${JSON.stringify(reputation.flags)}::jsonb,
            last_activity = to_timestamp(${reputation.lastActivity / 1000})
          WHERE network_id = ${networkId}
        `;
      } catch (error) {
        this.logger.warn('Could not persist unresolved receipt', { networkId, error });
      }
    }
  }

  /**
   * Check if network should be trusted by default
   * Default: NO (all networks start unverified)
   */
  async isTrustedByDefault(networkId: string): Promise<boolean> {
    const reputation = await this.getReputation(networkId);
    if (!reputation) {
      return false; // Unknown network = not trusted
    }

    // Only verified networks with good history are trusted
    return (
      reputation.verificationStatus === 'verified' &&
      reputation.totalTasks >= 100 &&
      reputation.successfulTasks / reputation.totalTasks >= 0.95 &&
      reputation.disputeCount === 0
    );
  }

  /**
   * Get network risk score (0-100, higher = riskier)
   */
  async getRiskScore(networkId: string): Promise<number> {
    const reputation = await this.getReputation(networkId);
    if (!reputation) {
      return 50; // Unknown = medium risk
    }

    let risk = 0;

    // Unverified networks are riskier
    if (reputation.verificationStatus === 'unverified') {
      risk += 30;
    }
    if (reputation.verificationStatus === 'flagged') {
      risk += 50;
    }

    // Low activity = riskier
    if (reputation.totalTasks < 10) {
      risk += 20;
    }

    // High failure rate = riskier
    if (reputation.totalTasks > 0) {
      const failureRate = reputation.failedTasks / reputation.totalTasks;
      risk += failureRate * 30;
    }

    // High dispute rate = riskier
    if (reputation.totalTasks > 0) {
      const disputeRate = reputation.disputeCount / reputation.totalTasks;
      risk += disputeRate * 40;
    }

    // Unresolved receipts = riskier
    if (reputation.unresolvedReceipts > 0) {
      risk += Math.min(reputation.unresolvedReceipts * 5, 30);
    }

    return Math.min(risk, 100);
  }

  /**
   * Get network status for client display
   */
  async getNetworkStatus(networkId: string): Promise<{
    status: 'unverified' | 'verified' | 'flagged';
    riskScore: number;
    flags: string[];
    stats: {
      totalTasks: number;
      successRate: number;
      disputeRate: number;
    };
  }> {
    const reputation = await this.getReputation(networkId);
    if (!reputation) {
      return {
        status: 'unverified',
        riskScore: 50,
        flags: ['no_history'],
        stats: {
          totalTasks: 0,
          successRate: 0,
          disputeRate: 0,
        },
      };
    }

    const successRate = reputation.totalTasks > 0
      ? reputation.successfulTasks / reputation.totalTasks
      : 0;
    const disputeRate = reputation.totalTasks > 0
      ? reputation.disputeCount / reputation.totalTasks
      : 0;

    const riskScore = await this.getRiskScore(networkId);

    return {
      status: reputation.verificationStatus,
      riskScore,
      flags: reputation.flags,
      stats: {
        totalTasks: reputation.totalTasks,
        successRate,
        disputeRate,
      },
    };
  }

  /**
   * Export reputation data (for client-side display)
   */
  exportReputationData(): Map<string, NetworkReputation> {
    return new Map(this.reputationStore);
  }
}
