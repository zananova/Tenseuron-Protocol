/**
 * Contract Deployer
 * 
 * Deploys compiled contracts to blockchains using MultiChainService
 */

import { ethers } from 'ethers';
import { ILogger } from '../utils/ILogger';
import { SupportedChain } from '../types';
import { multiChainService } from '../../services/chains/MultiChainService';
import { CompiledContract } from './ContractCompiler';

export interface DeploymentResult {
  contractAddress: string;
  txHash: string;
  blockNumber?: number;
  explorerUrl?: string;
}

export class ContractDeployer {
  private logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  /**
   * Deploy contract to EVM chain
   */
  async deployToEVM(
    chain: SupportedChain,
    compiledContract: CompiledContract,
    constructorArgs: any[],
    deployerPrivateKey: string
  ): Promise<DeploymentResult> {
    try {
      this.logger.info('Deploying contract to EVM chain', { 
        chain, 
        contractName: compiledContract.contractName 
      });

      const chainService = multiChainService.getChain(chain);
      if (!chainService) {
        throw new Error(`Chain service not available for ${chain}`);
      }

      // Get provider from chain service
      // For EVM chains, we need to access the provider
      const provider = await this.getEVMProvider(chain);
      if (!provider) {
        throw new Error(`Provider not available for ${chain}`);
      }

      // Create wallet from private key
      const wallet = new ethers.Wallet(deployerPrivateKey, provider);

      // Create contract factory
      const factory = new ethers.ContractFactory(
        compiledContract.abi,
        compiledContract.bytecode,
        wallet
      );

      // Deploy contract
      this.logger.info('Sending deployment transaction', { chain });
      const contract = await factory.deploy(...constructorArgs);
      
      // Wait for deployment
      this.logger.info('Waiting for contract deployment', { 
        txHash: contract.deploymentTransaction()?.hash 
      });
      await contract.waitForDeployment();

      const contractAddress = await contract.getAddress();
      const txHash = contract.deploymentTransaction()?.hash || '';

      this.logger.info('Contract deployed successfully', { 
        chain,
        contractAddress,
        txHash
      });

      return {
        contractAddress,
        txHash,
        blockNumber: contract.deploymentTransaction()?.blockNumber,
        explorerUrl: this.getExplorerUrl(chain, txHash),
      };
    } catch (error) {
      this.logger.error('Contract deployment failed', error);
      throw new Error(`Failed to deploy contract: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get EVM provider from chain service
   */
  private async getEVMProvider(chain: SupportedChain): Promise<ethers.Provider | null> {
    try {
      // Access the internal provider from chain service
      // This is a workaround - in production, chain services should expose getProvider()
      const chainService = multiChainService.getChain(chain);
      if (!chainService) {
        return null;
      }

      // For EVM chains, we'll create a provider directly from RPC URL
      // This matches how EVMChainService works
      const rpcUrl = this.getRPCUrl(chain);
      if (!rpcUrl) {
        return null;
      }

      return new ethers.JsonRpcProvider(rpcUrl);
    } catch (error) {
      this.logger.error('Failed to get EVM provider', error);
      return null;
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
   * Get explorer URL for transaction
   */
  private getExplorerUrl(chain: SupportedChain, txHash: string): string {
    const explorerMap: Record<string, string> = {
      ethereum: `https://etherscan.io/tx/${txHash}`,
      polygon: `https://polygonscan.com/tx/${txHash}`,
      bsc: `https://bscscan.com/tx/${txHash}`,
      arbitrum: `https://arbiscan.io/tx/${txHash}`,
      base: `https://basescan.org/tx/${txHash}`,
      avalanche: `https://snowtrace.io/tx/${txHash}`,
    };

    return explorerMap[chain] || `#${txHash}`;
  }
}
