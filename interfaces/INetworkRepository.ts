/**
 * Network Repository Interface
 * Database-agnostic interface for network data operations
 */

export interface NetworkData {
    networkId: string;
    name: string;
    description: string;
    category: string;
    creatorAddress: string;
    manifestCid?: string;
    contractAddress?: string;
    validatorRegistryAddress?: string;
    settlementChain?: string;
    status: 'pending' | 'deploying' | 'deployed' | 'active' | 'graduated' | 'failed';
    moduleId?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface INetworkRepository {
    /**
     * Create a new network record
     */
    create(data: NetworkData): Promise<NetworkData>;

    /**
     * Find network by ID
     */
    findById(id: string): Promise<NetworkData | null>;

    /**
     * Find networks by creator address
     */
    findByCreator(creatorAddress: string): Promise<NetworkData[]>;

    /**
     * Update network data
     */
    update(id: string, data: Partial<NetworkData>): Promise<NetworkData>;

    /**
     * Delete network
     */
    delete(id: string): Promise<void>;

    /**
     * List networks with optional filters
     */
    list(filters?: {
        status?: NetworkData['status'];
        category?: string;
        limit?: number;
        offset?: number;
    }): Promise<NetworkData[]>;

    /**
     * Count networks matching filters
     */
    count(filters?: { status?: NetworkData['status']; category?: string }): Promise<number>;
}
