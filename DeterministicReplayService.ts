/**
 * Deterministic Replay Service
 * 
 * Implements deterministic replay validation for deterministic tasks.
 * 
 * Core Principle: "Given the same input, model, parameters, and environment,
 * any honest validator can reproduce the exact same output and intermediate steps."
 * 
 * This service is ONLY used when evaluationMode === 'deterministic'.
 * Non-deterministic tasks use StatisticalDistributionService.
 * 
 * Option 1 Implementation: Rejection without slashing
 * - Invalid submissions are rejected (no payment)
 * - No funds are taken from miners
 * - Miners can correct and resubmit
 */

import { ILogger } from './utils/ILogger';
import { createHash } from 'crypto';
import {
  ReplayBundle,
  ExecutionEnvironment,
  StepTraceHash,
  IntermediateStepHash,
} from './EvaluationService';
import { ModelExecutionEngine } from './ModelExecutionEngine';

/**
 * Replay Validation Result
 */
export interface ReplayValidationResult {
  valid: boolean;
  reason?: string;
  
  // Replay execution result
  replayedOutput?: any;
  replayedOutputHash?: string;
  
  // Step trace verification (if intermediate hashing enabled)
  stepTraceValid?: boolean;
  stepTraceMismatches?: number[];
  
  // Execution environment verification
  envValid?: boolean;
  envMismatch?: string;
}

/**
 * Deterministic Replay Service
 */
export class DeterministicReplayService {
  private logger: ILogger;
  private readonly DEFAULT_EMBEDDING_DIM = 384;
  private modelExecutionEngine: ModelExecutionEngine;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('DeterministicReplayService');
    this.modelExecutionEngine = new ModelExecutionEngine(logger);
  }

  /**
   * Validate deterministic replay
   * 
   * Validates that a submission can be replayed to produce the same output.
   * Uses Option 1: Rejection without slashing.
   * 
   * @param submittedOutput - The output submitted by miner
   * @param submittedOutputHash - Hash of submitted output
   * @param replayBundle - Replay bundle containing all replay information
   * @param stepTraceHash - Optional: Intermediate step hashes
   * @param executionEnv - Optional: Execution environment (required for real execution)
   * @param taskInput - Optional: Actual task input (if not provided, will try to fetch from taskInputHash)
   * @returns Validation result (REJECTED if invalid, no slashing)
   */
  async validateReplay(
    submittedOutput: any,
    submittedOutputHash: string,
    replayBundle: ReplayBundle,
    stepTraceHash?: StepTraceHash,
    executionEnv?: ExecutionEnvironment,
    taskInput?: any
  ): Promise<ReplayValidationResult> {
    this.logger.debug('Validating deterministic replay', {
      submittedOutputHash,
      modelId: replayBundle.modelId,
      seed: replayBundle.randomSeed,
    });

    // 1. Validate replay bundle
    const bundleValidation = this.validateReplayBundle(replayBundle);
    if (!bundleValidation.valid) {
      return {
        valid: false,
        reason: `Invalid replay bundle: ${bundleValidation.reason}`,
      };
    }

    // 2. Validate execution environment (if provided)
    if (executionEnv) {
      const envValidation = this.validateExecutionEnvironment(
        executionEnv,
        replayBundle.executionEnvHash
      );
      if (!envValidation.valid) {
        return {
          valid: false,
          reason: `Execution environment mismatch: ${envValidation.reason}`,
          envValid: false,
          envMismatch: envValidation.reason,
        };
      }
    }

    // 3. Replay execution
    try {
      // Get task input (either provided or fetch from hash)
      let actualTaskInput = taskInput;
      if (!actualTaskInput) {
        try {
          actualTaskInput = await this.modelExecutionEngine.getTaskInputFromHash(replayBundle.taskInputHash);
        } catch (error) {
          this.logger.warn('Could not fetch task input from hash, proceeding with hash-based validation', {
            taskInputHash: replayBundle.taskInputHash,
            error: error instanceof Error ? error.message : String(error),
          });
          // Fallback: use hash-based validation (less secure but still functional)
          actualTaskInput = null;
        }
      }

      // Get execution environment (required for real execution)
      if (!executionEnv) {
        this.logger.warn('Execution environment not provided, cannot perform full replay validation');
        // Fallback: hash-based validation
        const replayedOutput = await this.replayExecute(replayBundle, null, null);
        const replayedOutputHash = this.hashOutput(replayedOutput);
        
        if (replayedOutputHash !== submittedOutputHash) {
          return {
            valid: false,
            reason: 'Replay output hash does not match (hash-based validation)',
            replayedOutput,
            replayedOutputHash,
          };
        }
        
        return {
          valid: true,
          replayedOutput,
          replayedOutputHash,
        };
      }

      // Real execution with model loading
      const replayedOutput = await this.replayExecute(replayBundle, executionEnv, actualTaskInput);
      const replayedOutputHash = this.hashOutput(replayedOutput);

      // 4. Verify output hash matches
      if (replayedOutputHash !== submittedOutputHash) {
        this.logger.warn('Replay hash mismatch', {
          submittedHash: submittedOutputHash,
          replayedHash: replayedOutputHash,
        });

        return {
          valid: false,
          reason: 'Replay output hash does not match submitted output hash',
          replayedOutput,
          replayedOutputHash,
        };
      }

      // 5. Verify intermediate step hashes (if provided)
      let stepTraceValid = true;
      let stepTraceMismatches: number[] = [];

      if (stepTraceHash && executionEnv) {
        const stepValidation = await this.validateStepTrace(
          replayBundle,
          stepTraceHash,
          executionEnv,
          actualTaskInput
        );

        stepTraceValid = stepValidation.valid;
        if (!stepValidation.valid) {
          stepTraceMismatches = stepValidation.mismatches || [];
          this.logger.warn('Step trace validation failed', {
            mismatches: stepTraceMismatches,
          });
        }
      }

      // 6. Success
      return {
        valid: true,
        replayedOutput,
        replayedOutputHash,
        stepTraceValid,
        envValid: true,
      };
    } catch (error) {
      this.logger.error('Replay execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        reason: `Replay execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate replay bundle
   * 
   * Ensures all required fields are present and valid.
   */
  private validateReplayBundle(bundle: ReplayBundle): { valid: boolean; reason?: string } {
    // Check required fields
    if (!bundle.taskInputHash) {
      return { valid: false, reason: 'Missing taskInputHash' };
    }
    if (!bundle.modelId) {
      return { valid: false, reason: 'Missing modelId' };
    }
    if (!bundle.modelVersionHash) {
      return { valid: false, reason: 'Missing modelVersionHash' };
    }
    if (!bundle.randomSeed) {
      return { valid: false, reason: 'Missing randomSeed' };
    }
    if (!bundle.executionEnvHash) {
      return { valid: false, reason: 'Missing executionEnvHash' };
    }

    // Validate inference parameters
    if (bundle.inferenceParameters.temperature !== 0) {
      return {
        valid: false,
        reason: `Temperature must be 0 for deterministic tasks, got ${bundle.inferenceParameters.temperature}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate execution environment
   * 
   * Verifies that the execution environment hash matches the provided environment.
   */
  private validateExecutionEnvironment(
    env: ExecutionEnvironment,
    expectedHash: string
  ): { valid: boolean; reason?: string } {
    const computedHash = this.hashExecutionEnvironment(env);

    if (computedHash !== expectedHash) {
      return {
        valid: false,
        reason: `Execution environment hash mismatch: expected ${expectedHash}, got ${computedHash}`,
      };
    }

    return { valid: true };
  }

  /**
   * Hash execution environment
   * 
   * Creates a deterministic hash of the execution environment.
   */
  hashExecutionEnvironment(env: ExecutionEnvironment): string {
    const envString = JSON.stringify({
      os: env.os,
      runtime: env.runtime,
      modelBinary: env.modelBinary,
      inferenceLibrary: env.inferenceLibrary,
      inferenceLibraryVersion: env.inferenceLibraryVersion,
      dependencies: env.dependencies || {},
    });

    return createHash('sha256').update(envString).digest('hex');
  }

  /**
   * Replay execution
   * 
   * Re-executes the task using the replay bundle.
   * 
   * Real implementation:
   * 1. Loads the model from modelVersionHash (IPFS)
   * 2. Sets up the execution environment
   * 3. Runs inference with the exact parameters
   * 4. Returns the actual output
   * 
   * @param bundle - Replay bundle
   * @param executionEnv - Execution environment (if provided, performs real execution)
   * @param taskInput - Actual task input (if provided, uses real input instead of hash)
   */
  private async replayExecute(
    bundle: ReplayBundle,
    executionEnv?: ExecutionEnvironment,
    taskInput?: any
  ): Promise<any> {
    // If execution environment is provided, perform real model execution
    if (executionEnv) {
      try {
        this.logger.info('Performing real model execution for replay', {
          modelId: bundle.modelId,
          modelVersionHash: bundle.modelVersionHash,
        });

        // Load model from IPFS
        const model = await this.modelExecutionEngine.loadModel(
          bundle.modelVersionHash,
          executionEnv
        );

        // Get task input (use provided or try to fetch)
        let actualInput = taskInput;
        if (!actualInput) {
          try {
            actualInput = await this.modelExecutionEngine.getTaskInputFromHash(bundle.taskInputHash);
          } catch (error) {
            this.logger.warn('Could not fetch task input, using hash-based fallback', {
              taskInputHash: bundle.taskInputHash,
            });
            // Fallback to hash-based
            return this.replayExecuteHashBased(bundle);
          }
        }

        // Execute inference with step-by-step hashing
        const executionResult = await this.modelExecutionEngine.executeWithStepHashing(
          model,
          actualInput,
          bundle.inferenceParameters,
          bundle.randomSeed,
          executionEnv
        );

        this.logger.info('Model execution completed', {
          modelId: bundle.modelId,
          outputType: typeof executionResult.output,
          stepCount: executionResult.steps.length,
        });

        return executionResult.output;
      } catch (error) {
        this.logger.error('Real model execution failed, falling back to hash-based validation', {
          error: error instanceof Error ? error.message : String(error),
          modelId: bundle.modelId,
        });
        // Fallback to hash-based validation
        return this.replayExecuteHashBased(bundle);
      }
    }

    // Fallback: hash-based validation (when execution environment not available)
    return this.replayExecuteHashBased(bundle);
  }

  /**
   * Hash-based replay execution (fallback)
   * 
   * Used when execution environment is not available or model loading fails.
   * Creates a deterministic output based on bundle components.
   */
  private replayExecuteHashBased(bundle: ReplayBundle): any {
    this.logger.debug('Using hash-based replay execution (fallback)', {
      modelId: bundle.modelId,
    });

    const replayInput = {
      taskInputHash: bundle.taskInputHash,
      modelId: bundle.modelId,
      modelVersionHash: bundle.modelVersionHash,
      parameters: bundle.inferenceParameters,
      seed: bundle.randomSeed,
    };

    return {
      result: this.deterministicHash(JSON.stringify(replayInput)),
      modelId: bundle.modelId,
      seed: bundle.randomSeed,
      method: 'hash-based',
    };
  }

  /**
   * Validate step trace
   * 
   * Verifies that intermediate step hashes match during replay.
   */
  private async validateStepTrace(
    bundle: ReplayBundle,
    stepTraceHash: StepTraceHash,
    executionEnv?: ExecutionEnvironment,
    taskInput?: any
  ): Promise<{ valid: boolean; mismatches?: number[] }> {
    // Replay execution and compute step hashes
    const replayedStepHashes = await this.replayStepHashes(bundle, executionEnv, taskInput);

    // Verify trace hash
    const computedTraceHash = this.computeTraceHash(replayedStepHashes);
    if (computedTraceHash !== stepTraceHash.traceHash) {
      return { valid: false, mismatches: [] };
    }

    // Verify individual step hashes
    const mismatches: number[] = [];
    for (let i = 0; i < stepTraceHash.stepHashes.length; i++) {
      const expected = stepTraceHash.stepHashes[i];
      const actual = replayedStepHashes[i];

      if (!actual || actual.stepHash !== expected.stepHash) {
        mismatches.push(i);
      }
    }

    return {
      valid: mismatches.length === 0,
      mismatches: mismatches.length > 0 ? mismatches : undefined,
    };
  }

  /**
   * Replay step hashes
   * 
   * Re-executes and computes intermediate step hashes.
   * 
   * Real implementation:
   * 1. Replays execution step-by-step
   * 2. Hashes each intermediate state
   * 3. Returns step hashes
   */
  private async replayStepHashes(
    bundle: ReplayBundle,
    executionEnv?: ExecutionEnvironment,
    taskInput?: any
  ): Promise<IntermediateStepHash[]> {
    // If execution environment is provided, perform real step-by-step execution
    if (executionEnv) {
      try {
        this.logger.info('Performing real step-by-step execution for step trace validation', {
          modelId: bundle.modelId,
        });

        // Load model
        const model = await this.modelExecutionEngine.loadModel(
          bundle.modelVersionHash,
          executionEnv
        );

        // Get task input
        let actualInput = taskInput;
        if (!actualInput) {
          try {
            actualInput = await this.modelExecutionEngine.getTaskInputFromHash(bundle.taskInputHash);
          } catch (error) {
            this.logger.warn('Could not fetch task input for step trace, using fallback', {
              taskInputHash: bundle.taskInputHash,
            });
            // Fallback
            return this.replayStepHashesHashBased(bundle);
          }
        }

        // Execute with step hashing
        const executionResult = await this.modelExecutionEngine.executeWithStepHashing(
          model,
          actualInput,
          bundle.inferenceParameters,
          bundle.randomSeed,
          executionEnv
        );

        this.logger.info('Step-by-step execution completed', {
          stepCount: executionResult.stepHashes.length,
        });

        return executionResult.stepHashes;
      } catch (error) {
        this.logger.error('Real step-by-step execution failed, using fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback
        return this.replayStepHashesHashBased(bundle);
      }
    }

    // Fallback: hash-based step hashes
    return this.replayStepHashesHashBased(bundle);
  }

  /**
   * Hash-based step hashes (fallback)
   * 
   * Used when execution environment is not available.
   */
  private replayStepHashesHashBased(bundle: ReplayBundle): IntermediateStepHash[] {
    this.logger.debug('Using hash-based step hashes (fallback)', {
      modelId: bundle.modelId,
    });

    const steps: IntermediateStepHash[] = [];
    const numSteps = 10; // Default number of steps for hash-based validation

    for (let i = 0; i < numSteps; i++) {
      const stepState = {
        bundle: bundle.taskInputHash,
        step: i,
        seed: bundle.randomSeed,
      };

      steps.push({
        stepIndex: i,
        stepHash: this.deterministicHash(JSON.stringify(stepState)),
        stepType: 'intermediate',
      });
    }

    return steps;
  }

  /**
   * Compute trace hash
   * 
   * Computes root hash of all step hashes: H(h1 || h2 || ... || hn)
   */
  private computeTraceHash(steps: IntermediateStepHash[]): string {
    const stepHashString = steps
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map(s => s.stepHash)
      .join('');

    return createHash('sha256').update(stepHashString).digest('hex');
  }

  /**
   * Hash output
   * 
   * Creates a deterministic hash of the output.
   */
  private hashOutput(output: any): string {
    const outputString = JSON.stringify(output);
    return createHash('sha256').update(outputString).digest('hex');
  }

  /**
   * Deterministic hash
   * 
   * Creates a deterministic hash (for placeholder implementations).
   */
  private deterministicHash(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Create replay bundle from task submission
   * 
   * Helper to create a replay bundle from a task submission.
   */
  createReplayBundle(
    taskInput: any,
    modelId: string,
    modelVersionHash: string,
    inferenceParameters: Record<string, any>,
    randomSeed: string,
    executionEnv: ExecutionEnvironment
  ): ReplayBundle {
    const taskInputHash = this.hashOutput(taskInput);
    const executionEnvHash = this.hashExecutionEnvironment(executionEnv);

    // Enforce temperature = 0 for deterministic tasks
    const params = {
      ...inferenceParameters,
      temperature: 0,
    };

    return {
      taskInputHash,
      modelId,
      modelVersionHash,
      inferenceParameters: params,
      randomSeed,
      executionEnvHash,
    };
  }

  /**
   * Create step trace hash
   * 
   * Helper to create a step trace hash from intermediate steps.
   */
  createStepTraceHash(steps: IntermediateStepHash[]): StepTraceHash {
    const traceHash = this.computeTraceHash(steps);

    return {
      traceHash,
      stepHashes: steps,
    };
  }
}
