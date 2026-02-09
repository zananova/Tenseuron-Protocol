/**
 * Graduation Repository Interface
 * 
 * Database-agnostic interface for network graduation tracking
 */

export interface GraduationData {
    id: string;
    networkId: string;
    phase: 'bootstrap' | 'growth' | 'mature';
    validatorCount: number;
    minerCount: number;
    taskCount: number;
    graduatedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface IGraduationRepository {
    /**
     * Create graduation record
     */
    create(data: Omit<GraduationData, 'id' | 'createdAt' | 'updatedAt'>): Promise<GraduationData>;

    /**
     * Find graduation record by network
     */
    findByNetwork(networkId: string): Promise<GraduationData | null>;

    /**
     * Update graduation record
     */
    update(id: string, data: Partial<GraduationData>): Promise<GraduationData>;

    /**
     * Get networks ready for graduation
     */
    getNetworksReadyForGraduation(criteria: {
        minValidators: number;
        minMiners: number;
        minTasks: number;
    }): Promise<string[]>;

    /**
     * Mark network as graduated
     */
    markAsGraduated(networkId: string, phase: 'growth' | 'mature'): Promise<void>;
}
