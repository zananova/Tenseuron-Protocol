/**
 * D1 Network Repository
 * Adapter for Cloudflare D1 to implement INetworkRepository
 */

import { INetworkRepository, NetworkData } from '../../interfaces';

export class D1NetworkRepository implements INetworkRepository {
    constructor(private db: D1Database) { }

    async create(data: NetworkData): Promise<NetworkData> {
        const stmt = this.db.prepare(`
      INSERT INTO launchpad_projects (
        id, name, description, category, creatorAddress,
        manifestCid, contractAddress, validatorRegistryAddress,
        settlementChain, status, moduleId, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        await stmt
            .bind(
                data.networkId,
                data.name,
                data.description,
                data.category,
                data.creatorAddress,
                data.manifestCid || null,
                data.contractAddress || null,
                data.validatorRegistryAddress || null,
                data.settlementChain || null,
                data.status,
                data.moduleId || null,
                Math.floor(data.createdAt.getTime() / 1000),
                Math.floor(data.updatedAt.getTime() / 1000)
            )
            .run();

        return data;
    }

    async findById(id: string): Promise<NetworkData | null> {
        const result = await this.db
            .prepare('SELECT * FROM launchpad_projects WHERE id = ?')
            .bind(id)
            .first();

        return result ? this.mapToNetworkData(result) : null;
    }

    async findByCreator(creatorAddress: string): Promise<NetworkData[]> {
        const results = await this.db
            .prepare('SELECT * FROM launchpad_projects WHERE creatorAddress = ? ORDER BY createdAt DESC')
            .bind(creatorAddress)
            .all();

        return results.results.map((r: any) => this.mapToNetworkData(r));
    }

    async update(id: string, data: Partial<NetworkData>): Promise<NetworkData> {
        const updates: string[] = [];
        const values: any[] = [];

        if (data.name !== undefined) {
            updates.push('name = ?');
            values.push(data.name);
        }
        if (data.description !== undefined) {
            updates.push('description = ?');
            values.push(data.description);
        }
        if (data.category !== undefined) {
            updates.push('category = ?');
            values.push(data.category);
        }
        if (data.manifestCid !== undefined) {
            updates.push('manifestCid = ?');
            values.push(data.manifestCid);
        }
        if (data.contractAddress !== undefined) {
            updates.push('contractAddress = ?');
            values.push(data.contractAddress);
        }
        if (data.validatorRegistryAddress !== undefined) {
            updates.push('validatorRegistryAddress = ?');
            values.push(data.validatorRegistryAddress);
        }
        if (data.settlementChain !== undefined) {
            updates.push('settlementChain = ?');
            values.push(data.settlementChain);
        }
        if (data.status !== undefined) {
            updates.push('status = ?');
            values.push(data.status);
        }
        if (data.moduleId !== undefined) {
            updates.push('moduleId = ?');
            values.push(data.moduleId);
        }

        updates.push('updatedAt = ?');
        values.push(Math.floor(Date.now() / 1000));

        values.push(id);

        await this.db
            .prepare(`UPDATE launchpad_projects SET ${updates.join(', ')} WHERE id = ?`)
            .bind(...values)
            .run();

        const updated = await this.findById(id);
        if (!updated) throw new Error('Network not found after update');
        return updated;
    }

    async delete(id: string): Promise<void> {
        await this.db.prepare('DELETE FROM launchpad_projects WHERE id = ?').bind(id).run();
    }

    async list(filters?: {
        status?: NetworkData['status'];
        category?: string;
        limit?: number;
        offset?: number;
    }): Promise<NetworkData[]> {
        let query = 'SELECT * FROM launchpad_projects WHERE 1=1';
        const values: any[] = [];

        if (filters?.status) {
            query += ' AND status = ?';
            values.push(filters.status);
        }
        if (filters?.category) {
            query += ' AND category = ?';
            values.push(filters.category);
        }

        query += ' ORDER BY createdAt DESC';

        if (filters?.limit) {
            query += ' LIMIT ?';
            values.push(filters.limit);
        }
        if (filters?.offset) {
            query += ' OFFSET ?';
            values.push(filters.offset);
        }

        const results = await this.db.prepare(query).bind(...values).all();
        return results.results.map((r: any) => this.mapToNetworkData(r));
    }

    async count(filters?: { status?: NetworkData['status']; category?: string }): Promise<number> {
        let query = 'SELECT COUNT(*) as count FROM launchpad_projects WHERE 1=1';
        const values: any[] = [];

        if (filters?.status) {
            query += ' AND status = ?';
            values.push(filters.status);
        }
        if (filters?.category) {
            query += ' AND category = ?';
            values.push(filters.category);
        }

        const result = await this.db.prepare(query).bind(...values).first();
        return (result as any)?.count || 0;
    }

    private mapToNetworkData(record: any): NetworkData {
        return {
            networkId: record.id,
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
            createdAt: new Date(record.createdAt * 1000),
            updatedAt: new Date(record.updatedAt * 1000),
        };
    }
}
