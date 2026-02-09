/**
 * Prisma Graduation Repository
 * 
 * PostgreSQL/MySQL implementation of IGraduationRepository
 */

import { PrismaClient } from '@prisma/client';
import { IGraduationRepository, GraduationData } from '../../interfaces/IGraduationRepository';

export class PrismaGraduationRepository implements IGraduationRepository {
    constructor(private prisma: PrismaClient) { }

    async create(data: Omit<GraduationData, 'id' | 'createdAt' | 'updatedAt'>): Promise<GraduationData> {
        const graduation = await this.prisma.networkGraduation.create({
            data: {
                networkId: data.networkId,
                phase: data.phase,
                validatorCount: data.validatorCount,
                minerCount: data.minerCount,
                taskCount: data.taskCount,
                graduatedAt: data.graduatedAt,
            },
        });

        return this.mapToGraduationData(graduation);
    }

    async findByNetwork(networkId: string): Promise<GraduationData | null> {
        const graduation = await this.prisma.networkGraduation.findUnique({
            where: { networkId },
        });

        return graduation ? this.mapToGraduationData(graduation) : null;
    }

    async update(id: string, data: Partial<GraduationData>): Promise<GraduationData> {
        const graduation = await this.prisma.networkGraduation.update({
            where: { id },
            data: {
                phase: data.phase,
                validatorCount: data.validatorCount,
                minerCount: data.minerCount,
                taskCount: data.taskCount,
                graduatedAt: data.graduatedAt,
            },
        });

        return this.mapToGraduationData(graduation);
    }

    async getNetworksReadyForGraduation(criteria: {
        minValidators: number;
        minMiners: number;
        minTasks: number;
    }): Promise<string[]> {
        const graduations = await this.prisma.networkGraduation.findMany({
            where: {
                validatorCount: { gte: criteria.minValidators },
                minerCount: { gte: criteria.minMiners },
                taskCount: { gte: criteria.minTasks },
                graduatedAt: null,
            },
            select: { networkId: true },
        });

        return graduations.map(g => g.networkId);
    }

    async markAsGraduated(networkId: string, phase: 'growth' | 'mature'): Promise<void> {
        await this.prisma.networkGraduation.update({
            where: { networkId },
            data: {
                phase,
                graduatedAt: new Date(),
            },
        });
    }

    private mapToGraduationData(graduation: any): GraduationData {
        return {
            id: graduation.id,
            networkId: graduation.networkId,
            phase: graduation.phase,
            validatorCount: graduation.validatorCount,
            minerCount: graduation.minerCount,
            taskCount: graduation.taskCount,
            graduatedAt: graduation.graduatedAt || undefined,
            createdAt: graduation.createdAt,
            updatedAt: graduation.updatedAt,
        };
    }
}
