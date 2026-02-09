/**
 * Task State IPFS Service
 * 
 * PHASE 6: Stores task state on IPFS and anchors on-chain
 * Task state includes: outputs, evaluations, consensus results
 */

import { ILogger } from './utils/ILogger';
import { TaskState } from './TaskService';
import { NetworkManifest } from './types';
import { ethers } from 'ethers';
import axios from 'axios';
import FormData from 'form-data';

export class TaskStateIPFSService {
  private logger: ILogger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('TaskStateIPFSService');
  }

  /**
   * Upload task state to IPFS
   * PHASE 6: Store complete task state on IPFS
   */
  async uploadTaskState(taskState: TaskState): Promise<string> {
    try {
      this.logger.info('Uploading task state to IPFS', { taskId: taskState.taskId });

      // Use public IPFS API
      const ipfsApiUrl = process.env.IPFS_API_URL || 'https://ipfs.io/api/v0';
      
      const formData = new FormData();
      const taskStateJson = JSON.stringify(taskState, null, 2);
      formData.append('file', Buffer.from(taskStateJson), {
        filename: `task-${taskState.taskId}.json`,
        contentType: 'application/json',
      });

      const response = await axios.post(
        `${ipfsApiUrl}/add`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
        }
      );

      const cid = response.data.Hash;
      this.logger.info('Task state uploaded to IPFS', { taskId: taskState.taskId, cid });

      return cid;
    } catch (error) {
      this.logger.error('Failed to upload task state to IPFS', { taskId: taskState.taskId, error });
      throw error;
    }
  }

  /**
   * Anchor task state on-chain (store IPFS CID hash in contract)
   * PHASE 6: Create on-chain anchor for IPFS task state
   */
  async anchorTaskStateOnChain(
    taskId: string,
    ipfsCid: string,
    manifest: NetworkManifest
  ): Promise<string> {
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

      // Convert IPFS CID to bytes32 hash (ethers v6)
      // IPFS CID is a multihash, we'll hash it to get bytes32
      const cidHash = ethers.keccak256(ethers.toUtf8Bytes(ipfsCid));
      const taskIdBytes32 = ethers.encodeBytes32String(taskId);

      // Load contract ABI
      const contractABI = [
        'function anchorTaskState(bytes32 taskId, bytes32 stateHash) external'
      ];

      // Note: This requires a signer (wallet) to call the contract
      // In production, this would be called by a validator or coordinator
      // For now, we'll return the transaction data for manual execution
      const contract = new ethers.Contract(contractAddress, contractABI, provider);
      
      this.logger.info('Task state anchor prepared', {
        taskId,
        ipfsCid,
        stateHash: cidHash,
        contractAddress
      });

      // Return the encoded function call data (ethers v6)
      const iface = new ethers.Interface(contractABI);
      const data = iface.encodeFunctionData('anchorTaskState', [taskIdBytes32, cidHash]);

      return data;
    } catch (error) {
      this.logger.error('Failed to prepare task state anchor', { taskId, error });
      throw error;
    }
  }

  /**
   * Get task state from IPFS
   */
  async getTaskStateFromIPFS(ipfsCid: string): Promise<TaskState | null> {
    try {
      const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
      const url = `${gateway}${ipfsCid}`;

      const response = await axios.get(url, {
        timeout: 10000,
      });

      const taskState = response.data as TaskState;
      this.logger.info('Task state fetched from IPFS', { ipfsCid, taskId: taskState.taskId });

      return taskState;
    } catch (error) {
      this.logger.error('Failed to fetch task state from IPFS', { ipfsCid, error });
      return null;
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
}

