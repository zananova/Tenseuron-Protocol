/**
 * Protocol Service Factory
 * Helper to create ProtocolService instances with proper dependency injection
 */

import { ILogger } from './utils/ILogger';
import { ProtocolServiceRefactored, ProtocolServiceDependencies } from './ProtocolServiceRefactored';
import { DecentralizedRegistryService } from './DecentralizedRegistryService';
import { SettlementService } from './SettlementService';
import { ScamDefenseService } from './ScamDefenseService';
import { RiskScoringService } from './RiskScoringService';
import { MoneyFlowService } from './MoneyFlowService';
import { createProtocol, ProtocolConfig } from './index';
import { PrismaClient } from '@prisma/client';

// Cloudflare Workers types
declare global {
    interface D1Database {
        prepare(query: string): D1PreparedStatement;
        dump(): Promise<ArrayBuffer>;
        batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
        exec(query: string): Promise<D1ExecResult>;
    }

    interface D1PreparedStatement {
        bind(...values: any[]): D1PreparedStatement;
        first<T = unknown>(colName?: string): Promise<T | null>;
        run<T = unknown>(): Promise<D1Result<T>>;
        all<T = unknown>(): Promise<D1Result<T>>;
        raw<T = unknown>(): Promise<T[]>;
    }

    interface D1Result<T = unknown> {
        results?: T[];
        success: boolean;
        meta: any;
        error?: string;
    }

    interface D1ExecResult {
        count: number;
        duration: number;
    }

    interface R2Bucket {
        head(key: string): Promise<R2Object | null>;
        get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
        put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object | null>;
        delete(keys: string | string[]): Promise<void>;
        list(options?: R2ListOptions): Promise<R2Objects>;
    }

    interface R2Object {
        key: string;
        version: string;
        size: number;
        etag: string;
        httpEtag: string;
        checksums: R2Checksums;
        uploaded: Date;
        httpMetadata?: R2HTTPMetadata;
        customMetadata?: Record<string, string>;
    }

    interface R2ObjectBody extends R2Object {
        body: ReadableStream;
        bodyUsed: boolean;
        arrayBuffer(): Promise<ArrayBuffer>;
        text(): Promise<string>;
        json<T = unknown>(): Promise<T>;
        blob(): Promise<Blob>;
    }

    interface R2GetOptions {
        onlyIf?: R2Conditional;
        range?: R2Range;
    }

    interface R2PutOptions {
        httpMetadata?: R2HTTPMetadata;
        customMetadata?: Record<string, string>;
        md5?: ArrayBuffer | string;
        sha1?: ArrayBuffer | string;
        sha256?: ArrayBuffer | string;
        sha384?: ArrayBuffer | string;
        sha512?: ArrayBuffer | string;
    }

    interface R2ListOptions {
        limit?: number;
        prefix?: string;
        cursor?: string;
        delimiter?: string;
        startAfter?: string;
        include?: ('httpMetadata' | 'customMetadata')[];
    }

    interface R2Objects {
        objects: R2Object[];
        truncated: boolean;
        cursor?: string;
        delimitedPrefixes: string[];
    }

    interface R2HTTPMetadata {
        contentType?: string;
        contentLanguage?: string;
        contentDisposition?: string;
        contentEncoding?: string;
        cacheControl?: string;
        cacheExpiry?: Date;
    }

    interface R2Checksums {
        md5?: ArrayBuffer;
        sha1?: ArrayBuffer;
        sha256?: ArrayBuffer;
        sha384?: ArrayBuffer;
        sha512?: ArrayBuffer;
    }

    interface R2Conditional {
        etagMatches?: string;
        etagDoesNotMatch?: string;
        uploadedBefore?: Date;
        uploadedAfter?: Date;
    }

    interface R2Range {
        offset?: number;
        length?: number;
        suffix?: number;
    }
}

export class ProtocolServiceFactory {
    /**
     * Create a ProtocolService instance with automatic configuration
     * 
     * @param logger Logger instance
     * @param config Protocol configuration (database, storage, blockchain)
     * @param prisma Optional Prisma client for services that still need it
     */
    static create(
        logger: ILogger,
        config?: ProtocolConfig,
        prisma?: PrismaClient
    ): ProtocolServiceRefactored {
        // Create repositories and providers using the abstraction layer
        const { networkRepo, storage, blockchain } = createProtocol(config);

        // Create other services (these will be refactored in future iterations)
        const decentralizedRegistry = new DecentralizedRegistryService(logger);
        const settlementService = new SettlementService(logger);
        const scamDefenseService = new ScamDefenseService(logger, prisma);
        const riskScoringService = new RiskScoringService(logger);
        const moneyFlowService = new MoneyFlowService(logger);

        // Create dependencies object
        const dependencies: ProtocolServiceDependencies = {
            networkRepo,
            storage,
            blockchain,
            decentralizedRegistry,
            settlementService,
            scamDefenseService,
            riskScoringService,
            moneyFlowService,
        };

        // Create and return ProtocolService
        return new ProtocolServiceRefactored(logger, dependencies);
    }

    /**
     * Create a ProtocolService for Node.js with Prisma
     */
    static createForNode(logger: ILogger, prisma: PrismaClient): ProtocolServiceRefactored {
        return this.create(
            logger,
            {
                database: { type: 'prisma', instance: prisma },
                storage: { type: 'ipfs' },
                blockchain: {
                    type: 'polygon',
                    rpcUrl: process.env.POLYGON_RPC_URL || 'https://rpc.ankr.com/polygon',
                    privateKey: process.env.DEPLOYER_PRIVATE_KEY || '',
                },
            },
            prisma
        );
    }

    /**
     * Create a ProtocolService for Cloudflare Workers with D1
     */
    static createForWorkers(
        logger: ILogger,
        env: {
            DB: D1Database;
            R2_BUCKET: R2Bucket;
            POLYGON_RPC_URL?: string;
            DEPLOYER_PRIVATE_KEY: string;
        }
    ): ProtocolServiceRefactored {
        return this.create(logger, {
            database: { type: 'd1', instance: env.DB },
            storage: { type: 'r2', config: env.R2_BUCKET },
            blockchain: {
                type: 'polygon',
                rpcUrl: env.POLYGON_RPC_URL || 'https://rpc.ankr.com/polygon',
                privateKey: env.DEPLOYER_PRIVATE_KEY,
            },
        });
    }
}
