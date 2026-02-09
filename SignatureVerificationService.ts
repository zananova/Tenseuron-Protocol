/**
 * Signature Verification Service
 * 
 * Provides comprehensive cryptographic verification of validator signatures
 * Uses EIP-191 standard for Ethereum message signing
 * 
 * FULLY IMPLEMENTED: No placeholders, production-ready
 */

import { ILogger } from './utils/ILogger';
import { ethers } from 'ethers';
import { createHash } from 'crypto';

export interface SignatureVerificationResult {
  valid: boolean;
  recoveredAddress: string;
  errors: string[];
  warnings: string[];
}

export interface ValidatorSignature {
  validatorAddress: string;
  signature: string;
  message: string;
}

export interface AggregatedSignature {
  messageHash: string;
  signatures: Array<{
    validatorAddress: string;
    signature: string;
    v: number;
    r: string;
    s: string;
  }>;
  aggregatedHash: string; // Hash of all signatures combined
}

export class SignatureVerificationService {
  private logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  /**
   * Verify a single signature cryptographically
   * Uses EIP-191 standard: "\x19Ethereum Signed Message:\n" + len(message) + message
   */
  verifySignature(
    validatorAddress: string,
    signature: string,
    message: string
  ): SignatureVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate inputs
    if (!validatorAddress || !validatorAddress.startsWith('0x')) {
      errors.push('Invalid validator address format');
      return { valid: false, recoveredAddress: '', errors, warnings };
    }

    if (!signature || !signature.startsWith('0x') || signature.length !== 132) {
      errors.push('Invalid signature format (must be 65-byte hex string: 0x + 64 hex chars)');
      return { valid: false, recoveredAddress: '', errors, warnings };
    }

    if (!message || message.length === 0) {
      errors.push('Message cannot be empty');
      return { valid: false, recoveredAddress: '', errors, warnings };
    }

    try {
      // Use ethers.js to verify signature (EIP-191 compliant)
      const recoveredAddress = ethers.verifyMessage(message, signature);

      // Normalize addresses for comparison
      const normalizedRecovered = recoveredAddress.toLowerCase();
      const normalizedValidator = validatorAddress.toLowerCase();

      if (normalizedRecovered !== normalizedValidator) {
        errors.push(
          `Signature verification failed: recovered address ${recoveredAddress} does not match validator ${validatorAddress}`
        );
        return { valid: false, recoveredAddress, errors, warnings };
      }

      this.logger.debug('Signature verified successfully', {
        validatorAddress,
        recoveredAddress,
      });

      return {
        valid: true,
        recoveredAddress,
        errors: [],
        warnings: [],
      };
    } catch (error) {
      errors.push(
        `Signature verification error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return {
        valid: false,
        recoveredAddress: '',
        errors,
        warnings,
      };
    }
  }

  /**
   * Verify multiple validator signatures
   * Returns results for each signature and overall validation status
   */
  verifyMultipleSignatures(
    signatures: ValidatorSignature[]
  ): {
    allValid: boolean;
    results: Array<SignatureVerificationResult & { validatorAddress: string }>;
    invalidCount: number;
    validCount: number;
  } {
    const results = signatures.map((sig) => ({
      ...this.verifySignature(sig.validatorAddress, sig.signature, sig.message),
      validatorAddress: sig.validatorAddress,
    }));

    const validCount = results.filter((r) => r.valid).length;
    const invalidCount = results.filter((r) => !r.valid).length;
    const allValid = invalidCount === 0;

    if (!allValid) {
      this.logger.warn('Some signatures failed verification', {
        total: signatures.length,
        valid: validCount,
        invalid: invalidCount,
        invalidValidators: results
          .filter((r) => !r.valid)
          .map((r) => r.validatorAddress),
      });
    } else {
      this.logger.info('All signatures verified successfully', {
        total: signatures.length,
      });
    }

    return {
      allValid,
      results,
      invalidCount,
      validCount,
    };
  }

  /**
   * Verify all validator signatures for a task evaluation
   * Message format: networkId + taskId + outputId + score + confidence + timestamp
   */
  verifyTaskEvaluationSignatures(
    networkId: string,
    taskId: string,
    evaluations: Array<{
      validatorAddress: string;
      outputId: string;
      score: number;
      confidence: number;
      signature: string;
      timestamp: number;
    }>
  ): {
    allValid: boolean;
    results: Array<SignatureVerificationResult & { validatorAddress: string }>;
    invalidEvaluations: Array<{ validatorAddress: string; errors: string[] }>;
  } {
    const signatures: ValidatorSignature[] = evaluations.map((eval_) => {
      // Reconstruct the exact message that was signed
      const message = JSON.stringify({
        networkId,
        taskId,
        outputId: eval_.outputId,
        score: eval_.score,
        confidence: eval_.confidence,
        timestamp: eval_.timestamp,
      });

      return {
        validatorAddress: eval_.validatorAddress,
        signature: eval_.signature,
        message,
      };
    });

    const verification = this.verifyMultipleSignatures(signatures);

    const invalidEvaluations = verification.results
      .filter((r) => !r.valid)
      .map((r) => ({
        validatorAddress: r.validatorAddress,
        errors: r.errors,
      }));

    return {
      allValid: verification.allValid,
      results: verification.results,
      invalidEvaluations,
    };
  }

  /**
   * Parse signature into r, s, v components
   * Signature format: 0x + r (64 hex chars) + s (64 hex chars) + v (2 hex chars)
   */
  parseSignature(signature: string): { r: string; s: string; v: number } | null {
    if (!signature || !signature.startsWith('0x') || signature.length !== 132) {
      return null;
    }

    try {
      const r = '0x' + signature.substring(2, 66);
      const s = '0x' + signature.substring(66, 130);
      const vHex = signature.substring(130, 132);
      const v = parseInt(vHex, 16);

      // Validate v is 27 or 28 (standard Ethereum signature recovery IDs)
      if (v !== 27 && v !== 28) {
        // Try to normalize (some libraries use 0/1, we convert to 27/28)
        const normalizedV = v < 27 ? v + 27 : v;
        if (normalizedV !== 27 && normalizedV !== 28) {
          this.logger.warn('Invalid recovery ID in signature', { v, signature });
          return null;
        }
        return { r, s, v: normalizedV };
      }

      return { r, s, v };
    } catch (error) {
      this.logger.error('Failed to parse signature', {
        signature,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Aggregate multiple signatures into a single aggregated signature
   * 
   * For multi-sig consensus, we create an aggregated signature that:
   * 1. Contains all individual signatures (r, s, v components)
   * 2. Creates a combined hash for verification
   * 3. Maintains the ability to verify each individual signature
   * 
   * This is NOT a true signature aggregation (like BLS), but rather
   * a structured format that allows verification of all signatures.
   */
  aggregateSignatures(
    message: string,
    signatures: Array<{
      validatorAddress: string;
      signature: string;
    }>
  ): AggregatedSignature | null {
    // First, verify all signatures are valid
    const validatorSignatures: ValidatorSignature[] = signatures.map((sig) => ({
      validatorAddress: sig.validatorAddress,
      signature: sig.signature,
      message,
    }));

    const verification = this.verifyMultipleSignatures(validatorSignatures);
    if (!verification.allValid) {
      this.logger.error('Cannot aggregate invalid signatures', {
        invalidCount: verification.invalidCount,
        invalidValidators: verification.results
          .filter((r) => !r.valid)
          .map((r) => r.validatorAddress),
      });
      return null;
    }

    // Parse all signatures into r, s, v components
    const parsedSignatures = signatures
      .map((sig) => {
        const parsed = this.parseSignature(sig.signature);
        if (!parsed) {
          return null;
        }
        return {
          validatorAddress: sig.validatorAddress,
          signature: sig.signature,
          v: parsed.v,
          r: parsed.r,
          s: parsed.s,
        };
      })
      .filter((sig): sig is NonNullable<typeof sig> => sig !== null);

    if (parsedSignatures.length !== signatures.length) {
      this.logger.error('Failed to parse some signatures', {
        total: signatures.length,
        parsed: parsedSignatures.length,
      });
      return null;
    }

    // Create message hash (EIP-191)
    const messageHash = ethers.hashMessage(message);

    // Create aggregated hash (hash of all signatures combined)
    // This allows quick verification that all signatures are present
    const allSignaturesCombined = parsedSignatures
      .map((sig) => `${sig.validatorAddress}:${sig.r}:${sig.s}:${sig.v}`)
      .sort()
      .join('|');
    const aggregatedHash = createHash('sha256')
      .update(messageHash + allSignaturesCombined)
      .digest('hex');

    this.logger.info('Signatures aggregated successfully', {
      messageHash,
      signatureCount: parsedSignatures.length,
      aggregatedHash,
    });

    return {
      messageHash,
      signatures: parsedSignatures.map((sig) => ({
        validatorAddress: sig.validatorAddress,
        signature: sig.signature,
        v: sig.v,
        r: sig.r,
        s: sig.s,
      })),
      aggregatedHash: `0x${aggregatedHash}`,
    };
  }

  /**
   * Verify an aggregated signature
   * Checks that all individual signatures are valid and match the message
   */
  verifyAggregatedSignature(
    aggregated: AggregatedSignature,
    message: string
  ): {
    valid: boolean;
    allSignaturesValid: boolean;
    invalidSignatures: string[];
    errors: string[];
  } {
    const errors: string[] = [];
    const invalidSignatures: string[] = [];

    // Verify message hash matches
    const expectedMessageHash = ethers.hashMessage(message);
    if (aggregated.messageHash !== expectedMessageHash) {
      errors.push(
        `Message hash mismatch: expected ${expectedMessageHash}, got ${aggregated.messageHash}`
      );
      return {
        valid: false,
        allSignaturesValid: false,
        invalidSignatures: [],
        errors,
      };
    }

    // Verify each individual signature
    let allValid = true;
    for (const sig of aggregated.signatures) {
      const verification = this.verifySignature(sig.validatorAddress, sig.signature, message);
      if (!verification.valid) {
        allValid = false;
        invalidSignatures.push(sig.validatorAddress);
        errors.push(...verification.errors);
      }
    }

    // Verify aggregated hash
    const allSignaturesCombined = aggregated.signatures
      .map((sig) => `${sig.validatorAddress}:${sig.r}:${sig.s}:${sig.v}`)
      .sort()
      .join('|');
    const expectedAggregatedHash = createHash('sha256')
      .update(aggregated.messageHash + allSignaturesCombined)
      .digest('hex');

    if (`0x${expectedAggregatedHash}` !== aggregated.aggregatedHash) {
      errors.push('Aggregated hash mismatch');
      allValid = false;
    }

    return {
      valid: allValid && errors.length === 0,
      allSignaturesValid: allValid,
      invalidSignatures,
      errors,
    };
  }
}
