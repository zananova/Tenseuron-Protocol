/**
 * Logger Interface
 * 
 * Simple logging interface that protocol services use.
 * Implementations can use Winston, console, or any other logging system.
 */

export interface ILogger {
    debug(message: string, meta?: any): void;
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, meta?: any): void;
    child?(additionalContext: string): ILogger;
}

/**
 * Console Logger - Default implementation
 * Works in both Node.js and Workers environments
 */
export class ConsoleLogger implements ILogger {
    constructor(private context: string = 'Protocol') { }

    debug(message: string, meta?: any): void {
        console.debug(`[DEBUG] [${this.context}] ${message}`, meta || '');
    }

    info(message: string, meta?: any): void {
        console.log(`[INFO] [${this.context}] ${message}`, meta || '');
    }

    warn(message: string, meta?: any): void {
        console.warn(`[WARN] [${this.context}] ${message}`, meta || '');
    }

    error(message: string, meta?: any): void {
        console.error(`[ERROR] [${this.context}] ${message}`, meta || '');
    }

    child(additionalContext: string): ILogger {
        return new ConsoleLogger(`${this.context}:${additionalContext}`);
    }
}
