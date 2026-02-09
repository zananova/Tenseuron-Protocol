/**
 * Model Execution Engine
 * 
 * Loads models from IPFS and executes inference with step-by-step hashing.
 * Supports multiple model types: transformers, ONNX, etc.
 */

import { ILogger } from './utils/ILogger';
import { createHash } from 'crypto';
import axios from 'axios';
import { ReplayBundle, ExecutionEnvironment, IntermediateStepHash } from './EvaluationService';

/**
 * Model Metadata
 */
export interface ModelMetadata {
  modelId: string;
  modelVersionHash: string;
  modelType: 'transformers' | 'onnx' | 'tensorflow' | 'pytorch' | 'custom';
  modelFormat: 'safetensors' | 'pytorch' | 'onnx' | 'huggingface' | 'custom';
  modelPath?: string; // IPFS CID or URL
  configPath?: string; // IPFS CID or URL for config
  tokenizerPath?: string; // IPFS CID or URL for tokenizer
  dependencies: {
    [key: string]: string;
  };
}

/**
 * Execution Step
 */
export interface ExecutionStep {
  stepIndex: number;
  stepType: 'tokenization' | 'forward_pass' | 'decoding' | 'postprocessing' | 'custom';
  state: any; // Intermediate state
  output?: any; // Partial output at this step
}

/**
 * Model Execution Result
 */
export interface ModelExecutionResult {
  output: any;
  steps: ExecutionStep[];
  stepHashes: IntermediateStepHash[];
}

/**
 * Model Execution Engine
 */
export class ModelExecutionEngine {
  private logger: ILogger;
  private modelCache: Map<string, any> = new Map();
  private ipfsGateway: string;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('ModelExecutionEngine');
    this.ipfsGateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
  }

  /**
   * Load model from IPFS using modelVersionHash
   */
  async loadModel(modelVersionHash: string, executionEnv: ExecutionEnvironment): Promise<any> {
    // Check cache first
    const cacheKey = `${modelVersionHash}-${executionEnv.inferenceLibrary}`;
    if (this.modelCache.has(cacheKey)) {
      this.logger.debug('Model loaded from cache', { modelVersionHash });
      return this.modelCache.get(cacheKey);
    }

    try {
      // Fetch model metadata from IPFS
      const modelMetadata = await this.fetchModelMetadata(modelVersionHash);
      if (!modelMetadata) {
        throw new Error(`Model metadata not found for hash: ${modelVersionHash}`);
      }

      // Load model based on type
      let model: any;
      switch (modelMetadata.modelType) {
        case 'transformers':
          model = await this.loadTransformersModel(modelMetadata, executionEnv);
          break;
        case 'onnx':
          model = await this.loadONNXModel(modelMetadata, executionEnv);
          break;
        case 'pytorch':
          model = await this.loadPyTorchModel(modelMetadata, executionEnv);
          break;
        case 'tensorflow':
          model = await this.loadTensorFlowModel(modelMetadata, executionEnv);
          break;
        default:
          throw new Error(`Unsupported model type: ${modelMetadata.modelType}`);
      }

      // Cache model
      this.modelCache.set(cacheKey, model);
      this.logger.info('Model loaded successfully', { modelVersionHash, modelType: modelMetadata.modelType });

      return model;
    } catch (error) {
      this.logger.error('Failed to load model', {
        modelVersionHash,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute inference with step-by-step hashing
   */
  async executeWithStepHashing(
    model: any,
    taskInput: any,
    inferenceParameters: Record<string, any>,
    randomSeed: string,
    executionEnv: ExecutionEnvironment
  ): Promise<ModelExecutionResult> {
    const steps: ExecutionStep[] = [];
    const stepHashes: IntermediateStepHash[] = [];

    try {
      // Set random seed for deterministic execution
      this.setRandomSeed(randomSeed, executionEnv);

      // Step 1: Tokenization/Preprocessing
      const tokenizationStep = await this.executeTokenization(model, taskInput, executionEnv);
      steps.push(tokenizationStep);
      stepHashes.push({
        stepIndex: 0,
        stepHash: this.hashStepState(tokenizationStep),
        stepType: 'tokenization',
      });

      // Step 2: Forward pass (with intermediate state hashing)
      const forwardPassSteps = await this.executeForwardPassWithHashing(
        model,
        tokenizationStep.state,
        inferenceParameters,
        executionEnv
      );
      steps.push(...forwardPassSteps.steps);
      stepHashes.push(...forwardPassSteps.stepHashes);

      // Step 3: Decoding/Postprocessing
      const lastStep = forwardPassSteps.steps[forwardPassSteps.steps.length - 1];
      const decodingStep = await this.executeDecoding(model, lastStep.state, inferenceParameters, executionEnv);
      steps.push(decodingStep);
      stepHashes.push({
        stepIndex: steps.length - 1,
        stepHash: this.hashStepState(decodingStep),
        stepType: 'decoding',
      });

      // Final output
      const output = decodingStep.output || lastStep.output;

      this.logger.debug('Inference executed with step hashing', {
        totalSteps: steps.length,
        stepHashes: stepHashes.length,
      });

      return {
        output,
        steps,
        stepHashes,
      };
    } catch (error) {
      this.logger.error('Failed to execute inference with step hashing', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fetch model metadata from IPFS
   */
  private async fetchModelMetadata(modelVersionHash: string): Promise<ModelMetadata | null> {
    try {
      // Try IPFS first
      const url = `${this.ipfsGateway}${modelVersionHash}`;
      const response = await axios.get<ModelMetadata>(url, {
        timeout: 30000,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.data && response.data.modelId) {
        this.logger.info('Model metadata fetched from IPFS', { modelVersionHash });
        return response.data;
      }

      return null;
    } catch (error) {
      this.logger.warn('Failed to fetch model metadata from IPFS', {
        modelVersionHash,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Load Transformers model (HuggingFace format)
   */
  private async loadTransformersModel(
    metadata: ModelMetadata,
    executionEnv: ExecutionEnvironment
  ): Promise<any> {
    // For Node.js runtime, we'll use a lightweight approach
    // In production, this would use @xenova/transformers or similar
    
    if (executionEnv.runtime.includes('python')) {
      // Python runtime - would use transformers library
      // For now, return a structure that can be used for execution
      return {
        type: 'transformers',
        metadata,
        executionEnv,
        // Model would be loaded via Python subprocess or API
      };
    } else {
      // Node.js runtime - use @xenova/transformers
      try {
        // Dynamic import to avoid requiring it at module load time
        const { pipeline } = await import('@xenova/transformers');
        
        // Load model from IPFS or HuggingFace
        const modelPath = metadata.modelPath || metadata.modelId;
        const model = await pipeline('text-generation', modelPath, {
          quantized: false, // For deterministic execution
        });

        return {
          type: 'transformers',
          model,
          metadata,
          executionEnv,
        };
      } catch (error) {
        this.logger.error('Failed to load transformers model', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(`Failed to load transformers model: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Load ONNX model
   */
  private async loadONNXModel(metadata: ModelMetadata, executionEnv: ExecutionEnvironment): Promise<any> {
    try {
      // Load ONNX model from IPFS
      const modelPath = metadata.modelPath || `${this.ipfsGateway}${metadata.modelVersionHash}`;
      
      // For Node.js, use onnxruntime-node
      // For Python, would use onnxruntime
      if (executionEnv.runtime.includes('python')) {
        return {
          type: 'onnx',
          metadata,
          executionEnv,
          modelPath,
        };
      } else {
        // Node.js - would use onnxruntime-node
        // For now, return structure
        return {
          type: 'onnx',
          metadata,
          executionEnv,
          modelPath,
        };
      }
    } catch (error) {
      this.logger.error('Failed to load ONNX model', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Load PyTorch model
   */
  private async loadPyTorchModel(metadata: ModelMetadata, executionEnv: ExecutionEnvironment): Promise<any> {
    // PyTorch models typically require Python runtime
    if (!executionEnv.runtime.includes('python')) {
      throw new Error('PyTorch models require Python runtime');
    }

    return {
      type: 'pytorch',
      metadata,
      executionEnv,
      modelPath: metadata.modelPath || `${this.ipfsGateway}${metadata.modelVersionHash}`,
    };
  }

  /**
   * Load TensorFlow model
   */
  private async loadTensorFlowModel(metadata: ModelMetadata, executionEnv: ExecutionEnvironment): Promise<any> {
    // TensorFlow models can run in Node.js (tfjs) or Python
    return {
      type: 'tensorflow',
      metadata,
      executionEnv,
      modelPath: metadata.modelPath || `${this.ipfsGateway}${metadata.modelVersionHash}`,
    };
  }

  /**
   * Set random seed for deterministic execution
   */
  private setRandomSeed(seed: string, executionEnv: ExecutionEnvironment): void {
    // Convert seed string to number
    const seedNum = this.seedStringToNumber(seed);

    // Set seed based on runtime
    if (executionEnv.runtime.includes('python')) {
      // Python: Would set random.seed(), numpy.random.seed(), torch.manual_seed()
      // For now, just log
      this.logger.debug('Setting Python random seed', { seed: seedNum });
    } else {
      // Node.js: Set seed for Math.random() and crypto
      // Note: Math.random() is not seedable in JS, but we can use a seeded PRNG
      this.logger.debug('Setting Node.js random seed', { seed: seedNum });
    }
  }

  /**
   * Convert seed string to number
   */
  private seedStringToNumber(seed: string): number {
    const hash = createHash('sha256').update(seed).digest();
    return hash.readUInt32BE(0);
  }

  /**
   * Execute tokenization/preprocessing step
   */
  private async executeTokenization(
    model: any,
    taskInput: any,
    executionEnv: ExecutionEnvironment
  ): Promise<ExecutionStep> {
    const inputText = typeof taskInput === 'string' ? taskInput : JSON.stringify(taskInput);

    if (model.type === 'transformers' && model.model) {
      // Use transformers tokenizer
      try {
        const tokenizer = model.model.tokenizer || model.model;
        const tokens = await tokenizer(inputText, {
          return_tensors: 'pt',
          truncation: true,
          max_length: 512,
        });

        return {
          stepIndex: 0,
          stepType: 'tokenization',
          state: {
            inputText,
            tokenIds: tokens.input_ids,
            attentionMask: tokens.attention_mask,
          },
        };
      } catch (error) {
        // Fallback: simple tokenization
        return {
          stepIndex: 0,
          stepType: 'tokenization',
          state: {
            inputText,
            tokens: inputText.split(/\s+/),
          },
        };
      }
    }

    // Default: simple preprocessing
    return {
      stepIndex: 0,
      stepType: 'tokenization',
      state: {
        inputText,
        processed: taskInput,
      },
    };
  }

  /**
   * Execute forward pass with intermediate step hashing
   */
  private async executeForwardPassWithHashing(
    model: any,
    tokenizedState: any,
    inferenceParameters: Record<string, any>,
    executionEnv: ExecutionEnvironment
  ): Promise<{ steps: ExecutionStep[]; stepHashes: IntermediateStepHash[] }> {
    const steps: ExecutionStep[] = [];
    const stepHashes: IntermediateStepHash[] = [];

    if (model.type === 'transformers' && model.model) {
      // Execute generation with step-by-step hashing
      try {
        const generator = model.model;
        const inputIds = tokenizedState.tokenIds || tokenizedState.tokens;

        // For deterministic generation, we need to generate token by token
        // and hash each intermediate state
        const maxTokens = inferenceParameters.maxTokens || 100;
        let currentIds = inputIds;
        let generatedTokens: number[] = [];

        for (let i = 0; i < maxTokens; i++) {
          // Generate next token
          const outputs = await generator.generate(currentIds, {
            max_new_tokens: 1,
            temperature: inferenceParameters.temperature || 0,
            do_sample: inferenceParameters.temperature === 0 ? false : true,
            top_p: inferenceParameters.topP,
            top_k: inferenceParameters.topK,
          });

          const nextTokenId = outputs[0][outputs[0].length - 1];
          generatedTokens.push(nextTokenId);

          // Create step state
          const stepState: ExecutionStep = {
            stepIndex: i + 1,
            stepType: 'forward_pass',
            state: {
              currentIds: Array.isArray(currentIds) ? currentIds : currentIds.tolist(),
              nextTokenId,
              generatedTokens: [...generatedTokens],
            },
          };

          steps.push(stepState);
          stepHashes.push({
            stepIndex: i + 1,
            stepHash: this.hashStepState(stepState),
            stepType: 'forward_pass',
          });

          // Update current_ids for next iteration
          currentIds = [...(Array.isArray(currentIds) ? currentIds : currentIds.tolist()), nextTokenId];

          // Check for end token
          if (nextTokenId === generator.config.eos_token_id) {
            break;
          }
        }

        // Final forward pass step
        const finalStep: ExecutionStep = {
          stepIndex: steps.length,
          stepType: 'forward_pass',
          state: {
            generatedTokens,
            complete: true,
          },
        };
        steps.push(finalStep);
        stepHashes.push({
          stepIndex: steps.length - 1,
          stepHash: this.hashStepState(finalStep),
          stepType: 'forward_pass',
        });
      } catch (error) {
        this.logger.warn('Failed to execute transformers forward pass, using fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback: single step
        const fallbackStep: ExecutionStep = {
          stepIndex: 1,
          stepType: 'forward_pass',
          state: tokenizedState,
        };
        steps.push(fallbackStep);
        stepHashes.push({
          stepIndex: 1,
          stepHash: this.hashStepState(fallbackStep),
          stepType: 'forward_pass',
        });
      }
    } else {
      // Default: single forward pass step
      const step: ExecutionStep = {
        stepIndex: 1,
        stepType: 'forward_pass',
        state: tokenizedState,
      };
      steps.push(step);
      stepHashes.push({
        stepIndex: 1,
        stepHash: this.hashStepState(step),
        stepType: 'forward_pass',
      });
    }

    return { steps, stepHashes };
  }

  /**
   * Execute decoding/postprocessing step
   */
  private async executeDecoding(
    model: any,
    forwardPassState: any,
    inferenceParameters: Record<string, any>,
    executionEnv: ExecutionEnvironment
  ): Promise<ExecutionStep> {
    if (model.type === 'transformers' && model.model) {
      try {
        const tokenizer = model.model.tokenizer || model.model;
        const generatedTokens = forwardPassState.generatedTokens || forwardPassState.state?.generatedTokens || [];

        // Decode tokens to text
        const decodedText = await tokenizer.decode(generatedTokens, {
          skip_special_tokens: true,
        });

        return {
          stepIndex: 999, // Will be set by caller
          stepType: 'decoding',
          state: forwardPassState,
          output: decodedText,
        };
      } catch (error) {
        // Fallback
        return {
          stepIndex: 999,
          stepType: 'decoding',
          state: forwardPassState,
          output: JSON.stringify(forwardPassState),
        };
      }
    }

    // Default: return state as output
    return {
      stepIndex: 999,
      stepType: 'decoding',
      state: forwardPassState,
      output: forwardPassState,
    };
  }

  /**
   * Hash step state
   */
  private hashStepState(step: ExecutionStep): string {
    const stateString = JSON.stringify({
      stepIndex: step.stepIndex,
      stepType: step.stepType,
      state: step.state,
      output: step.output,
    });
    return createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Get task input from taskInputHash
   * This would typically query IPFS or database to get the actual task input
   */
  async getTaskInputFromHash(taskInputHash: string): Promise<any> {
    // In production, this would:
    // 1. Query IPFS using taskInputHash as CID
    // 2. Or query database for task with matching input hash
    // 3. Return the actual task input
    
    try {
      // Try IPFS first
      const url = `${this.ipfsGateway}${taskInputHash}`;
      const response = await axios.get(url, {
        timeout: 10000,
      });

      if (response.data) {
        this.logger.debug('Task input fetched from IPFS', { taskInputHash });
        return response.data;
      }
    } catch (error) {
      this.logger.warn('Failed to fetch task input from IPFS, may need database lookup', {
        taskInputHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // If IPFS fails, would query database
    // For now, throw error - caller should provide task input
    throw new Error(`Task input not found for hash: ${taskInputHash}. Please provide task input directly.`);
  }
}
