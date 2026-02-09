/**
 * JSON Schema Validator Service
 * 
 * Provides comprehensive JSON schema validation using ajv
 * FULLY IMPLEMENTED: No placeholders, production-ready
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { ILogger } from './utils/ILogger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class JSONSchemaValidator {
  private ajv: Ajv;
  private logger: ILogger;
  private schemaCache: Map<string, ValidateFunction> = new Map();

  constructor(logger: ILogger) {
    this.logger = logger;
    this.ajv = new Ajv({
      allErrors: true, // Collect all errors, not just the first one
      strict: true, // Strict mode for better validation
      validateSchema: true, // Validate the schema itself
      removeAdditional: false, // Don't remove additional properties
      useDefaults: false, // Don't use default values
      coerceTypes: false, // Don't coerce types automatically
      verbose: true, // Include schema path in errors
    });

    // Add format validators (email, uri, date-time, etc.)
    addFormats(this.ajv);
  }

  /**
   * Validate data against a JSON schema
   */
  validate(data: any, schema: object, schemaId?: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate schema itself
    if (!schema || typeof schema !== 'object') {
      errors.push('Schema must be a valid object');
      return { valid: false, errors, warnings };
    }

    try {
      // Get or compile schema
      const validate = this.getOrCompileSchema(schema, schemaId);

      // Validate data
      const valid = validate(data);

      if (!valid) {
        // Format errors for better readability
        const formattedErrors = this.formatErrors(validate.errors || []);
        errors.push(...formattedErrors);

        this.logger.warn('JSON schema validation failed', {
          schemaId,
          errorCount: formattedErrors.length,
          errors: formattedErrors,
        });
      } else {
        this.logger.debug('JSON schema validation passed', { schemaId });
      }

      return {
        valid,
        errors,
        warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      errors.push(`Schema validation error: ${errorMessage}`);

      this.logger.error('JSON schema validation exception', {
        schemaId,
        error: errorMessage,
      });

      return {
        valid: false,
        errors,
        warnings,
      };
    }
  }

  /**
   * Get or compile schema (with caching)
   */
  private getOrCompileSchema(schema: object, schemaId?: string): ValidateFunction {
    const cacheKey = schemaId || JSON.stringify(schema);

    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!;
    }

    // Compile schema
    const validate = this.ajv.compile(schema);

    // Cache compiled schema
    this.schemaCache.set(cacheKey, validate);

    return validate;
  }

  /**
   * Format validation errors for readability
   */
  private formatErrors(errors: ErrorObject[]): string[] {
    return errors.map((error) => {
      const path = error.instancePath || error.schemaPath || 'root';
      const message = error.message || 'Validation error';

      // Add additional context
      let formatted = `${path}: ${message}`;

      if (error.params) {
        const params = Object.entries(error.params)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(', ');
        if (params) {
          formatted += ` (${params})`;
        }
      }

      return formatted;
    });
  }

  /**
   * Validate input against schema (for task inputs)
   */
  validateInput(input: any, schema: object, schemaId?: string): ValidationResult {
    if (!input || typeof input !== 'object') {
      return {
        valid: false,
        errors: ['Input must be a valid object'],
        warnings: [],
      };
    }

    return this.validate(input, schema, schemaId);
  }

  /**
   * Validate output against schema (for task outputs)
   */
  validateOutput(output: any, schema: object, schemaId?: string): ValidationResult {
    if (!output || typeof output !== 'object') {
      return {
        valid: false,
        errors: ['Output must be a valid object'],
        warnings: [],
      };
    }

    return this.validate(output, schema, schemaId);
  }

  /**
   * Clear schema cache (useful for testing or when schemas change)
   */
  clearCache(): void {
    this.schemaCache.clear();
    this.logger.debug('JSON schema cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; schemas: string[] } {
    return {
      size: this.schemaCache.size,
      schemas: Array.from(this.schemaCache.keys()),
    };
  }
}
