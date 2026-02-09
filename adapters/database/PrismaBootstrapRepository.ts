/**
 * Prisma Bootstrap Repository
 * 
 * PostgreSQL/MySQL implementation of IBootstrapRepository
 */

import { PrismaClient } from '@prisma/client';
import { IBootstrapRepository, BootstrapConfigData } from '../../interfaces/IBootstrapRepository';

export class PrismaBootstrapRepository implements IBootstrapRepository {
    constructor(private prisma: PrismaClient) { }

    async create(data: Omit<BootstrapConfigData, 'id' | 'createdAt' | 'updatedAt'>): Promise<BootstrapConfigData> {
        const bootstrap = await this.prisma.bootstrapConfig.create({
            data: {
                networkId: data.networkId,
                isActive: data.isActive,
                mode: data.mode,
                convertedValidators: data.convertedValidators,
                convertedMiners: data.convertedMiners,
                minConfirmationsRequired: data.minConfirmationsRequired,
            },
        });

        return this.mapToBootstrapData(bootstrap);
    }

    async findByNetwork(networkId: string): Promise<BootstrapConfigData | null> {
        const bootstrap = await this.prisma.bootstrapConfig.findUnique({
            where: { networkId },
        });

        return bootstrap ? this.mapToBootstrapData(bootstrap) : null;
    }

    async update(networkId: string, data: Partial<BootstrapConfigData>): Promise<BootstrapConfigData> {
        const bootstrap = await this.prisma.bootstrapConfig.update({
            where: { networkId },
            data: {
                isActive: data.isActive,
                mode: data.mode,
                convertedValidators: data.convertedValidators,
                convertedMiners: data.convertedMiners,
                minConfirmationsRequired: data.minConfirmationsRequired,
            },
        });

        return this.mapToBootstrapData(bootstrap);
    }

    async deactivate(networkId: string): Promise<void> {
        await this.prisma.bootstrapConfig.update({
            where: { networkId },
            data: { isActive: false },
        });
    }

    async getActiveBootstrapNetworks(): Promise<BootstrapConfigData[]> {
        const bootstraps = await this.prisma.bootstrapConfig.findMany({
            where: { isActive: true },
        });

        return bootstraps.map(b => this.mapToBootstrapData(b));
    }

    private mapToBootstrapData(bootstrap: any): BootstrapConfigData {
        return {
            id: bootstrap.id,
            networkId: bootstrap.networkId,
            isActive: bootstrap.isActive,
            mode: bootstrap.mode,
            convertedValidators: bootstrap.convertedValidators,
            convertedMiners: bootstrap.convertedMiners,
            minConfirmationsRequired: bootstrap.minConfirmationsRequired,
            createdAt: bootstrap.createdAt,
            updatedAt: bootstrap.updatedAt,
        };
    }
}
