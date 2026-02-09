/**
 * Contract Compiler
 * 
 * Compiles Solidity contracts using solc
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ILogger } from '../utils/ILogger';
import { ethers } from 'ethers';

export interface CompiledContract {
  abi: any[];
  bytecode: string;
  contractName: string;
}

export class ContractCompiler {
  private logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  /**
   * Compile Solidity contract using ethers.js
   * Note: This requires the contract to be compiled separately (e.g., via Hardhat)
   * For now, we'll use a simpler approach with inline compilation
   */
  async compileContract(contractName: string, sourceCode: string): Promise<CompiledContract> {
    try {
      this.logger.info('Compiling contract', { contractName });

      // Use ethers.js to compile (simplified - in production would use Hardhat/Foundry)
      // For now, we'll use a workaround: compile via solc-js if available
      // Otherwise, we'll need pre-compiled artifacts
      
      // Try to use solc if available
      let solc: any;
      try {
        solc = require('solc');
      } catch (e) {
        throw new Error('solc package not available. Please install: npm install solc');
      }

      const input = {
        language: 'Solidity',
        sources: {
          [contractName + '.sol']: {
            content: sourceCode,
          },
        },
        settings: {
          outputSelection: {
            '*': {
              '*': ['abi', 'evm.bytecode'],
            },
          },
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      };

      const output = JSON.parse(solc.compile(JSON.stringify(input), { import: this.findImports }));

      if (output.errors) {
        const errors = output.errors.filter((e: any) => e.severity === 'error');
        if (errors.length > 0) {
          throw new Error(`Compilation errors: ${errors.map((e: any) => e.message).join('; ')}`);
        }
      }

      const contract = output.contracts[contractName + '.sol'][contractName];
      if (!contract) {
        throw new Error(`Contract ${contractName} not found in compilation output`);
      }

      return {
        abi: contract.abi,
        bytecode: '0x' + contract.evm.bytecode.object,
        contractName,
      };
    } catch (error) {
      this.logger.error('Contract compilation failed', error);
      throw new Error(`Failed to compile contract: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Compile contract from file
   */
  async compileContractFromFile(filePath: string, contractName: string): Promise<CompiledContract> {
    try {
      const sourceCode = readFileSync(filePath, 'utf-8');
      return await this.compileContract(contractName, sourceCode);
    } catch (error) {
      this.logger.error('Failed to read contract file', { filePath, error });
      throw error;
    }
  }

  /**
   * Find imports (simplified - in production would resolve from node_modules)
   */
  private findImports(path: string): { contents: string } | { error: string } {
    // For now, return empty for imports
    // In production, would resolve from node_modules/@openzeppelin, etc.
    if (path.startsWith('@openzeppelin')) {
      return { error: 'OpenZeppelin imports not resolved - use inline contracts' };
    }
    return { contents: '' };
  }
}
