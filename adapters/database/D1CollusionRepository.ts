/**
 * D1 Collusion Repository
 * 
 * Cloudflare D1 (SQLite) implementation of ICollusionRepository
 */

import {
    ICollusionRepository,
    CollusionEventData,
    UserRejectionData,
    CollusionScoreData
} from '../../interfaces/ICollusionRepository';

export class D1CollusionRepository implements ICollusionRepository {
    constructor(private db: D1Database) { }

    async recordEvent(data: Omit<CollusionEventData, 'id' | 'detectedAt'>): Promise<CollusionEventData> {
        const id = crypto.randomUUID();
        const detectedAt = new Date();

        await this.db.prepare(`
            INSERT INTO collusion_events (
                id, networkId, taskId, validators, patternHash, severity, metadata, detectedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id,
            data.networkId,
            data.taskId || null,
            JSON.stringify(data.validators),
            data.patternHash,
            data.severity,
            data.metadata ? JSON.stringify(data.metadata) : null,
            detectedAt.toISOString()
        ).run();

        return {
            id,
            networkId: data.networkId,
            taskId: data.taskId,
            validators: data.validators,
            patternHash: data.patternHash,
            severity: data.severity,
            detectedAt,
            metadata: data.metadata,
        };
    }

    async recordUserRejection(data: Omit<UserRejectionData, 'id' | 'createdAt'>): Promise<UserRejectionData> {
        const id = crypto.randomUUID();
        const createdAt = new Date();

        await this.db.prepare(`
            INSERT INTO user_rejections (
                id, taskId, networkId, userAddress, rejectedValidators, patternHash, redoCount, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id,
            data.taskId,
            data.networkId,
            data.userAddress,
            JSON.stringify(data.rejectedValidators),
            data.patternHash,
            data.redoCount,
            createdAt.toISOString()
        ).run();

        return {
            id,
            taskId: data.taskId,
            networkId: data.networkId,
            userAddress: data.userAddress,
            rejectedValidators: data.rejectedValidators,
            patternHash: data.patternHash,
            redoCount: data.redoCount,
            createdAt,
        };
    }

    async findEventsByNetwork(networkId: string, limit: number = 100): Promise<CollusionEventData[]> {
        const result = await this.db.prepare(`
            SELECT * FROM collusion_events
            WHERE networkId = ?
            ORDER BY detectedAt DESC
            LIMIT ?
        `).bind(networkId, limit).all();

        return result.results.map(row => this.mapToCollusionEvent(row));
    }

    async findEventsByValidator(validatorAddress: string, limit: number = 100): Promise<CollusionEventData[]> {
        const result = await this.db.prepare(`
            SELECT * FROM collusion_events
            WHERE validators LIKE ?
            ORDER BY detectedAt DESC
            LIMIT ?
        `).bind(`%${validatorAddress}%`, limit).all();

        return result.results.map(row => this.mapToCollusionEvent(row));
    }

    async findRejectionsByNetwork(networkId: string, limit: number = 100): Promise<UserRejectionData[]> {
        const result = await this.db.prepare(`
            SELECT * FROM user_rejections
            WHERE networkId = ?
            ORDER BY createdAt DESC
            LIMIT ?
        `).bind(networkId, limit).all();

        return result.results.map(row => this.mapToUserRejection(row));
    }

    async findRejectionsByTask(taskId: string): Promise<UserRejectionData[]> {
        const result = await this.db.prepare(`
            SELECT * FROM user_rejections
            WHERE taskId = ?
            ORDER BY createdAt DESC
        `).bind(taskId).all();

        return result.results.map(row => this.mapToUserRejection(row));
    }

    async getCollusionScore(validatorAddress: string, networkId: string): Promise<number> {
        const result = await this.db.prepare(`
            SELECT score FROM collusion_scores
            WHERE validatorAddress = ? AND networkId = ?
        `).bind(validatorAddress, networkId).first();

        return result?.score || 0;
    }

    async updateCollusionScore(validatorAddress: string, networkId: string, score: number): Promise<void> {
        // Try to update first
        const updateResult = await this.db.prepare(`
            UPDATE collusion_scores
            SET score = ?, eventCount = eventCount + 1, lastEventAt = ?, updatedAt = ?
            WHERE validatorAddress = ? AND networkId = ?
        `).bind(
            score,
            new Date().toISOString(),
            new Date().toISOString(),
            validatorAddress,
            networkId
        ).run();

        // If no rows affected, insert
        if (updateResult.meta.changes === 0) {
            await this.db.prepare(`
                INSERT INTO collusion_scores (
                    validatorAddress, networkId, score, eventCount, lastEventAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
                validatorAddress,
                networkId,
                score,
                1,
                new Date().toISOString(),
                new Date().toISOString()
            ).run();
        }
    }

    async getHighRiskValidators(networkId: string, minScore: number): Promise<CollusionScoreData[]> {
        const result = await this.db.prepare(`
            SELECT * FROM collusion_scores
            WHERE networkId = ? AND score >= ?
            ORDER BY score DESC
        `).bind(networkId, minScore).all();

        return result.results.map(row => ({
            validatorAddress: row.validatorAddress,
            networkId: row.networkId,
            score: row.score,
            eventCount: row.eventCount,
            lastEventAt: row.lastEventAt ? new Date(row.lastEventAt) : undefined,
            updatedAt: new Date(row.updatedAt),
        }));
    }

    private mapToCollusionEvent(row: any): CollusionEventData {
        return {
            id: row.id,
            networkId: row.networkId,
            taskId: row.taskId || undefined,
            validators: JSON.parse(row.validators),
            patternHash: row.patternHash,
            severity: row.severity as 'low' | 'medium' | 'high' | 'critical',
            detectedAt: new Date(row.detectedAt),
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        };
    }

    private mapToUserRejection(row: any): UserRejectionData {
        return {
            id: row.id,
            taskId: row.taskId,
            networkId: row.networkId,
            userAddress: row.userAddress,
            rejectedValidators: JSON.parse(row.rejectedValidators),
            patternHash: row.patternHash,
            redoCount: row.redoCount,
            createdAt: new Date(row.createdAt),
        };
    }
}
