/**
 * Creator Reputation Service Interface
 * 
 * Protocol uses this to check creator reputation and calculate bonds.
 * Implementations can use Prisma, D1, or any other database.
 */

export interface CreatorReputation {
    creatorAddress: string;
    reputation: number; // 0-100, starts at 100
    totalSignals: number;
    criticalSignals: number;
    networksAffected: number;
    networksCreated: string[]; // Network IDs
    bondMultiplier: number; // 1.0 = normal, higher for low reputation
    createdAt: Date;
    updatedAt: Date;
}

export interface ICreatorReputationService {
    /**
     * Get or create creator reputation
     */
    getCreatorReputation(creatorAddress: string): Promise<CreatorReputation>;

    /**
     * Record network creation (adds to networksCreated list)
     */
    recordNetworkCreation(creatorAddress: string, networkId: string): Promise<void>;

    /**
     * Check if creator can create a new network
     * Blocks creators with very low reputation
     */
    canCreateNetwork(creatorAddress: string): Promise<{
        allowed: boolean;
        reason?: string;
    }>;

    /**
     * Calculate required bond based on reputation and network value
     */
    calculateRequiredBond(
        creatorAddress: string,
        networkValue: string,
        baseBondPercentage?: number
    ): Promise<string>;
}
