/**
 * Workers-Only Service Factory
 * Does NOT import Prisma - only D1 adapters and Workers-compatible code
 * 
 * This factory is specifically for Cloudflare Workers deployment.
 * For Node.js with Prisma, use ProtocolServiceFactory instead.
 */

import { ILogger } from './utils/ILogger';
import { ProtocolServiceRefactored, ProtocolServiceDependencies } from './ProtocolServiceRefactored';
import { DecentralizedRegistryService } from './DecentralizedRegistryService';
import { SettlementService } from './SettlementService';
import { RiskScoringService } from './RiskScoringService';
import { MoneyFlowService } from './MoneyFlowService';

// Import ONLY D1 adapters (no Prisma)
import { D1NetworkRepository } from './adapters/database/D1NetworkRepository';
import { CloudflareR2StorageProvider } from './adapters/storage/CloudflareR2StorageProvider';

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

/**
 * Minimal ScamDefenseService for Workers (no Prisma)
 * Only provides basic functionality without database access
 */
class WorkersScamDefenseService {
    constructor(private logger: ILogger) { }

    async analyzeProject(projectData: any): Promise<any> {
        this.logger.info('ScamDefense: Basic analysis (Workers mode)');
        return {
            riskScore: 0,
            flags: [],
            isScam: false
        };
    }

    async checkAddress(address: string): Promise<any> {
        return {
            isFlagged: false,
            riskLevel: 'low'
        };
    }
}

export class WorkersServiceFactory {
    /**
     * Create a ProtocolService for Cloudflare Workers with D1
     * Does NOT import or use Prisma - Workers-compatible only
     */
    static createForWorkers(
        logger: ILogger,
        env: {
            DB: D1Database;
            R2_BUCKET?: R2Bucket;
            POLYGON_RPC_URL?: string;
            DEPLOYER_PRIVATE_KEY?: string;
        }
    ): ProtocolServiceRefactored {
        // Create D1 network repository
        const networkRepo = new D1NetworkRepository(env.DB, logger);

        // Create R2 storage provider (or null if not available)
        const storage = env.R2_BUCKET
            ? new CloudflareR2StorageProvider(env.R2_BUCKET, logger)
            : null;

        // For blockchain, we'll use a minimal HTTP-based provider
        // This avoids importing ethers.js
        const blockchain = null; // Will be handled by routes directly if needed

        // Create other services (Workers-compatible versions)
        const decentralizedRegistry = new DecentralizedRegistryService(logger);
        const settlementService = new SettlementService(logger);
        const scamDefenseService = new WorkersScamDefenseService(logger);
        const riskScoringService = new RiskScoringService(logger);
        const moneyFlowService = new MoneyFlowService(logger);

        // Create dependencies object
        const dependencies: ProtocolServiceDependencies = {
            networkRepo,
            storage: storage as any,
            blockchain: blockchain as any,
            decentralizedRegistry,
            settlementService,
            scamDefenseService: scamDefenseService as any,
            riskScoringService,
            moneyFlowService,
        };

        // Create and return ProtocolService
        return new ProtocolServiceRefactored(logger, dependencies);
    }
}
