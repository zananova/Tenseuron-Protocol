/**
 * Task Service Factory
 * 
 * Creates TaskService instances with appropriate adapters for different runtimes
 */

import { ILogger } from './utils/ILogger';
import { TaskServiceRefactored, TaskServiceDependencies } from './TaskServiceRefactored';
import { PrismaTaskRepository } from './adapters/database/PrismaTaskRepository';
import { D1TaskRepository } from './adapters/database/D1TaskRepository';
import { EvaluationService } from './EvaluationService';
import { SybilResistanceService } from './SybilResistanceService';
import { OnChainValidatorService } from './OnChainValidatorService';
import { TaskStateIPFSService } from './TaskStateIPFSService';
import { SignatureVerificationService } from './SignatureVerificationService';
import { JSONSchemaValidator } from './JSONSchemaValidator';
import { PrismaClient } from '@prisma/client';

// Cloudflare D1 types
export interface D1Database {
    prepare(query: string): any;
    dump(): Promise<ArrayBuffer>;
    batch<T = unknown>(statements: any[]): Promise<any[]>;
    exec(query: string): Promise<any>;
}

export class TaskServiceFactory {
    /**
     * Create TaskService for Node.js environment (Prisma)
     */
    static createForNode(
        logger: ILogger,
        prisma: PrismaClient,
        p2pService?: any
    ): TaskServiceRefactored {
        const taskRepository = new PrismaTaskRepository(prisma);

        const dependencies: TaskServiceDependencies = {
            taskRepository,
            evaluationService: new EvaluationService(logger),
            sybilResistanceService: new SybilResistanceService(prisma, logger),
            onChainValidatorService: new OnChainValidatorService(logger),
            taskStateIPFSService: new TaskStateIPFSService(logger),
            signatureVerificationService: new SignatureVerificationService(logger),
            jsonSchemaValidator: new JSONSchemaValidator(logger),
            p2pService,
        };

        return new TaskServiceRefactored(logger, dependencies);
    }

    /**
     * Create TaskService for Cloudflare Workers environment (D1)
     */
    static createForWorkers(
        logger: ILogger,
        env: {
            DB: D1Database;
            [key: string]: any;
        },
        p2pService?: any
    ): TaskServiceRefactored {
        const taskRepository = new D1TaskRepository(env.DB);

        // Note: Some services still use Prisma internally
        // This will be refactored in Phase 7.3 (Anti-Gaming Services)
        const dependencies: TaskServiceDependencies = {
            taskRepository,
            evaluationService: new EvaluationService(logger),
            // TODO Phase 7.3: Refactor SybilResistanceService to use repository
            sybilResistanceService: new SybilResistanceService(
                {} as PrismaClient, // Temporary - will be refactored
                logger
            ),
            onChainValidatorService: new OnChainValidatorService(logger),
            taskStateIPFSService: new TaskStateIPFSService(logger),
            signatureVerificationService: new SignatureVerificationService(logger),
            jsonSchemaValidator: new JSONSchemaValidator(logger),
            p2pService,
        };

        return new TaskServiceRefactored(logger, dependencies);
    }
}
