/**
 * Redis Cache Repository
 * 
 * Redis implementation of ICacheRepository for distributed caching
 */

import { ICacheRepository } from '../../interfaces/ICacheRepository';
import { createClient, RedisClientType } from 'redis';
import { Logger } from '../../../utils/Logger';

export class RedisCacheRepository implements ICacheRepository {
    private client: RedisClientType;
    private logger: ILogger;
    private isConnected: boolean = false;

    constructor(redisUrl: string, logger: ILogger) {
        this.logger = logger;
        this.client = createClient({ url: redisUrl });

        this.client.on('error', (err) => {
            this.logger.error('Redis client error', { error: err });
        });

        this.client.on('connect', () => {
            this.isConnected = true;
            this.logger.info('Redis client connected');
        });
    }

    async connect(): Promise<void> {
        if (!this.isConnected) {
            await this.client.connect();
        }
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            this.logger.error('Failed to get from cache', { key, error });
            return null;
        }
    }

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
        try {
            const serialized = JSON.stringify(value);
            if (ttl) {
                await this.client.setEx(key, ttl, serialized);
            } else {
                await this.client.set(key, serialized);
            }
        } catch (error) {
            this.logger.error('Failed to set in cache', { key, error });
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.client.del(key);
        } catch (error) {
            this.logger.error('Failed to delete from cache', { key, error });
        }
    }

    async clear(pattern?: string): Promise<void> {
        try {
            if (pattern) {
                const keys = await this.client.keys(pattern);
                if (keys.length > 0) {
                    await this.client.del(keys);
                }
            } else {
                await this.client.flushDb();
            }
        } catch (error) {
            this.logger.error('Failed to clear cache', { pattern, error });
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            this.logger.error('Failed to check existence', { key, error });
            return false;
        }
    }

    async mget<T>(keys: string[]): Promise<(T | null)[]> {
        try {
            const values = await this.client.mGet(keys);
            return values.map(v => v ? JSON.parse(v) : null);
        } catch (error) {
            this.logger.error('Failed to mget from cache', { keys, error });
            return keys.map(() => null);
        }
    }

    async mset<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
        try {
            const pipeline = this.client.multi();

            for (const entry of entries) {
                const serialized = JSON.stringify(entry.value);
                if (entry.ttl) {
                    pipeline.setEx(entry.key, entry.ttl, serialized);
                } else {
                    pipeline.set(entry.key, serialized);
                }
            }

            await pipeline.exec();
        } catch (error) {
            this.logger.error('Failed to mset in cache', { error });
        }
    }

    async disconnect(): Promise<void> {
        if (this.isConnected) {
            await this.client.quit();
            this.isConnected = false;
        }
    }
}
