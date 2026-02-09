/**
 * Workers-Compatible Ethereum Provider
 * Uses HTTP RPC calls instead of ethers.js
 * 
 * This provider is designed for Cloudflare Workers and other environments
 * where Node.js libraries like ethers.js are not available.
 */

import { IBlockchainProvider } from '../../interfaces/IBlockchainProvider';
import { Logger } from '../../../utils/Logger';

export class EthereumHTTPProvider implements IBlockchainProvider {
    constructor(
        private rpcUrl: string,
        private logger: ILogger
    ) { }

    /**
     * Get ETH balance of an address
     */
    async getBalance(address: string): Promise<string> {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_getBalance',
                    params: [address, 'latest'],
                    id: 1
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            // Convert hex to decimal string
            const balanceWei = BigInt(data.result);
            return balanceWei.toString();
        } catch (error) {
            this.logger.error('Failed to get balance', { address, error });
            throw error;
        }
    }

    /**
     * Get ERC20 token balance
     */
    async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string> {
        try {
            // ERC20 balanceOf function signature: 0x70a08231
            const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');

            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_call',
                    params: [{
                        to: tokenAddress,
                        data: data
                    }, 'latest'],
                    id: 1
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error.message);
            }

            const balance = BigInt(result.result);
            return balance.toString();
        } catch (error) {
            this.logger.error('Failed to get token balance', { tokenAddress, walletAddress, error });
            throw error;
        }
    }

    /**
     * Deploy an ERC20 token
     * Note: This is a placeholder - actual deployment requires private key signing
     * which should be done server-side or via a separate service
     */
    async deployERC20Token(params: {
        name: string;
        symbol: string;
        supply: number;
        decimals: number;
        creatorAddress: string;
    }): Promise<{ tokenAddress: string; txHash: string }> {
        this.logger.info('ERC20 deployment queued (requires server-side signing)', params);

        // In Workers, we can't sign transactions directly
        // This should be handled by a queue/background job
        return {
            tokenAddress: '0x0000000000000000000000000000000000000000', // Placeholder
            txHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
        };
    }

    /**
     * Get current gas price
     */
    async getGasPrice(): Promise<string> {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_gasPrice',
                    params: [],
                    id: 1
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            const gasPriceWei = BigInt(data.result);
            return gasPriceWei.toString();
        } catch (error) {
            this.logger.error('Failed to get gas price', { error });
            throw error;
        }
    }

    /**
     * Get transaction receipt
     */
    async getTransactionReceipt(txHash: string): Promise<any> {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_getTransactionReceipt',
                    params: [txHash],
                    id: 1
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            return data.result;
        } catch (error) {
            this.logger.error('Failed to get transaction receipt', { txHash, error });
            throw error;
        }
    }

    /**
     * Get current block number
     */
    async getBlockNumber(): Promise<number> {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_blockNumber',
                    params: [],
                    id: 1
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message);
            }

            return parseInt(data.result, 16);
        } catch (error) {
            this.logger.error('Failed to get block number', { error });
            throw error;
        }
    }

    /**
     * Call a contract method (read-only)
     */
    async callContract(params: {
        to: string;
        data: string;
    }): Promise<string> {
        try {
            const response = await fetch(this.rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'eth_call',
                    params: [params, 'latest'],
                    id: 1
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error.message);
            }

            return result.result;
        } catch (error) {
            this.logger.error('Failed to call contract', { params, error });
            throw error;
        }
    }
}
