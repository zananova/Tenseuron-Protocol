/**
 * Runtime Detector
 * Automatically detects the runtime environment and suggests appropriate adapters
 */

export type RuntimeType = 'node' | 'workers' | 'deno' | 'bun';
export type DatabaseType = 'prisma' | 'd1' | 'supabase' | 'mongo';
export type StorageType = 'ipfs' | 'r2' | 'arweave' | 's3';
export type BlockchainType = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'solana';

export class RuntimeDetector {
    /**
     * Detect the current runtime environment
     */
    static detectRuntime(): RuntimeType {
        // Check for Deno
        if (typeof (globalThis as any).Deno !== 'undefined') {
            return 'deno';
        }

        // Check for Bun
        if (typeof (globalThis as any).Bun !== 'undefined') {
            return 'bun';
        }

        // Check for Cloudflare Workers
        // Workers have caches API and no process.versions
        if (
            typeof caches !== 'undefined' &&
            typeof (globalThis as any).EdgeRuntime !== 'undefined'
        ) {
            return 'workers';
        }

        // Default to Node.js
        return 'node';
    }

    /**
     * Get recommended database type for current runtime
     */
    static getDefaultDatabase(): DatabaseType {
        const runtime = this.detectRuntime();
        switch (runtime) {
            case 'workers':
                return 'd1';
            case 'deno':
                return 'supabase';
            case 'bun':
                return 'prisma'; // Bun supports Prisma
            default:
                return 'prisma';
        }
    }

    /**
     * Get recommended storage type for current runtime
     */
    static getDefaultStorage(): StorageType {
        const runtime = this.detectRuntime();
        switch (runtime) {
            case 'workers':
                return 'r2';
            default:
                return 'ipfs';
        }
    }

    /**
     * Get recommended blockchain type (defaults to Polygon for low fees)
     */
    static getDefaultBlockchain(): BlockchainType {
        return 'polygon';
    }

    /**
     * Check if a specific feature is available in current runtime
     */
    static hasFeature(feature: 'fs' | 'crypto' | 'buffer' | 'streams'): boolean {
        const runtime = this.detectRuntime();

        switch (feature) {
            case 'fs':
                return runtime === 'node' || runtime === 'bun' || runtime === 'deno';
            case 'crypto':
                return true; // All runtimes have crypto
            case 'buffer':
                return runtime === 'node' || runtime === 'bun';
            case 'streams':
                return true; // All modern runtimes support streams
            default:
                return false;
        }
    }

    /**
     * Get runtime-specific recommendations
     */
    static getRecommendations(): {
        runtime: RuntimeType;
        database: DatabaseType;
        storage: StorageType;
        blockchain: BlockchainType;
    } {
        return {
            runtime: this.detectRuntime(),
            database: this.getDefaultDatabase(),
            storage: this.getDefaultStorage(),
            blockchain: this.getDefaultBlockchain(),
        };
    }
}
