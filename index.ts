/**
 * Tenseuron Protocol - Database Agnostic & Runtime Agnostic
 * 
 * This package provides a flexible, adapter-based architecture that works with:
 * - Any database (Prisma, D1, Supabase, MongoDB, etc.)
 * - Any runtime (Node.js, Cloudflare Workers, Deno, Bun)
 * - Any storage (IPFS, Arweave, S3, R2)
 * - Any blockchain (Ethereum, Polygon, Solana, etc.)
 */

// Core Interfaces
export * from './interfaces';

// Types
export * from './types';

// Utilities
export * from './utils';

// Adapters
export * from './adapters';

// Factory
export * from './factory';

// Convenience function for quick setup
import { ProtocolFactory, ProtocolConfig } from './factory';

/**
 * Create a protocol instance with automatic runtime detection
 * 
 * @example
 * // Zero-config (auto-detects runtime)
 * const protocol = createProtocol();
 * 
 * @example
 * // With custom configuration
 * const protocol = createProtocol({
 *   database: { type: 'd1', instance: env.DB },
 *   storage: { type: 'r2', config: env.R2_BUCKET },
 *   blockchain: {
 *     type: 'polygon',
 *     rpcUrl: 'https://polygon-rpc.com',
 *     privateKey: env.DEPLOYER_PRIVATE_KEY
 *   }
 * });
 */
export function createProtocol(config?: ProtocolConfig) {
    return ProtocolFactory.create(config);
}

/**
 * Get runtime recommendations
 */
export function getRecommendations() {
    return ProtocolFactory.getRecommendations();
}
