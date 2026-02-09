/**
 * Settlement Service
 * 
 * Handles deployment of settlement contracts (Mode A: Escrow)
 * Supports multiple blockchains via chain adapters
 */

import { ILogger } from './utils/ILogger';
import { SupportedChain } from './types';
import { multiChainService } from '../services/chains/MultiChainService';
import { ContractCompiler } from './contracts/ContractCompiler';
import { ContractDeployer } from './contracts/ContractDeployer';
import { TokenTemplates } from './contracts/TokenTemplates';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

export interface EscrowDeploymentParams {
  networkId: string;
  chain: SupportedChain;
  disputeWindow: number;
  minValidators: number;
  consensusThreshold: number;
  networkToken?: string; // Token address if using network token
  validatorRegistry?: string; // Validator registry contract address
  challengeOracle?: string; // Optional oracle address (0x0 = validator consensus)
  // Money Flow Configuration (Protocol-Level)
  creatorAddress: string;
  purposeBoundSinks?: string; // Purpose-bound sinks address (0x0 = burn, no accumulation)
  usageCutEnabled: boolean;
  usageCutPercentage: number; // Basis points (e.g., 500 = 5%)
  usageCutMin: string; // Minimum cut per task
  usageCutMax: string; // Maximum cut per task
  // Validator Payment Configuration (CRITICAL: Validators must be paid)
  validatorPaymentEnabled: boolean;
  validatorPaymentPercentage: number; // Basis points (e.g., 1000 = 10%)
  validatorPaymentMin: string; // Minimum payment per validator
  validatorPaymentMax: string; // Maximum payment per validator
  // Penalty Configuration (IMMUTABLE - Protocol-Level Anti-Cheat)
  penaltyConfig: {
    mechanism: 'slashing' | 'reputation-only' | 'temporary-ban' | 'warning-system' | 'hybrid' | 'none';
    slashing?: {
      enabled: boolean;
      rate: number;
      minStakeRequired: string;
      cooldownPeriod: number;
    };
    reputation?: {
      enabled: boolean;
      penaltyPerOffense: number;
      minReputationForBan: number;
      recoveryRate: number;
    };
    temporaryBan?: {
      enabled: boolean;
      banDuration: number;
      offensesBeforeBan: number;
      escalationFactor: number;
    };
    warningSystem?: {
      enabled: boolean;
      warningsBeforeAction: number;
      warningExpiry: number;
      actionAfterWarnings: 'reputation' | 'ban' | 'slash';
    };
  };
}

export interface TokenDeploymentParams {
  networkId: string;
  chain: SupportedChain;
  token: {
    name: string;
    symbol: string;
    totalSupply: string;
    design: 'burn-on-use' | 'earn-only' | 'decay' | 'stake-required';
    params: object;
  };
}

export class SettlementService {
  private logger: ILogger;
  private compiler: ContractCompiler;
  private deployer: ContractDeployer;

  constructor(logger: ILogger) {
    this.logger = logger;
    this.compiler = new ContractCompiler(logger);
    this.deployer = new ContractDeployer(logger);
  }

  /**
   * Deploy escrow contract (Mode A settlement)
   */
  async deployEscrowContract(params: EscrowDeploymentParams): Promise<string> {
    try {
      this.logger.info('Deploying escrow contract', { 
        networkId: params.networkId, 
        chain: params.chain 
      });

      // Check if chain is EVM-compatible
      const evmChains: SupportedChain[] = ['ethereum', 'polygon', 'bsc', 'arbitrum', 'base', 'avalanche'];
      if (!evmChains.includes(params.chain)) {
        throw new Error(`Escrow contracts only supported on EVM chains. ${params.chain} is not EVM-compatible.`);
      }

      // Get deployer private key from environment
      const deployerPrivateKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY;
      if (!deployerPrivateKey) {
        throw new Error('CONTRACT_DEPLOYER_PRIVATE_KEY environment variable is required for contract deployment');
      }

      // Read contract source
      const contractPath = join(__dirname, 'contracts', 'EscrowContract.sol');
      const contractSource = readFileSync(contractPath, 'utf-8');

      // Compile contract
      this.logger.info('Compiling escrow contract');
      const compiled = await this.compiler.compileContract('TenseuronEscrow', contractSource);

      // Prepare constructor arguments
      const networkToken = params.networkToken || '0x0000000000000000000000000000000000000000';
      const validatorRegistry = params.validatorRegistry || '0x0000000000000000000000000000000000000000';
      const challengeOracle = params.challengeOracle || '0x0000000000000000000000000000000000000000'; // 0x0 = validator consensus (default)
      const purposeBoundSinks = params.purposeBoundSinks || '0x0000000000000000000000000000000000000000'; // 0x0 = burn
      
      // Convert usage cut to basis points and wei
      const usageCutPercentage = params.usageCutPercentage; // Already in basis points (e.g., 500 = 5%)
      const usageCutMin = ethers.parseEther(params.usageCutMin).toString();
      const usageCutMax = ethers.parseEther(params.usageCutMax).toString();
      
      // Convert validator payment to basis points and wei (CRITICAL FIX)
      const validatorPaymentPercentage = params.validatorPaymentPercentage; // Already in basis points (e.g., 1000 = 10%)
      const validatorPaymentMin = ethers.parseEther(params.validatorPaymentMin).toString();
      const validatorPaymentMax = ethers.parseEther(params.validatorPaymentMax).toString();
      
      // Map penalty mechanism to Solidity enum
      // PenaltyMechanism enum: NONE=0, SLASHING=1, REPUTATION_ONLY=2, TEMPORARY_BAN=3, WARNING_SYSTEM=4, HYBRID=5
      const penaltyMechanismMap: Record<string, number> = {
        'none': 0,
        'slashing': 1,
        'reputation-only': 2,
        'temporary-ban': 3,
        'warning-system': 4,
        'hybrid': 5
      };
      
      // Map warning action to Solidity enum
      // WarningAction enum: REPUTATION=0, BAN=1, SLASH=2
      const warningActionMap: Record<string, number> = {
        'reputation': 0,
        'ban': 1,
        'slash': 2
      };
      
      const penaltyConfig = params.penaltyConfig;
      const mechanism = penaltyMechanismMap[penaltyConfig.mechanism] ?? 0;
      
      // Extract penalty parameters with defaults
      const slashing = penaltyConfig.slashing || { enabled: false, rate: 0, minStakeRequired: '0', cooldownPeriod: 604800 };
      const reputation = penaltyConfig.reputation || { enabled: false, penaltyPerOffense: 10, minReputationForBan: 20, recoveryRate: 1 };
      const temporaryBan = penaltyConfig.temporaryBan || { enabled: false, banDuration: 604800, offensesBeforeBan: 3, escalationFactor: 2 };
      const warningSystem = penaltyConfig.warningSystem || { enabled: false, warningsBeforeAction: 3, warningExpiry: 2592000, actionAfterWarnings: 'reputation' };
      
      const constructorArgs = [
        params.networkId,
        networkToken,
        validatorRegistry,
        challengeOracle,
        params.disputeWindow,
        params.minValidators,
        params.consensusThreshold,
        params.creatorAddress,
        purposeBoundSinks,
        params.usageCutEnabled,
        usageCutPercentage,
        usageCutMin,
        usageCutMax,
        params.validatorPaymentEnabled,
        validatorPaymentPercentage,
        validatorPaymentMin,
        validatorPaymentMax,
        // Penalty Configuration (IMMUTABLE)
        mechanism,
        slashing.enabled,
        slashing.rate,
        ethers.parseEther(slashing.minStakeRequired || '0').toString(),
        slashing.cooldownPeriod || 604800,
        reputation.enabled,
        reputation.penaltyPerOffense,
        reputation.minReputationForBan,
        Math.round((reputation.recoveryRate || 0.01) * 10000), // Convert to basis points
        temporaryBan.enabled,
        temporaryBan.banDuration,
        temporaryBan.offensesBeforeBan,
        Math.round((temporaryBan.escalationFactor || 2) * 10000), // Convert to basis points
        warningSystem.enabled,
        warningSystem.warningsBeforeAction,
        warningSystem.warningExpiry,
        warningActionMap[warningSystem.actionAfterWarnings] ?? 0,
      ];

      // Deploy contract
      this.logger.info('Deploying escrow contract to chain', { chain: params.chain });
      const deployment = await this.deployer.deployToEVM(
        params.chain,
        compiled,
        constructorArgs,
        deployerPrivateKey
      );

      this.logger.info('Escrow contract deployed successfully', {
        contractAddress: deployment.contractAddress,
        txHash: deployment.txHash,
        explorerUrl: deployment.explorerUrl,
      });

      return deployment.contractAddress;
    } catch (error) {
      this.logger.error('Failed to deploy escrow contract', error);
      throw error;
    }
  }

  /**
   * Deploy creator token vesting contract
   */
  async deployCreatorTokenVesting(params: {
    networkId: string;
    creator: string;
    networkToken: string;
    vestedAmount: string;
    chain: SupportedChain;
    graduationOracle: string;
  }): Promise<string> {
    try {
      this.logger.info('Deploying creator token vesting contract', { 
        networkId: params.networkId, 
        chain: params.chain,
        creator: params.creator
      });

      // Check if chain is EVM-compatible
      const evmChains: SupportedChain[] = ['ethereum', 'polygon', 'bsc', 'arbitrum', 'base', 'avalanche'];
      if (!evmChains.includes(params.chain)) {
        throw new Error(`Vesting contracts only supported on EVM chains. ${params.chain} is not EVM-compatible.`);
      }

      // Get deployer private key from environment
      const deployerPrivateKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY;
      if (!deployerPrivateKey) {
        throw new Error('CONTRACT_DEPLOYER_PRIVATE_KEY environment variable is required for contract deployment');
      }

      // Read vesting contract source
      const vestingContractPath = join(__dirname, 'contracts', 'CreatorTokenVesting.sol');
      const vestingContractSource = readFileSync(vestingContractPath, 'utf-8');

      // Compile contract
      this.logger.info('Compiling vesting contract');
      const compiled = await this.compiler.compileContract('CreatorTokenVesting', vestingContractSource);

      // Prepare constructor arguments
      // Note: vestedAmount should already be in token units (not wei)
      // For ERC20 tokens, we use the token's decimals (assume 18 for standard tokens)
      const vestedAmountWei = ethers.parseUnits(params.vestedAmount, 18);
      const constructorArgs = [
        params.networkId,
        params.creator,
        params.networkToken,
        vestedAmountWei,
        params.graduationOracle
      ];

      // Deploy contract
      this.logger.info('Deploying vesting contract to chain', { chain: params.chain });
      const deployment = await this.deployer.deployToEVM(
        params.chain,
        compiled,
        constructorArgs,
        deployerPrivateKey
      );

      this.logger.info('Vesting contract deployed successfully', {
        contractAddress: deployment.contractAddress,
        txHash: deployment.txHash,
        explorerUrl: deployment.explorerUrl,
      });

      return deployment.contractAddress;
    } catch (error) {
      this.logger.error('Failed to deploy vesting contract', error);
      throw error;
    }
  }

  /**
   * Deploy network token
   */
  async deployNetworkToken(params: TokenDeploymentParams): Promise<string> {
    try {
      this.logger.info('Deploying network token', { 
        networkId: params.networkId, 
        chain: params.chain,
        symbol: params.token.symbol
      });

      // Check if chain is EVM-compatible
      const evmChains: SupportedChain[] = ['ethereum', 'polygon', 'bsc', 'arbitrum', 'base', 'avalanche'];
      if (!evmChains.includes(params.chain)) {
        throw new Error(`Token contracts only supported on EVM chains. ${params.chain} is not EVM-compatible.`);
      }

      // Get deployer private key from environment
      const deployerPrivateKey = process.env.CONTRACT_DEPLOYER_PRIVATE_KEY;
      if (!deployerPrivateKey) {
        throw new Error('CONTRACT_DEPLOYER_PRIVATE_KEY environment variable is required for contract deployment');
      }

      // Generate token contract source based on design
      let contractSource: string;
      const contractName = params.token.name.replace(/\s+/g, '');
      
      // For earn-only tokens, we need escrow address from params
      // This should be passed when escrow is deployed first
      let escrowAddress = (params.token.params as any).escrowAddress || '0x0000000000000000000000000000000000000000';
      
      switch (params.token.design) {
        case 'burn-on-use':
          const burnAmount = (params.token.params as any).burnAmount || '1';
          contractSource = TokenTemplates.generateBurnOnUseToken(
            params.token.name,
            params.token.symbol,
            params.token.totalSupply,
            burnAmount
          );
          break;
          
        case 'earn-only':
          // For earn-only, we need the escrow contract address
          // If escrow exists, use it; otherwise deploy with zero (network must update)
          contractSource = TokenTemplates.generateEarnOnlyToken(
            params.token.name,
            params.token.symbol,
            params.token.totalSupply
          );
          break;
          
        case 'decay':
          const decayRate = (params.token.params as any).decayRate || '100'; // 1% in basis points
          const decayPeriod = (params.token.params as any).decayPeriod || 2592000; // 30 days in seconds
          contractSource = TokenTemplates.generateDecayToken(
            params.token.name,
            params.token.symbol,
            params.token.totalSupply,
            decayRate,
            decayPeriod
          );
          break;
          
        case 'stake-required':
          const minStake = (params.token.params as any).minStake || '100';
          contractSource = TokenTemplates.generateStakeRequiredToken(
            params.token.name,
            params.token.symbol,
            params.token.totalSupply,
            minStake
          );
          break;
          
        default:
          throw new Error(`Unknown token design: ${params.token.design}`);
      }

      // Compile contract
      this.logger.info('Compiling token contract');
      const compiled = await this.compiler.compileContract(contractName, contractSource);

      // Prepare constructor arguments
      let constructorArgs: any[] = [];
      if (params.token.design === 'earn-only') {
        // For earn-only, constructor needs network contract address (escrow)
        if (escrowAddress === '0x0000000000000000000000000000000000000000') {
          throw new Error('Earn-only token requires escrow address in constructor');
        }
        constructorArgs = [escrowAddress];
      }

      // Deploy contract
      this.logger.info('Deploying token contract to chain', { chain: params.chain });
      const deployment = await this.deployer.deployToEVM(
        params.chain,
        compiled,
        constructorArgs,
        deployerPrivateKey
      );

      this.logger.info('Token contract deployed successfully', {
        contractAddress: deployment.contractAddress,
        txHash: deployment.txHash,
        explorerUrl: deployment.explorerUrl,
      });

      return deployment.contractAddress;
    } catch (error) {
      this.logger.error('Failed to deploy network token', error);
      throw error;
    }
  }

  /**
   * Verify contract deployment
   */
  async verifyContract(chain: SupportedChain, contractAddress: string): Promise<boolean> {
    try {
      const chainService = multiChainService.getChain(chain);
      if (!chainService) {
        return false;
      }

      // For EVM chains, check if contract code exists at address
      const evmChains: SupportedChain[] = ['ethereum', 'polygon', 'bsc', 'arbitrum', 'base', 'avalanche'];
      if (evmChains.includes(chain)) {
        const rpcUrl = this.getRPCUrl(chain);
        if (!rpcUrl) {
          return false;
        }

        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const code = await provider.getCode(contractAddress);
        
        // Contract exists if code is not empty and not '0x'
        return code !== '0x' && code.length > 2;
      }

      // For non-EVM chains, would need chain-specific verification
      this.logger.warn('Contract verification not implemented for non-EVM chain', { chain });
      return false;
    } catch (error) {
      this.logger.error('Failed to verify contract', error);
      return false;
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
}
