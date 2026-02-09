/**
 * D1 Bootstrap Repository
 * 
 * Cloudflare D1 (SQLite) implementation of IBootstrapRepository
 */

import { IBootstrapRepository, BootstrapConfigData } from '../../interfaces/IBootstrapRepository';

export class D1BootstrapRepository implements IBootstrapRepository {
    constructor(private db: D1Database) { }

    async create(data: Omit<BootstrapConfigData, 'id' | 'createdAt' | 'updatedAt'>): Promise<BootstrapConfigData> {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await this.db.prepare(`
            INSERT INTO bootstrap_configs (
                id, networkId, isActive, mode, convertedValidators, convertedMiners, minConfirmationsRequired, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id,
            data.networkId,
            data.isActive ? 1 : 0,
            data.mode,
            JSON.stringify(data.convertedValidators),
            JSON.stringify(data.convertedMiners),
            data.minConfirmationsRequired,
            now,
            now
        ).run();

        return {
            id,
            ...data,
            createdAt: new Date(now),
            updatedAt: new Date(now),
        };
    }

    async findByNetwork(networkId: string): Promise<BootstrapConfigData | null> {
        const result = await this.db.prepare(`
            SELECT * FROM bootstrap_configs WHERE networkId = ? LIMIT 1
        `).bind(networkId).first();

        return result ? this.mapToBootstrapData(result) : null;
    }

    async update(networkId: string, data: Partial<BootstrapConfigData>): Promise<BootstrapConfigData> {
        const updates: string[] = [];
        const bindings: any[] = [];

        if (data.isActive !== undefined) {
            updates.push('isActive = ?');
            bindings.push(data.isActive ? 1 : 0);
        }
        if (data.mode) {
            updates.push('mode = ?');
            bindings.push(data.mode);
        }
        if (data.convertedValidators) {
            updates.push('convertedValidators = ?');
            bindings.push(JSON.stringify(data.convertedValidators));
        }
        if (data.convertedMiners) {
            updates.push('convertedMiners = ?');
            bindings.push(JSON.stringify(data.convertedMiners));
        }
        if (data.minConfirmationsRequired !== undefined) {
            updates.push('minConfirmationsRequired = ?');
            bindings.push(data.minConfirmationsRequired);
        }

        updates.push('updatedAt = ?');
        bindings.push(new Date().toISOString());
        bindings.push(networkId);

        await this.db.prepare(`
            UPDATE bootstrap_configs SET ${updates.join(', ')} WHERE networkId = ?
        `).bind(...bindings).run();

        const updated = await this.findByNetwork(networkId);
        if (!updated) throw new Error('Bootstrap config not found after update');
        return updated;
    }

    async deactivate(networkId: string): Promise<void> {
        await this.db.prepare(`
            UPDATE bootstrap_configs SET isActive = 0, updatedAt = ? WHERE networkId = ?
        `).bind(new Date().toISOString(), networkId).run();
    }

    async getActiveBootstrapNetworks(): Promise<BootstrapConfigData[]> {
        const result = await this.db.prepare(`
            SELECT * FROM bootstrap_configs WHERE isActive = 1
        `).all();

        return result.results.map((row: any) => this.mapToBootstrapData(row));
    }

    private mapToBootstrapData(row: any): BootstrapConfigData {
        return {
            id: row.id,
            networkId: row.networkId,
            isActive: Boolean(row.isActive),
            mode: row.mode,
            convertedValidators: JSON.parse(row.convertedValidators),
            convertedMiners: JSON.parse(row.convertedMiners),
            minConfirmationsRequired: row.minConfirmationsRequired,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
        };
    }
}
