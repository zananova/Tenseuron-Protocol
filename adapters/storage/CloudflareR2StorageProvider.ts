/**
 * Cloudflare R2 Storage Provider
 * Adapter for Cloudflare R2 to implement IStorageProvider
 */

import { IStorageProvider, StorageMetadata } from '../../interfaces';

export class CloudflareR2StorageProvider implements IStorageProvider {
    constructor(private bucket: R2Bucket) { }

    async upload(data: any, metadata?: StorageMetadata): Promise<string> {
        const key = metadata?.name || `${Date.now()}-${Math.random().toString(36).substring(2)}`;
        const content = typeof data === 'string' ? data : JSON.stringify(data);

        await this.bucket.put(key, content, {
            httpMetadata: {
                contentType: metadata?.type || 'application/json',
            },
            customMetadata: metadata
                ? Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)]))
                : undefined,
        });

        return key;
    }

    async download(key: string): Promise<any> {
        const object = await this.bucket.get(key);
        if (!object) {
            throw new Error(`Object not found: ${key}`);
        }

        const text = await object.text();
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    async pin(key: string, name?: string): Promise<void> {
        // R2 doesn't need pinning - all objects are persistent
        // This is a no-op for compatibility
    }

    async unpin(key: string): Promise<void> {
        // No-op for R2
    }

    async exists(key: string): Promise<boolean> {
        const object = await this.bucket.head(key);
        return object !== null;
    }

    getType(): 'ipfs' | 'arweave' | 's3' | 'r2' | 'custom' {
        return 'r2';
    }
}
