/**
 * Ethereum Blockchain Provider
 * Adapter for Ethereum/EVM chains to implement IBlockchainProvider
 */

import { ethers } from 'ethers';
import { IBlockchainProvider, DeploymentResult, TransactionReceipt } from '../../interfaces';

export class EthereumProvider implements IBlockchainProvider {
    private provider: ethers.Provider;
    private signer: ethers.Signer;
    private chainType: 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base';

    constructor(
        rpcUrl: string,
        privateKey: string,
        chainType: 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' = 'ethereum'
    ) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.signer = new ethers.Wallet(privateKey, this.provider);
        this.chainType = chainType;
    }

    async deployContract(
        bytecode: string,
        abi: any[],
        constructorArgs: any[],
        options?: { gasLimit?: string; value?: string }
    ): Promise<DeploymentResult> {
        const factory = new ethers.ContractFactory(abi, bytecode, this.signer);

        const deployOptions: any = {};
        if (options?.gasLimit) {
            deployOptions.gasLimit = BigInt(options.gasLimit);
        }
        if (options?.value) {
            deployOptions.value = BigInt(options.value);
        }

        const contract = await factory.deploy(...constructorArgs, deployOptions);
        await contract.waitForDeployment();

        const address = await contract.getAddress();
        const deployTx = contract.deploymentTransaction();

        if (!deployTx) {
            throw new Error('Deployment transaction not found');
        }

        const receipt = await deployTx.wait();

        return {
            contractAddress: address,
            transactionHash: deployTx.hash,
            blockNumber: receipt?.blockNumber,
            deployerAddress: await this.signer.getAddress(),
        };
    }

    async callContract(address: string, abi: any[], method: string, args: any[]): Promise<any> {
        const contract = new ethers.Contract(address, abi, this.provider);
        return await contract[method](...args);
    }

    async sendTransaction(
        address: string,
        abi: any[],
        method: string,
        args: any[],
        options?: { value?: string; gasLimit?: string }
    ): Promise<string> {
        const contract = new ethers.Contract(address, abi, this.signer);

        const txOptions: any = {};
        if (options?.value) {
            txOptions.value = BigInt(options.value);
        }
        if (options?.gasLimit) {
            txOptions.gasLimit = BigInt(options.gasLimit);
        }

        const tx = await contract[method](...args, txOptions);
        return tx.hash;
    }

    async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        if (!receipt) return null;

        return {
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            status: receipt.status === 1 ? 'success' : 'failed',
            gasUsed: receipt.gasUsed.toString(),
            from: receipt.from,
            to: receipt.to || undefined,
            contractAddress: receipt.contractAddress || undefined,
        };
    }

    async getBlockNumber(): Promise<number> {
        return await this.provider.getBlockNumber();
    }

    async getBalance(address: string): Promise<string> {
        const balance = await this.provider.getBalance(address);
        return balance.toString();
    }

    getType(): 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base' | 'solana' | 'custom' {
        return this.chainType;
    }

    async getChainId(): Promise<number | string> {
        const network = await this.provider.getNetwork();
        return Number(network.chainId);
    }
}
