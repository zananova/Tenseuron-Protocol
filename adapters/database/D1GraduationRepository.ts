/**
 * D1 Graduation Repository
 * 
 * Cloudflare D1 (SQLite) implementation of IGraduationRepository
 */

import { IGraduationRepository, GraduationData } from '../../interfaces/IGraduationRepository';

export class D1GraduationRepository implements IGraduationRepository {
    constructor(private db: D1Database) { }

    async create(data: Omit<GraduationData, 'id' | 'createdAt' | 'updatedAt'>): Promise<GraduationData> {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        await this.db.prepare(`
            INSERT INTO network_graduations (
                id, networkId, phase, validatorCount, minerCount, taskCount, graduatedAt, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id,
            data.networkId,
            data.phase,
            data.validatorCount,
            data.minerCount,
            data.taskCount,
            data.graduatedAt?.toISOString() || null,
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

    async findByNetwork(networkId: string): Promise<GraduationData | null> {
        const result = await this.db.prepare(`
            SELECT * FROM network_graduations WHERE networkId = ? LIMIT 1
        `).bind(networkId).first();

        return result ? this.mapToGraduationData(result) : null;
    }

    async update(id: string, data: Partial<GraduationData>): Promise<GraduationData> {
        const updates: string[] = [];
        const bindings: any[] = [];

        if (data.phase) {
            updates.push('phase = ?');
            bindings.push(data.phase);
        }
        if (data.validatorCount !== undefined) {
            updates.push('validatorCount = ?');
            bindings.push(data.validatorCount);
        }
        if (data.minerCount !== undefined) {
            updates.push('minerCount = ?');
            bindings.push(data.minerCount);
        }
        if (data.taskCount !== undefined) {
            updates.push('taskCount = ?');
            bindings.push(data.taskCount);
        }
        if (data.graduatedAt !== undefined) {
            updates.push('graduatedAt = ?');
            bindings.push(data.graduatedAt.toISOString());
        }

        updates.push('updatedAt = ?');
        bindings.push(new Date().toISOString());
        bindings.push(id);

        await this.db.prepare(`
            UPDATE network_graduations SET ${updates.join(', ')} WHERE id = ?
        `).bind(...bindings).run();

        const updated = await this.db.prepare(`
            SELECT * FROM network_graduations WHERE id = ? LIMIT 1
        `).bind(id).first();

        if (!updated) throw new Error('Graduation record not found after update');
        return this.mapToGraduationData(updated);
    }

    async getNetworksReadyForGraduation(criteria: {
        minValidators: number;
        minMiners: number;
        minTasks: number;
    }): Promise<string[]> {
        const result = await this.db.prepare(`
            SELECT networkId FROM network_graduations
            WHERE validatorCount >= ? AND minerCount >= ? AND taskCount >= ? AND graduatedAt IS NULL
        `).bind(criteria.minValidators, criteria.minMiners, criteria.minTasks).all();

        return result.results.map((row: any) => row.networkId);
    }

    async markAsGraduated(networkId: string, phase: 'growth' | 'mature'): Promise<void> {
        await this.db.prepare(`
            UPDATE network_graduations SET phase = ?, graduatedAt = ?, updatedAt = ?
            WHERE networkId = ?
        `).bind(phase, new Date().toISOString(), new Date().toISOString(), networkId).run();
    }

    private mapToGraduationData(row: any): GraduationData {
        return {
            id: row.id,
            networkId: row.networkId,
            phase: row.phase,
            validatorCount: row.validatorCount,
            minerCount: row.minerCount,
            taskCount: row.taskCount,
            graduatedAt: row.graduatedAt ? new Date(row.graduatedAt) : undefined,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
        };
    }
}
