/**
 * AI Module Repository Interface
 * 
 * Protocol uses this to fetch AI Module data.
 * Implementations can use Prisma, D1, or any other database.
 */

import { AIModule } from '../types';

export interface IAIModuleRepository {
    /**
     * Get module by moduleId
     */
    getModuleById(moduleId: string): Promise<AIModule | null>;

    /**
     * Get all active modules
     */
    getAllModules(): Promise<AIModule[]>;

    /**
     * Get modules by category
     */
    getModulesByCategory(category: string): Promise<AIModule[]>;

    /**
     * Increment module usage statistics
     */
    incrementModuleUsage(moduleId: string, tasksIncrement?: bigint): Promise<void>;
}
