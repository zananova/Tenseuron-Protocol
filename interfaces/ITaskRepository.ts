/**
 * Task Repository Interface
 * Database-agnostic interface for task data operations
 */

export interface TaskData {
    taskId: string;
    networkId: string;
    status: 'submitted' | 'mining' | 'evaluating' | 'pre-filtering' | 'user-selecting' | 'consensus-reached' | 'paid' | 'challenged' | 'timed-out' | 'user-rejected';
    input: any;
    depositorAddress: string;
    depositAmount: string;
    depositTxHash?: string;
    ipfsCid?: string;
    winningOutputId?: string;
    consensusReached: boolean;
    paymentReleased: boolean;
    paymentTxHash?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface TaskOutputData {
    id: string;
    taskId: string;
    outputId: string;
    output: any;
    minerAddress: string;
    timestamp: Date;
    metadata?: any; // Optional metadata (seed, temperature, etc.)
}

export interface TaskEvaluationData {
    id: string;
    taskId: string;
    validatorAddress: string;
    outputId: string;
    score: number;
    confidence: number;
    signature: string;
    timestamp: Date;
    evidence?: any; // Optional evidence for the evaluation
}

export interface ITaskRepository {
    /**
     * Create a new task
     */
    create(data: TaskData): Promise<TaskData>;

    /**
     * Find task by ID
     */
    findById(id: string): Promise<TaskData | null>;

    /**
     * Find tasks by network ID
     */
    findByNetwork(networkId: string, filters?: {
        status?: TaskData['status'];
        limit?: number;
        offset?: number;
    }): Promise<TaskData[]>;

    /**
     * Update task data
     */
    update(id: string, data: Partial<TaskData>): Promise<TaskData>;

    /**
     * Update task status
     */
    updateStatus(id: string, status: TaskData['status']): Promise<void>;

    /**
     * Add task output
     */
    addOutput(data: TaskOutputData): Promise<TaskOutputData>;

    /**
     * Get task outputs
     */
    getOutputs(taskId: string): Promise<TaskOutputData[]>;

    /**
     * Add task evaluation
     */
    addEvaluation(data: TaskEvaluationData): Promise<TaskEvaluationData>;

    /**
     * Get task evaluations
     */
    getEvaluations(taskId: string): Promise<TaskEvaluationData[]>;

    /**
     * Find tasks by status
     */
    findByStatus(status: TaskData['status'], limit?: number): Promise<TaskData[]>;

    /**
     * Find tasks waiting for user selection (human-in-the-loop)
     */
    findWaitingForSelection(networkId?: string): Promise<TaskData[]>;

    /**
     * Update consensus fields (consensusReached, winningOutputId)
     */
    updateConsensus(taskId: string, winningOutputId: string): Promise<void>;

    /**
     * Update evaluation result
     */
    updateEvaluationResult(taskId: string, evaluationResult: any): Promise<void>;

    /**
     * Update pre-filtered outputs for human selection
     */
    updatePreFilteredOutputs(taskId: string, outputIds: string[]): Promise<void>;

    /**
     * Update human selection data
     */
    updateHumanSelection(taskId: string, selectedOutputId: string, userAddress: string): Promise<void>;
}
