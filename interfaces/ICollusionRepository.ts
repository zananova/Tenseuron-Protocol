/**
 * Collusion Repository Interface
 * 
 * Provides database-agnostic access to collusion tracking data
 * Used by CollusionTrackingService and CollusionPreventionService
 */

export interface CollusionEventData {
    id: string;
    networkId: string;
    taskId?: string;
    validators: string[];
    patternHash: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    detectedAt: Date;
    metadata?: any;
}

export interface UserRejectionData {
    id: string;
    taskId: string;
    networkId: string;
    userAddress: string;
    rejectedValidators: string[];
    patternHash: string;
    redoCount: number;
    createdAt: Date;
}

export interface CollusionScoreData {
    validatorAddress: string;
    networkId: string;
    score: number; // 0-100, higher = more suspicious
    eventCount: number;
    lastEventAt?: Date;
    updatedAt: Date;
}

export interface ICollusionRepository {
    /**
     * Record a collusion event
     */
    recordEvent(data: Omit<CollusionEventData, 'id' | 'detectedAt'>): Promise<CollusionEventData>;

    /**
     * Record a user rejection
     */
    recordUserRejection(data: Omit<UserRejectionData, 'id' | 'createdAt'>): Promise<UserRejectionData>;

    /**
     * Find collusion events by network
     */
    findEventsByNetwork(networkId: string, limit?: number): Promise<CollusionEventData[]>;

    /**
     * Find collusion events involving a validator
     */
    findEventsByValidator(validatorAddress: string, limit?: number): Promise<CollusionEventData[]>;

    /**
     * Find user rejections by network
     */
    findRejectionsByNetwork(networkId: string, limit?: number): Promise<UserRejectionData[]>;

    /**
     * Find user rejections by task
     */
    findRejectionsByTask(taskId: string): Promise<UserRejectionData[]>;

    /**
     * Get collusion score for a validator
     */
    getCollusionScore(validatorAddress: string, networkId: string): Promise<number>;

    /**
     * Update collusion score for a validator
     */
    updateCollusionScore(validatorAddress: string, networkId: string, score: number): Promise<void>;

    /**
     * Get validators with high collusion scores
     */
    getHighRiskValidators(networkId: string, minScore: number): Promise<CollusionScoreData[]>;
}
