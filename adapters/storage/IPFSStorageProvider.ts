/**
 * IPFS Storage Provider
 * Adapter for IPFS to implement IStorageProvider
 */

import { IStorageProvider, StorageMetadata } from '../../interfaces';
import axios from 'axios';

export class IPFSStorageProvider implements IStorageProvider {
    private gateway: string;
    private apiUrl: string;
    private pinataApiKey?: string;
    private pinataSecretKey?: string;

    constructor(config?: {
        gateway?: string;
        apiUrl?: string;
        pinataApiKey?: string;
        pinataSecretKey?: string;
    }) {
        this.gateway = config?.gateway || 'https://ipfs.io/ipfs/';
        this.apiUrl = config?.apiUrl || 'https://api.pinata.cloud';
        this.pinataApiKey = config?.pinataApiKey;
        this.pinataSecretKey = config?.pinataSecretKey;
    }

    async upload(data: any, metadata?: StorageMetadata): Promise<string> {
        if (this.pinataApiKey && this.pinataSecretKey) {
            return this.uploadViaPinata(data, metadata);
        }
        throw new Error('IPFS upload requires Pinata API keys');
    }

    private async uploadViaPinata(data: any, metadata?: StorageMetadata): Promise<string> {
        const formData = new FormData();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        formData.append('file', blob, metadata?.name || 'data.json');

        if (metadata) {
            formData.append(
                'pinataMetadata',
                JSON.stringify({
                    name: metadata.name,
                })
            );
        }

        const response = await axios.post(`${this.apiUrl}/pinning/pinFileToIPFS`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
                pinata_api_key: this.pinataApiKey!,
                pinata_secret_api_key: this.pinataSecretKey!,
            },
        });

        return response.data.IpfsHash;
    }

    async download(cid: string): Promise<any> {
        const response = await axios.get(`${this.gateway}${cid}`);
        return response.data;
    }

    async pin(cid: string, name?: string): Promise<void> {
        if (!this.pinataApiKey || !this.pinataSecretKey) {
            throw new Error('Pinata API keys required for pinning');
        }

        await axios.post(
            `${this.apiUrl}/pinning/pinByHash`,
            {
                hashToPin: cid,
                pinataMetadata: name ? { name } : undefined,
            },
            {
                headers: {
                    pinata_api_key: this.pinataApiKey,
                    pinata_secret_api_key: this.pinataSecretKey,
                },
            }
        );
    }

    async unpin(cid: string): Promise<void> {
        if (!this.pinataApiKey || !this.pinataSecretKey) {
            throw new Error('Pinata API keys required for unpinning');
        }

        await axios.delete(`${this.apiUrl}/pinning/unpin/${cid}`, {
            headers: {
                pinata_api_key: this.pinataApiKey,
                pinata_secret_api_key: this.pinataSecretKey,
            },
        });
    }

    async exists(cid: string): Promise<boolean> {
        try {
            await axios.head(`${this.gateway}${cid}`, { timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    getType(): 'ipfs' | 'arweave' | 's3' | 'r2' | 'custom' {
        return 'ipfs';
    }
}
