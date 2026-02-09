/**
 * Event Store Interface
 * 
 * Database-agnostic interface for event sourcing
 */

export interface DomainEvent {
    id: string;
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    data: any;
    metadata: {
        userId?: string;
        timestamp: Date;
        version: number;
    };
}

export interface IEventStore {
    /**
     * Append event to store
     */
    append(event: Omit<DomainEvent, 'id'>): Promise<DomainEvent>;

    /**
     * Get events for an aggregate
     */
    getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]>;

    /**
     * Get events by type
     */
    getEventsByType(eventType: string, limit?: number): Promise<DomainEvent[]>;

    /**
     * Get all events in time range
     */
    getEventsByTimeRange(startDate: Date, endDate: Date): Promise<DomainEvent[]>;

    /**
     * Get latest version for aggregate
     */
    getLatestVersion(aggregateId: string): Promise<number>;
}
