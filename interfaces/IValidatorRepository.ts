/**
 * Validator Repository Interface
 * Database-agnostic interface for validator data operations
 */

export interface ValidatorData {
    address: string;
    networkId: string;
    stake: string;
    reputation: number;
    isActive: boolean;
    isBanned: boolean;
    p2pEndpoint?: string;
    registeredAt: Date;
    lastActiveAt?: Date;
}

export interface IValidatorRepository {
    /**
     * Register a new validator
     */
    register(data: ValidatorData): Promise<ValidatorData>;

    /**
     * Find validator by address
     */
    findByAddress(address: string, networkId?: string): Promise<ValidatorData | null>;

    /**
     * Find all validators for a network
     */
    findByNetwork(networkId: string, filters?: {
        isActive?: boolean;
        minStake?: string;
        minReputation?: number;
    }): Promise<ValidatorData[]>;

    /**
     * Update validator data
     */
    update(address: string, networkId: string, data: Partial<ValidatorData>): Promise<ValidatorData>;

    /**
     * Update validator reputation
     */
    updateReputation(address: string, networkId: string, reputation: number): Promise<void>;

    /**
     * Update validator stake
     */
    updateStake(address: string, networkId: string, stake: string): Promise<void>;

    /**
     * Ban/unban validator
     */
    setBanStatus(address: string, networkId: string, isBanned: boolean): Promise<void>;

    /**
     * Update last active timestamp
     */
    updateLastActive(address: string, networkId: string): Promise<void>;
}
