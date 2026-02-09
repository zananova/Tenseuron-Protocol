/**
 * Prisma Validator Interaction Repository
 * 
 * PostgreSQL/MySQL implementation of IValidatorInteractionRepository
 */

import { PrismaClient } from '@prisma/client';
import {
    IValidatorInteractionRepository,
    ValidatorInteractionData,
    InteractionFrequencyData
} from '../interfaces/IValidatorInteractionRepository';

export class PrismaValidatorInteractionRepository implements IValidatorInteractionRepository {
    constructor(private prisma: PrismaClient) { }

    async recordInteraction(data: Omit<ValidatorInteractionData, 'id' | 'timestamp'>): Promise<ValidatorInteractionData> {
        const interaction = await this.prisma.validatorInteraction.create({
            data: {
                networkId: data.networkId,
                validator1: data.validator1,
                validator2: data.validator2,
                taskId: data.taskId,
                agreement: data.agreement,
                metadata: data.metadata ? JSON.stringify(data.metadata) : null,
            },
        });

        return {
            id: interaction.id,
            networkId: interaction.networkId,
            validator1: interaction.validator1,
            validator2: interaction.validator2,
            taskId: interaction.taskId,
            agreement: interaction.agreement,
            timestamp: interaction.createdAt,
            metadata: interaction.metadata ? JSON.parse(interaction.metadata) : undefined,
        };
    }

    async findByValidators(
        validator1: string,
        validator2: string,
        networkId?: string,
        limit: number = 100
    ): Promise<ValidatorInteractionData[]> {
        const interactions = await this.prisma.validatorInteraction.findMany({
            where: {
                OR: [
                    { validator1, validator2, networkId },
                    { validator1: validator2, validator2: validator1, networkId },
                ],
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return interactions.map(interaction => ({
            id: interaction.id,
            networkId: interaction.networkId,
            validator1: interaction.validator1,
            validator2: interaction.validator2,
            taskId: interaction.taskId,
            agreement: interaction.agreement,
            timestamp: interaction.createdAt,
            metadata: interaction.metadata ? JSON.parse(interaction.metadata) : undefined,
        }));
    }

    async findByValidator(
        validatorAddress: string,
        networkId?: string,
        limit: number = 100
    ): Promise<ValidatorInteractionData[]> {
        const interactions = await this.prisma.validatorInteraction.findMany({
            where: {
                OR: [
                    { validator1: validatorAddress, networkId },
                    { validator2: validatorAddress, networkId },
                ],
            },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        return interactions.map(interaction => ({
            id: interaction.id,
            networkId: interaction.networkId,
            validator1: interaction.validator1,
            validator2: interaction.validator2,
            taskId: interaction.taskId,
            agreement: interaction.agreement,
            timestamp: interaction.createdAt,
            metadata: interaction.metadata ? JSON.parse(interaction.metadata) : undefined,
        }));
    }

    async getInteractionFrequency(
        validator1: string,
        validator2: string,
        networkId: string
    ): Promise<InteractionFrequencyData | null> {
        const interactions = await this.findByValidators(validator1, validator2, networkId, 1000);

        if (interactions.length === 0) {
            return null;
        }

        const agreementCount = interactions.filter(i => i.agreement).length;
        const disagreementCount = interactions.length - agreementCount;
        const agreementRate = agreementCount / interactions.length;
        const lastInteraction = interactions[0].timestamp;

        return {
            validator1,
            validator2,
            networkId,
            totalInteractions: interactions.length,
            agreementCount,
            disagreementCount,
            agreementRate,
            lastInteraction,
        };
    }

    async getHighAgreementPairs(
        networkId: string,
        minInteractions: number,
        minAgreementRate: number
    ): Promise<InteractionFrequencyData[]> {
        // Get all interactions for the network
        const interactions = await this.prisma.validatorInteraction.findMany({
            where: { networkId },
        });

        // Group by validator pairs
        const pairMap = new Map<string, ValidatorInteractionData[]>();

        for (const interaction of interactions) {
            const key = [interaction.validator1, interaction.validator2].sort().join('-');
            if (!pairMap.has(key)) {
                pairMap.set(key, []);
            }
            pairMap.get(key)!.push({
                id: interaction.id,
                networkId: interaction.networkId,
                validator1: interaction.validator1,
                validator2: interaction.validator2,
                taskId: interaction.taskId,
                agreement: interaction.agreement,
                timestamp: interaction.createdAt,
                metadata: interaction.metadata ? JSON.parse(interaction.metadata) : undefined,
            });
        }

        // Calculate frequencies and filter
        const highAgreementPairs: InteractionFrequencyData[] = [];

        for (const [key, pairInteractions] of pairMap.entries()) {
            if (pairInteractions.length < minInteractions) {
                continue;
            }

            const agreementCount = pairInteractions.filter(i => i.agreement).length;
            const agreementRate = agreementCount / pairInteractions.length;

            if (agreementRate >= minAgreementRate) {
                const [validator1, validator2] = key.split('-');
                highAgreementPairs.push({
                    validator1,
                    validator2,
                    networkId,
                    totalInteractions: pairInteractions.length,
                    agreementCount,
                    disagreementCount: pairInteractions.length - agreementCount,
                    agreementRate,
                    lastInteraction: pairInteractions[0].timestamp,
                });
            }
        }

        return highAgreementPairs.sort((a, b) => b.agreementRate - a.agreementRate);
    }

    async getValidatorStats(
        validatorAddress: string,
        networkId: string
    ): Promise<{
        totalInteractions: number;
        uniquePartners: number;
        averageAgreementRate: number;
    }> {
        const interactions = await this.findByValidator(validatorAddress, networkId, 10000);

        if (interactions.length === 0) {
            return {
                totalInteractions: 0,
                uniquePartners: 0,
                averageAgreementRate: 0,
            };
        }

        const partners = new Set<string>();
        let totalAgreements = 0;

        for (const interaction of interactions) {
            const partner = interaction.validator1 === validatorAddress
                ? interaction.validator2
                : interaction.validator1;
            partners.add(partner);
            if (interaction.agreement) {
                totalAgreements++;
            }
        }

        return {
            totalInteractions: interactions.length,
            uniquePartners: partners.size,
            averageAgreementRate: totalAgreements / interactions.length,
        };
    }

    async deleteOldInteractions(beforeDate: Date): Promise<number> {
        const result = await this.prisma.validatorInteraction.deleteMany({
            where: {
                createdAt: { lt: beforeDate },
            },
        });

        return result.count;
    }
}
