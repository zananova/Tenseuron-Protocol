/**
 * Prisma Collusion Repository
 * 
 * PostgreSQL/MySQL implementation of ICollusionRepository
 */

import { PrismaClient } from '@prisma/client';
import {
    ICollusionRepository,
    CollusionEventData,
    UserRejectionData,
    CollusionScoreData
} from '../interfaces/ICollusionRepository';

export class PrismaCollusionRepository implements ICollusionRepository {
    constructor(private prisma: PrismaClient) { }

    async recordEvent(data: Omit<CollusionEventData, 'id' | 'detectedAt'>): Promise<CollusionEventData> {
        const event = await this.prisma.collusionEvent.create({
            data: {
                networkId: data.networkId,
                taskId: data.taskId || null,
                validators: JSON.stringify(data.validators),
                patternHash: data.patternHash,
                severity: data.severity,
                metadata: data.metadata ? JSON.stringify(data.metadata) : null,
            },
        });

        return {
            id: event.id,
            networkId: event.networkId,
            taskId: event.taskId || undefined,
            validators: JSON.parse(event.validators),
            patternHash: event.patternHash,
            severity: event.severity as 'low' | 'medium' | 'high' | 'critical',
            detectedAt: event.createdAt,
            metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
        };
    }

    async recordUserRejection(data: Omit<UserRejectionData, 'id' | 'createdAt'>): Promise<UserRejectionData> {
        const rejection = await this.prisma.userRejection.create({
            data: {
                taskId: data.taskId,
                networkId: data.networkId,
                userAddress: data.userAddress,
                rejectedValidators: JSON.stringify(data.rejectedValidators),
                patternHash: data.patternHash,
                redoCount: data.redoCount,
            },
        });

        return {
            id: rejection.id,
            taskId: rejection.taskId,
            networkId: rejection.networkId,
            userAddress: rejection.userAddress,
            rejectedValidators: JSON.parse(rejection.rejectedValidators),
            patternHash: rejection.patternHash,
            redoCount: rejection.redoCount,
            createdAt: rejection.createdAt,
        };
    }

    async findEventsByNetwork(networkId: string, limit: number = 100): Promise<CollusionEventData[]> {
        const events = await this.prisma.collusionEvent.findMany({
            where: { networkId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return events.map(event => ({
            id: event.id,
            networkId: event.networkId,
            taskId: event.taskId || undefined,
            validators: JSON.parse(event.validators),
            patternHash: event.patternHash,
            severity: event.severity as 'low' | 'medium' | 'high' | 'critical',
            detectedAt: event.createdAt,
            metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
        }));
    }

    async findEventsByValidator(validatorAddress: string, limit: number = 100): Promise<CollusionEventData[]> {
        // Find events where validator is in the validators array
        const events = await this.prisma.collusionEvent.findMany({
            where: {
                validators: {
                    contains: validatorAddress,
                },
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return events.map(event => ({
            id: event.id,
            networkId: event.networkId,
            taskId: event.taskId || undefined,
            validators: JSON.parse(event.validators),
            patternHash: event.patternHash,
            severity: event.severity as 'low' | 'medium' | 'high' | 'critical',
            detectedAt: event.createdAt,
            metadata: event.metadata ? JSON.parse(event.metadata) : undefined,
        }));
    }

    async findRejectionsByNetwork(networkId: string, limit: number = 100): Promise<UserRejectionData[]> {
        const rejections = await this.prisma.userRejection.findMany({
            where: { networkId },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return rejections.map(rejection => ({
            id: rejection.id,
            taskId: rejection.taskId,
            networkId: rejection.networkId,
            userAddress: rejection.userAddress,
            rejectedValidators: JSON.parse(rejection.rejectedValidators),
            patternHash: rejection.patternHash,
            redoCount: rejection.redoCount,
            createdAt: rejection.createdAt,
        }));
    }

    async findRejectionsByTask(taskId: string): Promise<UserRejectionData[]> {
        const rejections = await this.prisma.userRejection.findMany({
            where: { taskId },
            orderBy: { createdAt: 'desc' },
        });

        return rejections.map(rejection => ({
            id: rejection.id,
            taskId: rejection.taskId,
            networkId: rejection.networkId,
            userAddress: rejection.userAddress,
            rejectedValidators: JSON.parse(rejection.rejectedValidators),
            patternHash: rejection.patternHash,
            redoCount: rejection.redoCount,
            createdAt: rejection.createdAt,
        }));
    }

    async getCollusionScore(validatorAddress: string, networkId: string): Promise<number> {
        const score = await this.prisma.collusionScore.findUnique({
            where: {
                validatorAddress_networkId: {
                    validatorAddress,
                    networkId,
                },
            },
        });

        return score?.score || 0;
    }

    async updateCollusionScore(validatorAddress: string, networkId: string, score: number): Promise<void> {
        await this.prisma.collusionScore.upsert({
            where: {
                validatorAddress_networkId: {
                    validatorAddress,
                    networkId,
                },
            },
            create: {
                validatorAddress,
                networkId,
                score,
                eventCount: 1,
                updatedAt: new Date(),
            },
            update: {
                score,
                eventCount: { increment: 1 },
                lastEventAt: new Date(),
                updatedAt: new Date(),
            },
        });
    }

    async getHighRiskValidators(networkId: string, minScore: number): Promise<CollusionScoreData[]> {
        const scores = await this.prisma.collusionScore.findMany({
            where: {
                networkId,
                score: { gte: minScore },
            },
            orderBy: { score: 'desc' },
        });

        return scores.map(score => ({
            validatorAddress: score.validatorAddress,
            networkId: score.networkId,
            score: score.score,
            eventCount: score.eventCount,
            lastEventAt: score.lastEventAt || undefined,
            updatedAt: score.updatedAt,
        }));
    }
}
