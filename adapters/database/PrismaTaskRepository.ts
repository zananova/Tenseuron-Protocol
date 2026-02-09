/**
 * Prisma Task Repository
 * 
 * Implements ITaskRepository for Prisma/PostgreSQL
 */

import { PrismaClient } from '@prisma/client';
import { ITaskRepository, TaskData, TaskOutputData, TaskEvaluationData } from '../../interfaces/ITaskRepository';

export class PrismaTaskRepository implements ITaskRepository {
    constructor(private prisma: PrismaClient) { }

    async create(data: TaskData): Promise<TaskData> {
        const task = await this.prisma.tenseuronTask.create({
            data: {
                taskId: data.taskId,
                networkId: data.networkId,
                status: data.status,
                input: JSON.stringify(data.input),
                depositorAddress: data.depositorAddress,
                depositAmount: data.depositAmount,
                depositTxHash: data.depositTxHash,
                taskStateIpfsCid: data.ipfsCid,
                winningOutputId: data.winningOutputId,
                consensusReached: data.consensusReached,
                paymentReleased: data.paymentReleased,
                paymentTxHash: data.paymentTxHash,
            },
        });

        return this.mapToTaskData(task);
    }

    async findById(taskId: string): Promise<TaskData | null> {
        const task = await this.prisma.tenseuronTask.findUnique({
            where: { taskId },
        });

        return task ? this.mapToTaskData(task) : null;
    }

    async findByNetwork(
        networkId: string,
        filters?: {
            status?: TaskData['status'];
            limit?: number;
            offset?: number;
        }
    ): Promise<TaskData[]> {
        const tasks = await this.prisma.tenseuronTask.findMany({
            where: {
                networkId,
                ...(filters?.status && { status: filters.status }),
            },
            take: filters?.limit,
            skip: filters?.offset,
            orderBy: { createdAt: 'desc' },
        });

        return tasks.map(task => this.mapToTaskData(task));
    }

    async update(taskId: string, data: Partial<TaskData>): Promise<TaskData> {
        const task = await this.prisma.tenseuronTask.update({
            where: { taskId },
            data: {
                ...(data.status && { status: data.status }),
                ...(data.input && { input: JSON.stringify(data.input) }),
                ...(data.depositTxHash && { depositTxHash: data.depositTxHash }),
                ...(data.ipfsCid && { taskStateIpfsCid: data.ipfsCid }),
                ...(data.winningOutputId && { winningOutputId: data.winningOutputId }),
                ...(data.consensusReached !== undefined && { consensusReached: data.consensusReached }),
                ...(data.paymentReleased !== undefined && { paymentReleased: data.paymentReleased }),
                ...(data.paymentTxHash && { paymentTxHash: data.paymentTxHash }),
            },
        });

        return this.mapToTaskData(task);
    }

    async updateStatus(taskId: string, status: TaskData['status']): Promise<void> {
        await this.prisma.tenseuronTask.update({
            where: { taskId },
            data: { status },
        });
    }

    async addOutput(data: TaskOutputData): Promise<TaskOutputData> {
        // First find the task to get the internal ID
        const task = await this.prisma.tenseuronTask.findUnique({
            where: { taskId: data.taskId },
        });

        if (!task) {
            throw new Error(`Task not found: ${data.taskId}`);
        }

        const output = await this.prisma.tenseuronTaskOutput.create({
            data: {
                taskId: task.id, // Use internal ID for relation
                outputId: data.outputId,
                output: JSON.stringify(data.output),
                minerAddress: data.minerAddress,
                timestamp: data.timestamp,
            },
        });

        return {
            id: output.id,
            taskId: data.taskId, // Return public taskId
            outputId: output.outputId,
            output: JSON.parse(output.output),
            minerAddress: output.minerAddress,
            timestamp: output.timestamp,
        };
    }

    async getOutputs(taskId: string): Promise<TaskOutputData[]> {
        const task = await this.prisma.tenseuronTask.findUnique({
            where: { taskId },
            include: { outputs: true },
        });

        if (!task) {
            return [];
        }

        return task.outputs.map(output => ({
            id: output.id,
            taskId: taskId,
            outputId: output.outputId,
            output: JSON.parse(output.output),
            minerAddress: output.minerAddress,
            timestamp: output.timestamp,
        }));
    }

    async addEvaluation(data: TaskEvaluationData): Promise<TaskEvaluationData> {
        // First find the task to get the internal ID
        const task = await this.prisma.tenseuronTask.findUnique({
            where: { taskId: data.taskId },
        });

        if (!task) {
            throw new Error(`Task not found: ${data.taskId}`);
        }

        const evaluation = await this.prisma.tenseuronTaskEvaluation.create({
            data: {
                taskId: task.id, // Use internal ID for relation
                outputId: data.outputId,
                validatorAddress: data.validatorAddress,
                score: data.score,
                confidence: data.confidence,
                signature: data.signature,
                timestamp: data.timestamp,
            },
        });

        return {
            id: evaluation.id,
            taskId: data.taskId, // Return public taskId
            outputId: evaluation.outputId,
            validatorAddress: evaluation.validatorAddress,
            score: evaluation.score,
            confidence: evaluation.confidence,
            signature: evaluation.signature,
            timestamp: evaluation.timestamp,
        };
    }

    async getEvaluations(taskId: string): Promise<TaskEvaluationData[]> {
        const task = await this.prisma.tenseuronTask.findUnique({
            where: { taskId },
            include: { evaluations: true },
        });

        if (!task) {
            return [];
        }

        return task.evaluations.map(evaluation => ({
            id: evaluation.id,
            taskId: taskId,
            outputId: evaluation.outputId,
            validatorAddress: evaluation.validatorAddress,
            score: evaluation.score,
            confidence: evaluation.confidence,
            signature: evaluation.signature,
            timestamp: evaluation.timestamp,
        }));
    }

    async findByStatus(status: TaskData['status'], limit?: number): Promise<TaskData[]> {
        const tasks = await this.prisma.tenseuronTask.findMany({
            where: { status },
            take: limit,
            orderBy: { createdAt: 'desc' },
        });

        return tasks.map(task => this.mapToTaskData(task));
    }

    async findWaitingForSelection(networkId?: string): Promise<TaskData[]> {
        const where: any = { status: 'user-selecting' };
        if (networkId) {
            where.networkId = networkId;
        }

        const tasks = await this.prisma.tenseuronTask.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });

        return tasks.map(task => this.mapToTaskData(task));
    }

    async updateConsensus(taskId: string, winningOutputId: string): Promise<void> {
        await this.prisma.tenseuronTask.update({
            where: { taskId },
            data: {
                consensusReached: true,
                winningOutputId,
                status: 'consensus-reached',
            },
        });
    }

    async updateEvaluationResult(taskId: string, evaluationResult: any): Promise<void> {
        await this.prisma.tenseuronTask.update({
            where: { taskId },
            data: {
                evaluationResult: JSON.stringify(evaluationResult),
            },
        });
    }

    async updatePreFilteredOutputs(taskId: string, outputIds: string[]): Promise<void> {
        await this.prisma.tenseuronTask.update({
            where: { taskId },
            data: {
                preFilteredOutputs: JSON.stringify(outputIds),
                status: 'pre-filtering',
            },
        });
    }

    async updateHumanSelection(taskId: string, selectedOutputId: string, userAddress: string): Promise<void> {
        await this.prisma.tenseuronTask.update({
            where: { taskId },
            data: {
                humanSelection: JSON.stringify({ selectedOutputId, userAddress, timestamp: Date.now() }),
                winningOutputId: selectedOutputId,
                status: 'consensus-reached',
            },
        });
    }

    private mapToTaskData(task: any): TaskData {
        return {
            taskId: task.taskId,
            networkId: task.networkId,
            status: task.status as TaskData['status'],
            input: JSON.parse(task.input),
            depositorAddress: task.depositorAddress,
            depositAmount: task.depositAmount,
            depositTxHash: task.depositTxHash,
            ipfsCid: task.taskStateIpfsCid,
            winningOutputId: task.winningOutputId,
            consensusReached: task.consensusReached,
            paymentReleased: task.paymentReleased,
            paymentTxHash: task.paymentTxHash,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
        };
    }
}
