/**
 * Bootstrap Repository Interface
 * 
 * Database-agnostic interface for bootstrap mode configuration
 */

export interface BootstrapConfigData {
    id: string;
    networkId: string;
    isActive: boolean;
    mode: 'no-validators' | 'no-miners' | 'normal';
    convertedValidators: string[];
    convertedMiners: string[];
    minConfirmationsRequired: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface IBootstrapRepository {
    /**
     * Create bootstrap configuration
     */
    create(data: Omit<BootstrapConfigData, 'id' | 'createdAt' | 'updatedAt'>): Promise<BootstrapConfigData>;

    /**
     * Find bootstrap config by network
     */
    findByNetwork(networkId: string): Promise<BootstrapConfigData | null>;

    /**
     * Update bootstrap configuration
     */
    update(networkId: string, data: Partial<BootstrapConfigData>): Promise<BootstrapConfigData>;

    /**
     * Deactivate bootstrap mode
     */
    deactivate(networkId: string): Promise<void>;

    /**
     * Get all active bootstrap networks
     */
    getActiveBootstrapNetworks(): Promise<BootstrapConfigData[]>;
}
