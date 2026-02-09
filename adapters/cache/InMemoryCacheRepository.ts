/**
 * In-Memory Cache Repository
 * 
 * Simple in-memory implementation of ICacheRepository for development/testing
 */

import { ICacheRepository } from '../../interfaces/ICacheRepository';

interface CacheEntry<T> {
    value: T;
    expiresAt?: number;
}

export class InMemoryCacheRepository implements ICacheRepository {
    private cache: Map<string, CacheEntry<any>> = new Map();
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Clean up expired entries every 60 seconds
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }

    async get<T>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        const entry: CacheEntry<T> = {
            value,
            expiresAt: ttl ? Date.now() + (ttl * 1000) : undefined,
        };

        this.cache.set(key, entry);
    }

    async delete(key: string): Promise<void> {
        this.cache.delete(key);
    }

    async clear(pattern?: string): Promise<void> {
        if (pattern) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            const keysToDelete: string[] = [];

            for (const key of this.cache.keys()) {
                if (regex.test(key)) {
                    keysToDelete.push(key);
                }
            }

            for (const key of keysToDelete) {
                this.cache.delete(key);
            }
        } else {
            this.cache.clear();
        }
    }

    async exists(key: string): Promise<boolean> {
        const entry = this.cache.get(key);

        if (!entry) {
            return false;
        }

        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    async mget<T>(keys: string[]): Promise<(T | null)[]> {
        return Promise.all(keys.map(key => this.get<T>(key)));
    }

    async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
        for (const entry of entries) {
            await this.set(entry.key, entry.value, entry.ttl);
        }
    }

    private cleanup(): void {
        const now = Date.now();
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt && entry.expiresAt < now) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.cache.delete(key);
        }
    }

    destroy(): void {
        clearInterval(this.cleanupInterval);
        this.cache.clear();
    }
}
