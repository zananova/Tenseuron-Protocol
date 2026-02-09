/**
 * Validator Interaction Repository Interface
 * 
 * Provides database-agnostic access to validator interaction data
 * Used by CollusionPreventionService to track validator patterns
 */

export interface ValidatorInteractionData {
    id: string;
    networkId: string;
    validator1: string;
    validator2: string;
    taskId: string;
    agreement: boolean; // Did they agree on the same output?
    timestamp: Date;
    metadata?: any;
}

export interface InteractionFrequencyData {
    validator1: string;
    validator2: string;
    networkId: string;
    totalInteractions: number;
    agreementCount: number;
    disagreementCount: number;
    agreementRate: number; // 0-1
    lastInteraction: Date;
}

export interface IValidatorInteractionRepository {
    /**
     * Record a validator interaction
     */
    recordInteraction(data: Omit<ValidatorInteractionData, 'id' | 'timestamp'>): Promise<ValidatorInteractionData>;

    /**
     * Find interactions between two validators
     */
    findByValidators(
        validator1: string,
        validator2: string,
        networkId?: string,
        limit?: number
    ): Promise<ValidatorInteractionData[]>;

    /**
     * Find all interactions for a validator
     */
    findByValidator(
        validatorAddress: string,
        networkId?: string,
        limit?: number
    ): Promise<ValidatorInteractionData[]>;

    /**
     * Get interaction frequency between two validators
     */
    getInteractionFrequency(
        validator1: string,
        validator2: string,
        networkId: string
    ): Promise<InteractionFrequencyData | null>;

    /**
     * Get validators with high agreement rate (potential collusion)
     */
    getHighAgreementPairs(
        networkId: string,
        minInteractions: number,
        minAgreementRate: number
    ): Promise<InteractionFrequencyData[]>;

    /**
     * Get interaction statistics for a validator
     */
    getValidatorStats(
        validatorAddress: string,
        networkId: string
    ): Promise<{
        totalInteractions: number;
        uniquePartners: number;
        averageAgreementRate: number;
    }>;

    /**
     * Clean up old interactions (for privacy/storage)
     */
    deleteOldInteractions(beforeDate: Date): Promise<number>;
}
