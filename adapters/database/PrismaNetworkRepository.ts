/**
 * Prisma Network Repository
 * Adapter for Prisma ORM to implement INetworkRepository
 */

import { PrismaClient } from '@prisma/client';
import { INetworkRepository, NetworkData } from '../../interfaces';

export class PrismaNetworkRepository implements INetworkRepository {
    constructor(private prisma: PrismaClient) { }

    async create(data: NetworkData): Promise<NetworkData> {
        const result = await this.prisma.tenseuronNetwork.create({
            data: {
                networkId: data.networkId,
                name: data.name,
                description: data.description,
                category: data.category,
                creatorAddress: data.creatorAddress,
                manifestCid: data.manifestCid,
                contractAddress: data.contractAddress,
                validatorRegistryAddress: data.validatorRegistryAddress,
                settlementChain: data.settlementChain,
                status: data.status,
                moduleId: data.moduleId,
            },
        });
        return this.mapToNetworkData(result);
    }

    async findById(id: string): Promise<NetworkData | null> {
        const result = await this.prisma.tenseuronNetwork.findUnique({
            where: { networkId: id },
        });
        return result ? this.mapToNetworkData(result) : null;
    }

    async findByCreator(creatorAddress: string): Promise<NetworkData[]> {
        const results = await this.prisma.tenseuronNetwork.findMany({
            where: { creatorAddress },
            orderBy: { createdAt: 'desc' },
        });
        return results.map((r) => this.mapToNetworkData(r));
    }

    async update(id: string, data: Partial<NetworkData>): Promise<NetworkData> {
        const result = await this.prisma.tenseuronNetwork.update({
            where: { networkId: id },
            data: {
                name: data.name,
                description: data.description,
                category: data.category,
                manifestCid: data.manifestCid,
                contractAddress: data.contractAddress,
                validatorRegistryAddress: data.validatorRegistryAddress,
                settlementChain: data.settlementChain,
                status: data.status,
                moduleId: data.moduleId,
                updatedAt: new Date(),
            },
        });
        return this.mapToNetworkData(result);
    }

    async delete(id: string): Promise<void> {
        await this.prisma.tenseuronNetwork.delete({
            where: { networkId: id },
        });
    }

    async list(filters?: {
        status?: NetworkData['status'];
        category?: string;
        limit?: number;
        offset?: number;
    }): Promise<NetworkData[]> {
        const results = await this.prisma.tenseuronNetwork.findMany({
            where: {
                status: filters?.status,
                category: filters?.category,
            },
            take: filters?.limit,
            skip: filters?.offset,
            orderBy: { createdAt: 'desc' },
        });
        return results.map((r) => this.mapToNetworkData(r));
    }

    async count(filters?: {
        status?: NetworkData['status'];
        category?: string;
    }): Promise<number> {
        return await this.prisma.tenseuronNetwork.count({
            where: {
                status: filters?.status,
                category: filters?.category,
            },
        });
    }

    private mapToNetworkData(record: any): NetworkData {
        return {
            networkId: record.networkId,
            name: record.name,
            description: record.description,
            category: record.category,
            creatorAddress: record.creatorAddress,
            manifestCid: record.manifestCid || undefined,
            contractAddress: record.contractAddress || undefined,
            validatorRegistryAddress: record.validatorRegistryAddress || undefined,
            settlementChain: record.settlementChain || undefined,
            status: record.status,
            moduleId: record.moduleId || undefined,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
        };
    }
}
