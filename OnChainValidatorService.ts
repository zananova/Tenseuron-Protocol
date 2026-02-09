/**
 * On-Chain Validator Service
 * 
 * PHASE 3: Queries on-chain validator selection from EscrowContract
 * Validator selection happens on-chain when task is deposited
 */

import { ethers } from 'ethers';
import { ILogger } from './utils/ILogger';
import { NetworkManifest } from './types';

export interface OnChainValidator {
  address: string;
  stake: string;
  reputation: number;
}

export class OnChainValidatorService {
  private logger: ILogger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('OnChainValidatorService');
  }

  /**
   * Get selected validators for a task from on-chain contract
   * PHASE 3: Validator selection is done on-chain during deposit
   */
  async getSelectedValidators(
    taskId: string,
    manifest: NetworkManifest
  ): Promise<string[]> {
    try {
      const contractAddress = manifest.settlement.contractAddress;
      if (!contractAddress) {
        throw new Error('Contract address not found in manifest');
      }

      // Get provider for the settlement chain
      const provider = this.getProvider(manifest.settlement.chain);
      if (!provider) {
        throw new Error(`Provider not available for chain: ${manifest.settlement.chain}`);
      }

      // Load contract ABI (minimal ABI for getSelectedValidators)
      const contractABI = [
        'function getSelectedValidators(bytes32 taskId) external view returns (address[] memory)'
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);
      
      // Convert taskId to bytes32 (ethers v6)
      const taskIdBytes32 = ethers.encodeBytes32String(taskId);
      
      // Query on-chain selected validators
      const selectedValidators = await contract.getSelectedValidators(taskIdBytes32);
      
      this.logger.info('Retrieved on-chain selected validators', {
        taskId,
        networkId: manifest.networkId,
        validatorCount: selectedValidators.length
      });

      return selectedValidators;
    } catch (error) {
      this.logger.error('Failed to get on-chain selected validators', { taskId, error });
      throw error;
    }
  }

  /**
   * Get validator info from on-chain registry
   */
  async getValidatorInfo(
    validatorAddress: string,
    manifest: NetworkManifest
  ): Promise<OnChainValidator | null> {
    try {
      const contractAddress = manifest.settlement.contractAddress;
      if (!contractAddress) {
        return null;
      }

      const provider = this.getProvider(manifest.settlement.chain);
      if (!provider) {
        return null;
      }

      // Contract ABI for validator queries
      const contractABI = [
        'function validatorStakes(address) external view returns (uint256)',
        'function validatorReputation(address) external view returns (uint256)'
      ];

      const contract = new ethers.Contract(contractAddress, contractABI, provider);
      
      const [stake, reputation] = await Promise.all([
        contract.validatorStakes(validatorAddress),
        contract.validatorReputation(validatorAddress)
      ]);

      return {
        address: validatorAddress,
        stake: stake.toString(),
        reputation: reputation.toNumber()
      };
    } catch (error) {
      this.logger.error('Failed to get validator info', { validatorAddress, error });
      return null;
    }
  }

  /**
   * Get total number of validators in network
   * SCALABLE: Used to determine if network is large (many validators) or small (few validators)
   */
  async getTotalValidatorCount(manifest: NetworkManifest): Promise<number> {
    try {
      // Try ValidatorRegistry first
      if (manifest.settlement.validatorRegistryAddress) {
        const provider = this.getProvider(manifest.settlement.chain);
        if (provider) {
          const registryABI = [
            'function getValidatorCount() external view returns (uint256)',
            'function validatorList(uint256) external view returns (address)'
          ];
          const registry = new ethers.Contract(
            manifest.settlement.validatorRegistryAddress,
            registryABI,
            provider
          );
          
          try {
            const count = await registry.getValidatorCount();
            return count.toNumber();
          } catch {
            // Fallback: count active validators
            let count = 0;
            while (true) {
              try {
                const addr = await registry.validatorList(count);
                if (addr === ethers.ZeroAddress) break; // ethers v6: ZeroAddress instead of constants.AddressZero
                count++;
              } catch {
                break;
              }
            }
            return count;
          }
        }
      }
      
      // Fallback: Check EscrowContract
      if (manifest.settlement.contractAddress) {
        const provider = this.getProvider(manifest.settlement.chain);
        if (provider) {
          const contractABI = [
            'function getValidatorCount() external view returns (uint256)'
          ];
          const contract = new ethers.Contract(
            manifest.settlement.contractAddress,
            contractABI,
            provider
          );
          
          try {
            const count = await contract.getValidatorCount();
            return count.toNumber();
          } catch {
            return 0; // Unknown
          }
        }
      }
      
      return 0; // Unknown
    } catch (error) {
      this.logger.error('Failed to get total validator count', { error });
      return 0;
    }
  }

  /**
   * Get provider for a chain
   * ethers v6: providers.JsonRpcProvider → JsonRpcProvider
   */
  private getProvider(chain: string): ethers.JsonRpcProvider | null {
    // Get RPC URL from environment or use defaults
    const rpcUrls: Record<string, string> = {
      ethereum: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      polygon: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
      bsc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      arbitrum: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      base: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
      solana: '', // Solana uses different provider
      tron: '' // Tron uses different provider
    };

    const rpcUrl = rpcUrls[chain.toLowerCase()];
    if (!rpcUrl) {
      this.logger.warn(`No RPC URL configured for chain: ${chain}`);
      return null;
    }

    try {
      return new ethers.JsonRpcProvider(rpcUrl); // ethers v6: direct JsonRpcProvider
    } catch (error) {
      this.logger.error(`Failed to create provider for chain: ${chain}`, { error });
      return null;
    }
  }
}

