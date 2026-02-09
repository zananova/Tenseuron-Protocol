/**
 * Storage Provider Interface
 * Storage-agnostic interface for content storage operations
 * Supports IPFS, Arweave, S3, R2, etc.
 */

export interface StorageMetadata {
    name?: string;
    type?: string;
    size?: number;
    [key: string]: any;
}

export interface IStorageProvider {
    /**
     * Upload data and return content identifier (CID/URL/Key)
     */
    upload(data: any, metadata?: StorageMetadata): Promise<string>;

    /**
     * Download data by content identifier
     */
    download(cid: string): Promise<any>;

    /**
     * Pin content for persistence (if applicable)
     */
    pin(cid: string, name?: string): Promise<void>;

    /**
     * Unpin content (if applicable)
     */
    unpin(cid: string): Promise<void>;

    /**
     * Check if content is pinned/exists
     */
    exists(cid: string): Promise<boolean>;

    /**
     * Get storage provider type
     */
    getType(): 'ipfs' | 'arweave' | 's3' | 'r2' | 'custom';
}
