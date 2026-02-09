/**
 * Creator Revenue Service
 * 
 * Tracks and manages creator earnings from:
 * - Creation fee rewards (one-time)
 * - Usage cuts (per-task, accumulated)
 * - Tokenomics (if token exists)
 * 
 * Protocol-level: All earnings are on-chain, this service queries and aggregates
 */

import { ILogger } from './utils/ILogger';
import { SupportedChain } from './types';
import { multiChainService } from '../services/chains/MultiChainService';
import { ethers } from 'ethers';
import { NetworkManifest } from './types';

export interface CreatorEarnings {
  networkId: string;
  creatorAddress: string;
  totalEarnings: string; // Total earnings in native token
  creationFeeReward: string; // One-time creation fee reward
  usageCutAccumulated: string; // Accumulated usage cuts from tasks
  usageCutPending: string; // Pending usage cuts (not yet withdrawn)
  tokenomicsValue?: string; // Token value if network has token
  lastUpdated: number; // Timestamp
}

export interface CreatorRevenueSummary {
  creatorAddress: string;
  totalNetworks: number;
  totalEarnings: string;
  totalCreationFeeRewards: string;
  totalUsageCuts: string;
  networks: CreatorEarnings[];
}

export class CreatorRevenueService {
  private logger: ILogger;
  private earningsCache: Map<string, CreatorEarnings> = new Map();

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('CreatorRevenueService');
  }

  /**
   * Get creator earnings for a specific network
   * Queries on-chain contract for usage cuts
   */
  async getNetworkEarnings(
    networkId: string,
    manifest: NetworkManifest,
    chain: SupportedChain
  ): Promise<CreatorEarnings> {
    try {
      const cacheKey = `${networkId}:${chain}`;
      const cached = this.earningsCache.get(cacheKey);
      if (cached && Date.now() - cached.lastUpdated < 60000) {
        // Cache valid for 1 minute
        return cached;
      }

      // Get creation fee reward (from manifest risk assessment)
      const creationFeeReward = manifest.riskAssessment?.requiredCosts.creatorReward || '0';

      // Get usage cut accumulated (from on-chain contract)
      let usageCutAccumulated = '0';
      let usageCutPending = '0';

      if (manifest.settlement.contractAddress && manifest.settlement.mode === 'escrow') {
        try {
          usageCutAccumulated = await this.getCreatorBalanceFromContract(
            manifest.settlement.contractAddress,
            manifest.creatorAddress,
            chain,
            manifest.settlement.tokenAddress
          );
          usageCutPending = usageCutAccumulated; // All accumulated is pending until withdrawn
        } catch (error) {
          this.logger.warn('Failed to query creator balance from contract', {
            networkId,
            contractAddress: manifest.settlement.contractAddress,
            error
          });
        }
      }

      // Calculate total earnings
      const totalEarnings = (
        parseFloat(creationFeeReward) + parseFloat(usageCutAccumulated)
      ).toString();

      const earnings: CreatorEarnings = {
        networkId,
        creatorAddress: manifest.creatorAddress,
        totalEarnings,
        creationFeeReward,
        usageCutAccumulated,
        usageCutPending,
        lastUpdated: Date.now(),
      };

      // Cache result
      this.earningsCache.set(cacheKey, earnings);

      return earnings;
    } catch (error) {
      this.logger.error('Failed to get network earnings', { networkId, error });
      throw error;
    }
  }

  /**
   * Get creator balance from escrow contract
   */
  private async getCreatorBalanceFromContract(
    contractAddress: string,
    creatorAddress: string,
    chain: SupportedChain,
    tokenAddress?: string
  ): Promise<string> {
    try {
      const chainService = multiChainService.getChain(chain);
      if (!chainService) {
        throw new Error(`Chain service not available for ${chain}`);
      }

      // Get RPC URL
      const rpcUrl = this.getRPCUrl(chain);
      if (!rpcUrl) {
        throw new Error(`RPC URL not configured for ${chain}`);
      }

      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Escrow contract ABI (minimal - just the function we need)
      const abi = [
        'function getCreatorBalance(address creator) external view returns (uint256)',
        'function creatorBalances(address) external view returns (uint256)'
      ];

      const contract = new ethers.Contract(contractAddress, abi, provider);

      // Try getCreatorBalance first, fallback to creatorBalances mapping
      let balance: bigint;
      try {
        balance = await contract.getCreatorBalance(creatorAddress);
      } catch {
        // Fallback to direct mapping access
        balance = await contract.creatorBalances(creatorAddress);
      }

      // Convert to ether (assuming 18 decimals)
      return ethers.formatEther(balance);
    } catch (error) {
      this.logger.error('Failed to get creator balance from contract', {
        contractAddress,
        creatorAddress,
        chain,
        error
      });
      return '0';
    }
  }

  /**
   * Get RPC URL for chain
   */
  private getRPCUrl(chain: SupportedChain): string | null {
    const envMap: Record<string, string> = {
      ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    };

    return envMap[chain] || null;
  }

  /**
   * Get all earnings for a creator across all their networks
   */
  async getCreatorRevenueSummary(
    creatorAddress: string,
    networks: Array<{ networkId: string; manifest: NetworkManifest }>
  ): Promise<CreatorRevenueSummary> {
    try {
      const creatorNetworks = networks.filter(n => n.manifest.creatorAddress.toLowerCase() === creatorAddress.toLowerCase());
      
      const earningsPromises = creatorNetworks.map(network =>
        this.getNetworkEarnings(
          network.networkId,
          network.manifest,
          network.manifest.settlement.chain
        )
      );

      const allEarnings = await Promise.all(earningsPromises);

      const totalEarnings = allEarnings.reduce((sum, e) => sum + parseFloat(e.totalEarnings), 0).toString();
      const totalCreationFeeRewards = allEarnings.reduce((sum, e) => sum + parseFloat(e.creationFeeReward), 0).toString();
      const totalUsageCuts = allEarnings.reduce((sum, e) => sum + parseFloat(e.usageCutAccumulated), 0).toString();

      return {
        creatorAddress,
        totalNetworks: creatorNetworks.length,
        totalEarnings,
        totalCreationFeeRewards,
        totalUsageCuts,
        networks: allEarnings,
      };
    } catch (error) {
      this.logger.error('Failed to get creator revenue summary', { creatorAddress, error });
      throw error;
    }
  }

  /**
   * Calculate estimated annual revenue
   * Based on current usage cut rate and historical task volume
   */
  async estimateAnnualRevenue(
    networkId: string,
    manifest: NetworkManifest,
    averageTaskValue: string,
    estimatedTasksPerMonth: number
  ): Promise<string> {
    try {
      if (!manifest.moneyFlow.usageCut.enabled) {
        return '0';
      }

      const taskValue = parseFloat(averageTaskValue);
      const usageCutPercent = manifest.moneyFlow.usageCut.percentage;
      const monthlyCut = (taskValue * usageCutPercent / 100) * estimatedTasksPerMonth;
      const annualRevenue = monthlyCut * 12;

      return annualRevenue.toString();
    } catch (error) {
      this.logger.error('Failed to estimate annual revenue', { networkId, error });
      return '0';
    }
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.earningsCache.clear();
  }
}
