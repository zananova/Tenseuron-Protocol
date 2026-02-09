/**
 * D1 Event Store
 * 
 * Cloudflare D1 (SQLite) implementation of IEventStore for event sourcing
 */

import { IEventStore, DomainEvent } from '../../interfaces/IEventStore';

export class D1EventStore implements IEventStore {
    constructor(private db: D1Database) { }

    async append(event: Omit<DomainEvent, 'id'>): Promise<DomainEvent> {
        const id = crypto.randomUUID();

        await this.db.prepare(`
            INSERT INTO domain_events (
                id, aggregateId, aggregateType, eventType, data, userId, timestamp, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            id,
            event.aggregateId,
            event.aggregateType,
            event.eventType,
            JSON.stringify(event.data),
            event.metadata.userId || null,
            event.metadata.timestamp.toISOString(),
            event.metadata.version
        ).run();

        return {
            id,
            ...event,
        };
    }

    async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
        let query = `SELECT * FROM domain_events WHERE aggregateId = ?`;
        const bindings: any[] = [aggregateId];

        if (fromVersion !== undefined) {
            query += ` AND version >= ?`;
            bindings.push(fromVersion);
        }

        query += ` ORDER BY version ASC`;

        const result = await this.db.prepare(query).bind(...bindings).all();

        return result.results.map((row: any) => this.mapToDomainEvent(row));
    }

    async getEventsByType(eventType: string, limit?: number): Promise<DomainEvent[]> {
        let query = `SELECT * FROM domain_events WHERE eventType = ? ORDER BY timestamp DESC`;

        if (limit) {
            query += ` LIMIT ?`;
        }

        const result = limit
            ? await this.db.prepare(query).bind(eventType, limit).all()
            : await this.db.prepare(query).bind(eventType).all();

        return result.results.map((row: any) => this.mapToDomainEvent(row));
    }

    async getEventsByTimeRange(startDate: Date, endDate: Date): Promise<DomainEvent[]> {
        const result = await this.db.prepare(`
            SELECT * FROM domain_events
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `).bind(startDate.toISOString(), endDate.toISOString()).all();

        return result.results.map((row: any) => this.mapToDomainEvent(row));
    }

    async getLatestVersion(aggregateId: string): Promise<number> {
        const result = await this.db.prepare(`
            SELECT version FROM domain_events
            WHERE aggregateId = ?
            ORDER BY version DESC
            LIMIT 1
        `).bind(aggregateId).first();

        return result?.version || 0;
    }

    private mapToDomainEvent(row: any): DomainEvent {
        return {
            id: row.id,
            aggregateId: row.aggregateId,
            aggregateType: row.aggregateType,
            eventType: row.eventType,
            data: JSON.parse(row.data),
            metadata: {
                userId: row.userId || undefined,
                timestamp: new Date(row.timestamp),
                version: row.version,
            },
        };
    }
}
