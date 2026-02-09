/**
 * Cache Repository Interface
 * 
 * Database-agnostic interface for caching layer
 */

export interface ICacheRepository {
    /**
     * Get value from cache
     */
    get<T>(key: string): Promise<T | null>;

    /**
     * Set value in cache with optional TTL
     */
    set<T>(key: string, value: T, ttl?: number): Promise<void>;

    /**
     * Delete value from cache
     */
    delete(key: string): Promise<void>;

    /**
     * Clear cache by pattern
     */
    clear(pattern?: string): Promise<void>;

    /**
     * Check if key exists
     */
    exists(key: string): Promise<boolean>;

    /**
     * Get multiple values
     */
    mget<T>(keys: string[]): Promise<(T | null)[]>;

    /**
     * Set multiple values
     */
    mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void>;
}
