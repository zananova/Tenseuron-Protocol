/**
 * Blockchain Provider Interface
 * Blockchain-agnostic interface for smart contract operations
 * Supports Ethereum, Polygon, Solana, etc.
 */

export interface DeploymentResult {
    contractAddress: string;
    transactionHash: string;
    blockNumber?: number;
    deployerAddress?: string;
}

export interface TransactionReceipt {
    transactionHash: string;
    blockNumber: number;
    status: 'success' | 'failed';
    gasUsed?: string;
    [key: string]: any;
}

export interface IBlockchainProvider {
    /**
     * Deploy smart contract
     */
    deployContract(
        bytecode: string,
        abi: any[],
        constructorArgs: any[],
        options?: { gasLimit?: string; value?: string }
    ): Promise<DeploymentResult>;

    /**
     * Call contract method (read-only)
     */
    callContract(
        address: string,
        abi: any[],
        method: string,
        args: any[]
    ): Promise<any>;

    /**
     * Send transaction to contract (write)
     */
    sendTransaction(
        address: string,
        abi: any[],
        method: string,
        args: any[],
        options?: { value?: string; gasLimit?: string }
    ): Promise<string>;

    /**
     * Get transaction receipt
     */
    getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null>;

    /**
     * Get current block number
     */
    getBlockNumber(): Promise<number>;

    /**
     * Get account balance
     */
    getBalance(address: string): Promise<string>;

    /**
     * Get blockchain provider type
     */
    getType(): 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'solana' | 'custom';

    /**
     * Get chain ID
     */
    getChainId(): Promise<number | string>;
}
