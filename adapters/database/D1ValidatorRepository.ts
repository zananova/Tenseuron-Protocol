/**
 * D1 Validator Repository
 * 
 * Cloudflare D1 (SQLite) implementation of IValidatorRepository
 */

import { IValidatorRepository, ValidatorData } from '../../interfaces/IValidatorRepository';

export class D1ValidatorRepository implements IValidatorRepository {
    constructor(private db: D1Database) { }

    async register(data: ValidatorData): Promise<ValidatorData> {
        const result = await this.db.prepare(`
            INSERT INTO validators (
                address, networkId, stake, reputation, isActive, isBanned,
                p2pEndpoint, registeredAt, lastActiveAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            data.address,
            data.networkId,
            data.stake,
            data.reputation,
            data.isActive ? 1 : 0,
            data.isBanned ? 1 : 0,
            data.p2pEndpoint || null,
            data.registeredAt.toISOString(),
            data.lastActiveAt?.toISOString() || null
        ).run();

        return data;
    }

    async findByAddress(address: string, networkId?: string): Promise<ValidatorData | null> {
        const query = networkId
            ? `SELECT * FROM validators WHERE address = ? AND networkId = ? LIMIT 1`
            : `SELECT * FROM validators WHERE address = ? LIMIT 1`;

        const result = networkId
            ? await this.db.prepare(query).bind(address, networkId).first()
            : await this.db.prepare(query).bind(address).first();

        if (!result) return null;

        return this.mapToValidatorData(result);
    }

    async findByNetwork(
        networkId: string,
        filters?: {
            isActive?: boolean;
            minStake?: string;
            minReputation?: number;
        }
    ): Promise<ValidatorData[]> {
        let query = `SELECT * FROM validators WHERE networkId = ?`;
        const bindings: any[] = [networkId];

        if (filters?.isActive !== undefined) {
            query += ` AND isActive = ?`;
            bindings.push(filters.isActive ? 1 : 0);
        }

        if (filters?.minStake) {
            query += ` AND CAST(stake AS REAL) >= ?`;
            bindings.push(parseFloat(filters.minStake));
        }

        if (filters?.minReputation !== undefined) {
            query += ` AND reputation >= ?`;
            bindings.push(filters.minReputation);
        }

        const result = await this.db.prepare(query).bind(...bindings).all();

        return result.results.map(row => this.mapToValidatorData(row));
    }

    async update(address: string, networkId: string, data: Partial<ValidatorData>): Promise<ValidatorData> {
        const updates: string[] = [];
        const bindings: any[] = [];

        if (data.stake !== undefined) {
            updates.push('stake = ?');
            bindings.push(data.stake);
        }
        if (data.reputation !== undefined) {
            updates.push('reputation = ?');
            bindings.push(data.reputation);
        }
        if (data.isActive !== undefined) {
            updates.push('isActive = ?');
            bindings.push(data.isActive ? 1 : 0);
        }
        if (data.isBanned !== undefined) {
            updates.push('isBanned = ?');
            bindings.push(data.isBanned ? 1 : 0);
        }
        if (data.p2pEndpoint !== undefined) {
            updates.push('p2pEndpoint = ?');
            bindings.push(data.p2pEndpoint);
        }
        if (data.lastActiveAt !== undefined) {
            updates.push('lastActiveAt = ?');
            bindings.push(data.lastActiveAt.toISOString());
        }

        bindings.push(address, networkId);

        await this.db.prepare(`
            UPDATE validators SET ${updates.join(', ')}
            WHERE address = ? AND networkId = ?
        `).bind(...bindings).run();

        const updated = await this.findByAddress(address, networkId);
        if (!updated) throw new Error('Validator not found after update');
        return updated;
    }

    async updateReputation(address: string, networkId: string, reputation: number): Promise<void> {
        await this.db.prepare(`
            UPDATE validators SET reputation = ?
            WHERE address = ? AND networkId = ?
        `).bind(reputation, address, networkId).run();
    }

    async updateStake(address: string, networkId: string, stake: string): Promise<void> {
        await this.db.prepare(`
            UPDATE validators SET stake = ?
            WHERE address = ? AND networkId = ?
        `).bind(stake, address, networkId).run();
    }

    async setBanStatus(address: string, networkId: string, isBanned: boolean): Promise<void> {
        await this.db.prepare(`
            UPDATE validators SET isBanned = ?
            WHERE address = ? AND networkId = ?
        `).bind(isBanned ? 1 : 0, address, networkId).run();
    }

    async updateLastActive(address: string, networkId: string): Promise<void> {
        await this.db.prepare(`
            UPDATE validators SET lastActiveAt = ?
            WHERE address = ? AND networkId = ?
        `).bind(new Date().toISOString(), address, networkId).run();
    }

    private mapToValidatorData(row: any): ValidatorData {
        return {
            address: row.address,
            networkId: row.networkId,
            stake: row.stake,
            reputation: row.reputation,
            isActive: Boolean(row.isActive),
            isBanned: Boolean(row.isBanned),
            p2pEndpoint: row.p2pEndpoint || undefined,
            registeredAt: new Date(row.registeredAt),
            lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt) : undefined,
        };
    }
}
