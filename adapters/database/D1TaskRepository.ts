/**
 * D1 Task Repository
 * 
 * Implements ITaskRepository for Cloudflare D1 (SQLite)
 */

import { ITaskRepository, TaskData, TaskOutputData, TaskEvaluationData } from '../../interfaces/ITaskRepository';

// D1Database type from Cloudflare Workers
export interface D1Database {
    prepare(query: string): D1PreparedStatement;
    dump(): Promise<ArrayBuffer>;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
    bind(...values: any[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run<T = unknown>(): Promise<D1Result<T>>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
    results?: T[];
    success: boolean;
    meta: {
        duration: number;
        size_after: number;
        rows_read: number;
        rows_written: number;
    };
}

export interface D1ExecResult {
    count: number;
    duration: number;
}

export class D1TaskRepository implements ITaskRepository {
    constructor(private db: D1Database) { }

    async create(data: TaskData): Promise<TaskData> {
        const now = new Date().toISOString();

        await this.db
            .prepare(`
                INSERT INTO tenseuron_tasks (
                    taskId, networkId, status, input, depositorAddress, depositAmount,
                    depositTxHash, taskStateIpfsCid, winningOutputId, consensusReached,
                    paymentReleased, paymentTxHash, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
                data.taskId,
                data.networkId,
                data.status,
                JSON.stringify(data.input),
                data.depositorAddress,
                data.depositAmount,
                data.depositTxHash || null,
                data.ipfsCid || null,
                data.winningOutputId || null,
                data.consensusReached ? 1 : 0,
                data.paymentReleased ? 1 : 0,
                data.paymentTxHash || null,
                now,
                now
            )
            .run();

        return {
            ...data,
            createdAt: new Date(now),
            updatedAt: new Date(now),
        };
    }

    async findById(taskId: string): Promise<TaskData | null> {
        const result = await this.db
            .prepare('SELECT * FROM tenseuron_tasks WHERE taskId = ?')
            .bind(taskId)
            .first<any>();

        return result ? this.mapToTaskData(result) : null;
    }

    async findByNetwork(
        networkId: string,
        filters?: {
            status?: TaskData['status'];
            limit?: number;
            offset?: number;
        }
    ): Promise<TaskData[]> {
        let query = 'SELECT * FROM tenseuron_tasks WHERE networkId = ?';
        const params: any[] = [networkId];

        if (filters?.status) {
            query += ' AND status = ?';
            params.push(filters.status);
        }

        query += ' ORDER BY createdAt DESC';

        if (filters?.limit) {
            query += ' LIMIT ?';
            params.push(filters.limit);
        }

        if (filters?.offset) {
            query += ' OFFSET ?';
            params.push(filters.offset);
        }

        const result = await this.db
            .prepare(query)
            .bind(...params)
            .all<any>();

        return (result.results || []).map(task => this.mapToTaskData(task));
    }

    async update(taskId: string, data: Partial<TaskData>): Promise<TaskData> {
        const updates: string[] = [];
        const params: any[] = [];

        if (data.status) {
            updates.push('status = ?');
            params.push(data.status);
        }
        if (data.input) {
            updates.push('input = ?');
            params.push(JSON.stringify(data.input));
        }
        if (data.depositTxHash) {
            updates.push('depositTxHash = ?');
            params.push(data.depositTxHash);
        }
        if (data.ipfsCid) {
            updates.push('taskStateIpfsCid = ?');
            params.push(data.ipfsCid);
        }
        if (data.winningOutputId) {
            updates.push('winningOutputId = ?');
            params.push(data.winningOutputId);
        }
        if (data.consensusReached !== undefined) {
            updates.push('consensusReached = ?');
            params.push(data.consensusReached ? 1 : 0);
        }
        if (data.paymentReleased !== undefined) {
            updates.push('paymentReleased = ?');
            params.push(data.paymentReleased ? 1 : 0);
        }
        if (data.paymentTxHash) {
            updates.push('paymentTxHash = ?');
            params.push(data.paymentTxHash);
        }

        updates.push('updatedAt = ?');
        params.push(new Date().toISOString());

        params.push(taskId);

        await this.db
            .prepare(`UPDATE tenseuron_tasks SET ${updates.join(', ')} WHERE taskId = ?`)
            .bind(...params)
            .run();

        const updated = await this.findById(taskId);
        if (!updated) {
            throw new Error(`Task not found after update: ${taskId}`);
        }

        return updated;
    }

    async updateStatus(taskId: string, status: TaskData['status']): Promise<void> {
        await this.db
            .prepare('UPDATE tenseuron_tasks SET status = ?, updatedAt = ? WHERE taskId = ?')
            .bind(status, new Date().toISOString(), taskId)
            .run();
    }

    async addOutput(data: TaskOutputData): Promise<TaskOutputData> {
        const id = `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await this.db
            .prepare(`
                INSERT INTO tenseuron_task_outputs (
                    id, taskId, outputId, output, minerAddress, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?)
            `)
            .bind(
                id,
                data.taskId,
                data.outputId,
                JSON.stringify(data.output),
                data.minerAddress,
                data.timestamp.toISOString()
            )
            .run();

        return {
            id,
            taskId: data.taskId,
            outputId: data.outputId,
            output: data.output,
            minerAddress: data.minerAddress,
            timestamp: data.timestamp,
        };
    }

    async getOutputs(taskId: string): Promise<TaskOutputData[]> {
        const result = await this.db
            .prepare('SELECT * FROM tenseuron_task_outputs WHERE taskId = ?')
            .bind(taskId)
            .all<any>();

        return (result.results || []).map(output => ({
            id: output.id,
            taskId: output.taskId,
            outputId: output.outputId,
            output: JSON.parse(output.output),
            minerAddress: output.minerAddress,
            timestamp: new Date(output.timestamp),
        }));
    }

    async addEvaluation(data: TaskEvaluationData): Promise<TaskEvaluationData> {
        const id = `eval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        await this.db
            .prepare(`
                INSERT INTO tenseuron_task_evaluations (
                    id, taskId, outputId, validatorAddress, score, confidence, signature, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .bind(
                id,
                data.taskId,
                data.outputId,
                data.validatorAddress,
                data.score,
                data.confidence,
                data.signature,
                data.timestamp.toISOString()
            )
            .run();

        return {
            id,
            taskId: data.taskId,
            outputId: data.outputId,
            validatorAddress: data.validatorAddress,
            score: data.score,
            confidence: data.confidence,
            signature: data.signature,
            timestamp: data.timestamp,
        };
    }

    async getEvaluations(taskId: string): Promise<TaskEvaluationData[]> {
        const result = await this.db
            .prepare('SELECT * FROM tenseuron_task_evaluations WHERE taskId = ?')
            .bind(taskId)
            .all<any>();

        return (result.results || []).map(evaluation => ({
            id: evaluation.id,
            taskId: evaluation.taskId,
            outputId: evaluation.outputId,
            validatorAddress: evaluation.validatorAddress,
            score: evaluation.score,
            confidence: evaluation.confidence,
            signature: evaluation.signature,
            timestamp: new Date(evaluation.timestamp),
        }));
    }

    async findByStatus(status: TaskData['status'], limit?: number): Promise<TaskData[]> {
        let query = 'SELECT * FROM tenseuron_tasks WHERE status = ? ORDER BY createdAt DESC';
        const params: any[] = [status];

        if (limit) {
            query += ' LIMIT ?';
            params.push(limit);
        }

        const result = await this.db
            .prepare(query)
            .bind(...params)
            .all<any>();

        return (result.results || []).map(task => this.mapToTaskData(task));
    }

    async findWaitingForSelection(networkId?: string): Promise<TaskData[]> {
        let query = 'SELECT * FROM tenseuron_tasks WHERE status = ?';
        const params: any[] = ['user-selecting'];

        if (networkId) {
            query += ' AND networkId = ?';
            params.push(networkId);
        }

        query += ' ORDER BY createdAt DESC';

        const result = await this.db
            .prepare(query)
            .bind(...params)
            .all<any>();

        return (result.results || []).map(task => this.mapToTaskData(task));
    }

    async updateConsensus(taskId: string, winningOutputId: string): Promise<void> {
        await this.db
            .prepare(`
                UPDATE tenseuron_tasks 
                SET consensusReached = 1, winningOutputId = ?, status = ?, updatedAt = ?
                WHERE taskId = ?
            `)
            .bind(winningOutputId, 'consensus-reached', new Date().toISOString(), taskId)
            .run();
    }

    async updateEvaluationResult(taskId: string, evaluationResult: any): Promise<void> {
        await this.db
            .prepare('UPDATE tenseuron_tasks SET evaluationResult = ?, updatedAt = ? WHERE taskId = ?')
            .bind(JSON.stringify(evaluationResult), new Date().toISOString(), taskId)
            .run();
    }

    async updatePreFilteredOutputs(taskId: string, outputIds: string[]): Promise<void> {
        await this.db
            .prepare(`
                UPDATE tenseuron_tasks 
                SET preFilteredOutputs = ?, status = ?, updatedAt = ?
                WHERE taskId = ?
            `)
            .bind(JSON.stringify(outputIds), 'pre-filtering', new Date().toISOString(), taskId)
            .run();
    }

    async updateHumanSelection(taskId: string, selectedOutputId: string, userAddress: string): Promise<void> {
        const humanSelection = JSON.stringify({
            selectedOutputId,
            userAddress,
            timestamp: Date.now()
        });

        await this.db
            .prepare(`
                UPDATE tenseuron_tasks 
                SET humanSelection = ?, winningOutputId = ?, status = ?, updatedAt = ?
                WHERE taskId = ?
            `)
            .bind(humanSelection, selectedOutputId, 'consensus-reached', new Date().toISOString(), taskId)
            .run();
    }

    private mapToTaskData(row: any): TaskData {
        return {
            taskId: row.taskId,
            networkId: row.networkId,
            status: row.status as TaskData['status'],
            input: JSON.parse(row.input),
            depositorAddress: row.depositorAddress,
            depositAmount: row.depositAmount,
            depositTxHash: row.depositTxHash,
            ipfsCid: row.taskStateIpfsCid,
            winningOutputId: row.winningOutputId,
            consensusReached: Boolean(row.consensusReached),
            paymentReleased: Boolean(row.paymentReleased),
            paymentTxHash: row.paymentTxHash,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
        };
    }
}
