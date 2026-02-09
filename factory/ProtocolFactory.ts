/**
 * Protocol Factory
 * Creates configured ProtocolService instances with appropriate adapters
 */

import { RuntimeDetector, DatabaseType, StorageType, BlockchainType } from './RuntimeDetector';
import {
    INetworkRepository,
    IStorageProvider,
    IBlockchainProvider,
} from '../interfaces';
import {
    PrismaNetworkRepository,
    D1NetworkRepository,
} from '../adapters/database';
import {
    IPFSStorageProvider,
    CloudflareR2StorageProvider,
} from '../adapters/storage';
import { EthereumProvider } from '../adapters/blockchain';

export interface DatabaseConfig {
    type: DatabaseType;
    instance?: any; // PrismaClient | D1Database | SupabaseClient | MongoClient
}

export interface StorageConfig {
    type: StorageType;
    config?: any; // R2Bucket | IPFS config | S3 config
}

export interface BlockchainConfig {
    type: BlockchainType;
    rpcUrl?: string;
    privateKey?: string;
}

export interface ProtocolConfig {
    database?: DatabaseConfig;
    storage?: StorageConfig;
    blockchain?: BlockchainConfig;
    autoDetect?: boolean; // Default: true
}

export class ProtocolFactory {
    /**
     * Create a configured protocol instance
     */
    static create(config?: ProtocolConfig): {
        networkRepo: INetworkRepository;
        storage: IStorageProvider;
        blockchain: IBlockchainProvider;
    } {
        const autoDetect = config?.autoDetect !== false;

        // Create database repository
        const networkRepo = this.createDatabaseRepository(config?.database, autoDetect);

        // Create storage provider
        const storage = this.createStorageProvider(config?.storage, autoDetect);

        // Create blockchain provider
        const blockchain = this.createBlockchainProvider(config?.blockchain, autoDetect);

        return {
            networkRepo,
            storage,
            blockchain,
        };
    }

    private static createDatabaseRepository(
        config?: DatabaseConfig,
        autoDetect: boolean = true
    ): INetworkRepository {
        const dbType = config?.type || (autoDetect ? RuntimeDetector.getDefaultDatabase() : 'prisma');

        switch (dbType) {
            case 'prisma':
                if (!config?.instance) {
                    throw new Error('Prisma instance required for Prisma adapter');
                }
                return new PrismaNetworkRepository(config.instance);

            case 'd1':
                if (!config?.instance) {
                    throw new Error('D1 database instance required for D1 adapter');
                }
                return new D1NetworkRepository(config.instance);

            // Add more database types here
            default:
                throw new Error(`Unsupported database type: ${dbType}`);
        }
    }

    private static createStorageProvider(
        config?: StorageConfig,
        autoDetect: boolean = true
    ): IStorageProvider {
        const storageType = config?.type || (autoDetect ? RuntimeDetector.getDefaultStorage() : 'ipfs');

        switch (storageType) {
            case 'ipfs':
                return new IPFSStorageProvider(config?.config);

            case 'r2':
                if (!config?.config) {
                    throw new Error('R2 bucket required for R2 adapter');
                }
                return new CloudflareR2StorageProvider(config.config);

            // Add more storage types here
            default:
                throw new Error(`Unsupported storage type: ${storageType}`);
        }
    }

    private static createBlockchainProvider(
        config?: BlockchainConfig,
        autoDetect: boolean = true
    ): IBlockchainProvider {
        const blockchainType = config?.type || (autoDetect ? RuntimeDetector.getDefaultBlockchain() : 'polygon');
        const rpcUrl = config?.rpcUrl || this.getDefaultRpcUrl(blockchainType);
        const privateKey = config?.privateKey || '';

        if (!privateKey) {
            throw new Error('Private key required for blockchain provider');
        }

        switch (blockchainType) {
            case 'ethereum':
                return new EthereumProvider(rpcUrl, privateKey, 'ethereum');

            case 'polygon':
                return new EthereumProvider(rpcUrl, privateKey, 'polygon');

            case 'arbitrum':
                return new EthereumProvider(rpcUrl, privateKey, 'arbitrum');

            case 'optimism':
                return new EthereumProvider(rpcUrl, privateKey, 'optimism');

            case 'base':
                return new EthereumProvider(rpcUrl, privateKey, 'base');

            // Add Solana and other chains here
            default:
                throw new Error(`Unsupported blockchain type: ${blockchainType}`);
        }
    }

    private static getDefaultRpcUrl(chainType: BlockchainType): string {
        const rpcUrls: Record<string, string> = {
            ethereum: 'https://rpc.ankr.com/eth',
            polygon: 'https://rpc.ankr.com/polygon',
            arbitrum: 'https://rpc.ankr.com/arbitrum',
            optimism: 'https://rpc.ankr.com/optimism',
            base: 'https://rpc.ankr.com/base',
        };

        return rpcUrls[chainType] || rpcUrls.polygon;
    }

    /**
     * Get runtime recommendations
     */
    static getRecommendations() {
        return RuntimeDetector.getRecommendations();
    }
}
