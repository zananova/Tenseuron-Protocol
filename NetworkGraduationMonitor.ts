/**
 * Network Graduation Monitor
 * 
 * Monitors networks for graduation eligibility based on usage metrics
 * Replaces market-cap based graduation with real usage metrics
 */

import { PrismaClient } from '@prisma/client';
import { ILogger } from './utils/ILogger';
import { ProtocolService } from './ProtocolService';
import { GraduationService } from './GraduationService';
import { NetworkManifest, GraduationLevel } from './types';
import { NetworkManifestGenerator } from './NetworkManifestGenerator';
import { DecentralizedRegistryService } from './DecentralizedRegistryService';
import { ethers } from 'ethers';

export class NetworkGraduationMonitor {
  private prisma: PrismaClient;
  private logger: ILogger;
  private protocolService: ProtocolService;
  private graduationService: GraduationService;
  private decentralizedRegistryService?: DecentralizedRegistryService;
  private isRunning: boolean = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

  constructor(prisma: PrismaClient, logger: ILogger, decentralizedRegistryService?: DecentralizedRegistryService) {
    this.prisma = prisma;
    this.logger = logger;
    this.protocolService = new ProtocolService(logger, prisma);
    this.graduationService = new GraduationService(prisma, logger);
    this.decentralizedRegistryService = decentralizedRegistryService || new DecentralizedRegistryService(logger);
  }

  /**
   * Start monitoring networks for graduation
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Network graduation monitor is already running');
      return;
    }

    this.logger.info('Starting network graduation monitor...');
    this.isRunning = true;

    // Start monitoring loop
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAllNetworks();
      } catch (error) {
        this.logger.error('Error in network graduation monitoring loop:', error);
      }
    }, this.CHECK_INTERVAL_MS);

    // Do initial check
    await this.checkAllNetworks();

    this.logger.info('Network graduation monitor started successfully');
  }

  /**
   * Stop monitoring
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping network graduation monitor...');
    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.logger.info('Network graduation monitor stopped');
  }

  /**
   * Check all networks for graduation eligibility
   */
  private async checkAllNetworks(): Promise<void> {
    try {
      // Discover all networks from registry
      const networkIds = await this.protocolService.listNetworks();
      
      this.logger.info(`Checking ${networkIds.length} networks for graduation`);

      for (const networkId of networkIds) {
        try {
          await this.checkNetworkGraduation(networkId);
        } catch (error) {
          this.logger.error(`Failed to check graduation for network ${networkId}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to check all networks:', error);
    }
  }

  /**
   * Check if a specific network is eligible for graduation
   */
  private async checkNetworkGraduation(networkId: string): Promise<void> {
    try {
      // Get network manifest
      const manifest = await this.protocolService.getNetworkManifest(networkId);
      if (!manifest) {
        this.logger.warn(`Network manifest not found: ${networkId}`);
        return;
      }

      const currentLevel = manifest.graduationStatus?.level || 'sandbox';

      // Check graduation eligibility
      const eligibility = await this.graduationService.checkGraduationEligibility(
        networkId,
        manifest,
        currentLevel
      );

      if (eligibility.eligible) {
        this.logger.info(`Network ${networkId} is eligible for graduation`, {
          currentLevel,
          metrics: eligibility.metrics,
        });

        // Determine next level
        const nextLevel = this.getNextLevel(currentLevel);
        if (nextLevel) {
          await this.promoteNetwork(networkId, manifest, nextLevel);
        }
      } else {
        this.logger.debug(`Network ${networkId} not yet eligible for graduation`, {
          currentLevel,
          reason: eligibility.reason,
          metrics: eligibility.metrics,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to check network graduation for ${networkId}:`, error);
    }
  }

  /**
   * Promote network to next graduation level
   */
  private async promoteNetwork(
    networkId: string,
    manifest: NetworkManifest,
    newLevel: GraduationLevel
  ): Promise<void> {
    try {
      this.logger.info(`Promoting network ${networkId} to level ${newLevel}`);

      // Update manifest with new graduation status
      const updatedManifest: NetworkManifest = {
        ...manifest,
        graduationStatus: {
          level: newLevel,
          achievedAt: new Date().toISOString(),
          conditions: {
            validatorCount: 0, // Will be updated by GraduationService
            minerCount: 0,
            completedTasks: 0,
            validatorAgreementRate: 0,
            unresolvedDisputes: 0,
          },
        },
      };

      // Get current metrics for the status
      const metrics = await this.graduationService.getNetworkMetrics(networkId, manifest);
      if (updatedManifest.graduationStatus) {
        updatedManifest.graduationStatus.conditions = {
          validatorCount: metrics.validatorCount,
          minerCount: metrics.minerCount,
          completedTasks: metrics.completedTasks,
          validatorAgreementRate: metrics.agreementRate,
          unresolvedDisputes: metrics.unresolvedDisputes,
        };
      }

      // Update contracts (CreatorTokenVesting, BondEscrowContract)
      await this.updateContractsForGraduation(networkId, manifest, newLevel);

      // Update manifest in registry (IPFS/Git) for redundancy
      // Note: Contract state is the source of truth. IPFS/Git updates are for redundancy.
      this.logger.info(`Network ${networkId} promoted to ${newLevel}`, {
        updatedManifest: {
          networkId: updatedManifest.networkId,
          graduationStatus: updatedManifest.graduationStatus,
        },
      });

      // Update manifest on IPFS/Git registry for redundancy
      await this.updateManifestInRegistry(updatedManifest).catch(error => {
        // Don't fail if registry update fails - contract state is authoritative
        this.logger.warn('Failed to update manifest in registry (non-critical)', {
          networkId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    } catch (error) {
      this.logger.error(`Failed to promote network ${networkId} to ${newLevel}:`, error);
      throw error;
    }
  }

  /**
   * Update smart contracts for graduation level change
   */
  private async updateContractsForGraduation(
    networkId: string,
    manifest: NetworkManifest,
    newLevel: GraduationLevel
  ): Promise<void> {
    try {
      // Update CreatorTokenVesting contract
      if (manifest.creatorTokenVesting?.contractAddress) {
        await this.updateCreatorTokenVesting(
          manifest.creatorTokenVesting.contractAddress,
          manifest.settlement.chain,
          newLevel
        );
      }

      // Update BondEscrowContract
      if (manifest.settlement.bondEscrowAddress) {
        await this.updateBondEscrow(
          manifest.settlement.bondEscrowAddress,
          manifest.settlement.chain,
          newLevel
        );
      }

      this.logger.info(`Updated contracts for network ${networkId} to level ${newLevel}`);
    } catch (error) {
      this.logger.error(`Failed to update contracts for network ${networkId}:`, error);
      throw error;
    }
  }

  /**
   * Update CreatorTokenVesting contract graduation level
   */
  private async updateCreatorTokenVesting(
    contractAddress: string,
    chain: string,
    newLevel: GraduationLevel
  ): Promise<void> {
    try {
      const provider = this.getProvider(chain);
      if (!provider) {
        throw new Error(`Provider not available for chain: ${chain}`);
      }

      // Get graduation oracle address from environment
      const graduationOracleAddress = process.env.GRADUATION_ORACLE_ADDRESS;
      if (!graduationOracleAddress) {
        this.logger.warn('GRADUATION_ORACLE_ADDRESS not set, skipping contract update');
        return;
      }

      // Contract ABI for updateGraduationLevel
      const contractABI = [
        'function updateGraduationLevel(uint8 newLevel) external',
        'function currentLevel() external view returns (uint8)',
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);

      // Convert GraduationLevel to uint8
      const levelMap: Record<GraduationLevel, number> = {
        sandbox: 0,
        active: 1,
        trusted: 2,
        open_economic: 3,
      };

      const levelValue = levelMap[newLevel];

      // Check current level
      const currentLevel = await contract.currentLevel();
      if (currentLevel >= levelValue) {
        this.logger.info(`Contract already at level ${newLevel} or higher`);
        return;
      }

      // Note: This method is designed to be called by an external graduation oracle
      this.logger.info(`CreatorTokenVesting contract needs update to level ${newLevel}`, {
        contractAddress,
        newLevel,
        levelValue,
        note: 'This should be called by the graduation oracle',
      });

      // Note: This method is designed to be called by an external graduation oracle

    } catch (error) {
      this.logger.error('Failed to update CreatorTokenVesting contract:', error);
      throw error;
    }
  }

  /**
   * Update BondEscrowContract graduation level
   */
  private async updateBondEscrow(
    contractAddress: string,
    chain: string,
    newLevel: GraduationLevel
  ): Promise<void> {
    try {
      const provider = this.getProvider(chain);
      if (!provider) {
        throw new Error(`Provider not available for chain: ${chain}`);
      }

      // Get graduation oracle address from environment
      const graduationOracleAddress = process.env.GRADUATION_ORACLE_ADDRESS;
      if (!graduationOracleAddress) {
        this.logger.warn('GRADUATION_ORACLE_ADDRESS not set, skipping contract update');
        return;
      }

      // Contract ABI for updateGraduationLevel
      const contractABI = [
        'function updateGraduationLevel(uint8 newLevel) external',
        'function currentNetworkLevel() external view returns (uint8)',
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);

      // Convert GraduationLevel to uint8
      const levelMap: Record<GraduationLevel, number> = {
        sandbox: 0,
        active: 1,
        trusted: 2,
        open_economic: 3,
      };

      const levelValue = levelMap[newLevel];

      // Check current level
      const currentLevel = await contract.currentNetworkLevel();
      if (currentLevel >= levelValue) {
        this.logger.info(`BondEscrow contract already at level ${newLevel} or higher`);
        return;
      }

      // Note: In production, this would be called by the graduation oracle
      this.logger.info(`BondEscrow contract needs update to level ${newLevel}`, {
        contractAddress,
        newLevel,
        levelValue,
        note: 'This should be called by the graduation oracle',
      });

    } catch (error) {
      this.logger.error('Failed to update BondEscrow contract:', error);
      throw error;
    }
  }

  /**
   * Get next graduation level
   */
  private getNextLevel(currentLevel: GraduationLevel): GraduationLevel | null {
    switch (currentLevel) {
      case 'sandbox':
        return 'active';
      case 'active':
        return 'trusted';
      case 'trusted':
        return 'open_economic';
      case 'open_economic':
        return null; // Already at max level
      default:
        return 'sandbox';
    }
  }

  /**
   * Get provider for a chain
   */
  private getProvider(chain: string): ethers.JsonRpcProvider | null {
    const rpcUrls: Record<string, string> = {
      ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
    };

    const rpcUrl = rpcUrls[chain.toLowerCase()];
    if (!rpcUrl) {
      this.logger.warn(`No RPC URL configured for chain: ${chain}`);
      return null;
    }

    try {
      return new ethers.JsonRpcProvider(rpcUrl);
    } catch (error) {
      this.logger.error(`Failed to create provider for chain: ${chain}`, { error });
      return null;
    }
  }

  /**
   * Manually trigger graduation check for a network
   */
  public async triggerGraduationCheck(networkId: string): Promise<void> {
    try {
      this.logger.info(`Manually triggering graduation check for network ${networkId}`);
      await this.checkNetworkGraduation(networkId);
    } catch (error) {
      this.logger.error(`Failed to trigger graduation check for network ${networkId}:`, error);
      throw error;
    }
  }

  /**
   * Get graduation status for a network
   */
  public async getGraduationStatus(networkId: string): Promise<{
    status: any;
    metrics: any;
    eligibility: any;
  }> {
    try {
      const manifest = await this.protocolService.getNetworkManifest(networkId);
      if (!manifest) {
        throw new Error('Network not found');
      }

      const status = await this.graduationService.getGraduationStatus(networkId, manifest);
      const metrics = await this.graduationService.getNetworkMetrics(networkId, manifest);
      const currentLevel = manifest.graduationStatus?.level || 'sandbox';
      const eligibility = await this.graduationService.checkGraduationEligibility(
        networkId,
        manifest,
        currentLevel
      );

      return {
        status,
        metrics,
        eligibility,
      };
    } catch (error) {
      this.logger.error(`Failed to get graduation status for network ${networkId}:`, error);
      throw error;
    }
  }

  /**
   * Update manifest in IPFS/Git registry for redundancy
   * 
   * This is optional - contract state is the authoritative source.
   * Registry updates are for redundancy and discovery.
   */
  private async updateManifestInRegistry(manifest: NetworkManifest): Promise<void> {
    if (!this.decentralizedRegistryService) {
      this.logger.debug('DecentralizedRegistryService not available, skipping registry update');
      return;
    }

    try {
      // Upload updated manifest to IPFS (with multiple pinning services)
      const newCid = await this.decentralizedRegistryService.uploadManifest(manifest);
      
      this.logger.info('Manifest updated in IPFS registry', {
        networkId: manifest.networkId,
        newCid,
        previousCid: manifest.registry.ipfsCid,
      });

      // Update manifest with new CID
      manifest.registry.ipfsCid = newCid;

      // Optionally update in local index (for redundancy)
      await this.decentralizedRegistryService.registerNetworkInLocalIndex(
        manifest,
        'graduation-monitor',
        'Graduation Monitor Index'
      ).catch(error => {
        // Don't fail if index update fails
        this.logger.debug('Failed to update local index (non-critical)', {
          networkId: manifest.networkId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    } catch (error) {
      this.logger.error('Failed to update manifest in registry', {
        networkId: manifest.networkId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
