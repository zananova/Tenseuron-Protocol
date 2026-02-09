/**
 * Prisma Event Store
 * 
 * PostgreSQL/MySQL implementation of IEventStore for event sourcing
 */

import { PrismaClient } from '@prisma/client';
import { IEventStore, DomainEvent } from '../../interfaces/IEventStore';

export class PrismaEventStore implements IEventStore {
    constructor(private prisma: PrismaClient) { }

    async append(event: Omit<DomainEvent, 'id'>): Promise<DomainEvent> {
        const created = await this.prisma.domainEvent.create({
            data: {
                aggregateId: event.aggregateId,
                aggregateType: event.aggregateType,
                eventType: event.eventType,
                data: event.data,
                userId: event.metadata.userId,
                timestamp: event.metadata.timestamp,
                version: event.metadata.version,
            },
        });

        return {
            id: created.id,
            aggregateId: created.aggregateId,
            aggregateType: created.aggregateType,
            eventType: created.eventType,
            data: created.data,
            metadata: {
                userId: created.userId || undefined,
                timestamp: created.timestamp,
                version: created.version,
            },
        };
    }

    async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
        const events = await this.prisma.domainEvent.findMany({
            where: {
                aggregateId,
                ...(fromVersion !== undefined && { version: { gte: fromVersion } }),
            },
            orderBy: { version: 'asc' },
        });

        return events.map(e => this.mapToDomainEvent(e));
    }

    async getEventsByType(eventType: string, limit?: number): Promise<DomainEvent[]> {
        const events = await this.prisma.domainEvent.findMany({
            where: { eventType },
            orderBy: { timestamp: 'desc' },
            take: limit,
        });

        return events.map(e => this.mapToDomainEvent(e));
    }

    async getEventsByTimeRange(startDate: Date, endDate: Date): Promise<DomainEvent[]> {
        const events = await this.prisma.domainEvent.findMany({
            where: {
                timestamp: {
                    gte: startDate,
                    lte: endDate,
                },
            },
            orderBy: { timestamp: 'asc' },
        });

        return events.map(e => this.mapToDomainEvent(e));
    }

    async getLatestVersion(aggregateId: string): Promise<number> {
        const latest = await this.prisma.domainEvent.findFirst({
            where: { aggregateId },
            orderBy: { version: 'desc' },
            select: { version: true },
        });

        return latest?.version || 0;
    }

    private mapToDomainEvent(event: any): DomainEvent {
        return {
            id: event.id,
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
            eventType: event.eventType,
            data: event.data,
            metadata: {
                userId: event.userId || undefined,
                timestamp: event.timestamp,
                version: event.version,
            },
        };
    }
}
