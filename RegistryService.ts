/**
 * Registry Service
 * 
 * Manages network manifest storage and discovery
 * Primary: IPFS
 * Fallback: Git mirrors
 */

import { NetworkManifest } from './types';
import { ILogger } from './utils/ILogger';
import axios from 'axios';

export interface PinningService {
  name: string;
  endpoint: string;
  apiKey?: string;
  type: 'pinata' | 'web3storage' | 'nftstorage' | 'self-hosted' | 'custom';
}

export interface RegistryConfig {
  ipfsGateway?: string;
  ipfsApiUrl?: string;
  gitMirrorUrl?: string;
  pinningServices?: PinningService[]; // Multiple pinning services for reliability
  selfHostedIpfsApi?: string; // Self-hosted IPFS node API URL
  enableGitMirror?: boolean; // Optionally update Git registry for redundancy
  gitMirrorConfig?: {
    repository: string;
    branch?: string;
    token?: string; // GitHub token for pushing
  };
  registryIndexCid?: string; // IPFS CID of the registry index (networks.json)
}

export interface NetworkRegistryIndex {
  version: string;
  networks: Array<{
    networkId: string;
    name: string;
    category: string;
    ipfsCid: string;
    gitUrl?: string;
    createdAt: string;
    creatorAddress: string;
    settlementChain: string;
  }>;
  lastUpdated: string;
}

export class RegistryService {
  private logger: ILogger;
  private config: RegistryConfig;

  private registryIndexCache: NetworkRegistryIndex | null = null;
  private registryIndexCacheTime: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(logger: ILogger, config?: RegistryConfig) {
    this.logger = logger;
    
    // Build pinning services from environment variables
    const pinningServices: PinningService[] = [];
    
    // Pinata
    if (process.env.PINATA_API_KEY) {
      pinningServices.push({
        name: 'Pinata',
        endpoint: 'https://api.pinata.cloud/pinning',
        apiKey: process.env.PINATA_API_KEY,
        type: 'pinata',
      });
    }
    
    // Web3.Storage
    if (process.env.WEB3_STORAGE_TOKEN) {
      pinningServices.push({
        name: 'Web3.Storage',
        endpoint: 'https://api.web3.storage',
        apiKey: process.env.WEB3_STORAGE_TOKEN,
        type: 'web3storage',
      });
    }
    
    // NFT.Storage
    if (process.env.NFT_STORAGE_TOKEN) {
      pinningServices.push({
        name: 'NFT.Storage',
        endpoint: 'https://api.nft.storage',
        apiKey: process.env.NFT_STORAGE_TOKEN,
        type: 'nftstorage',
      });
    }
    
    // Self-hosted IPFS node
    if (process.env.SELF_HOSTED_IPFS_API) {
      pinningServices.push({
        name: 'Self-hosted IPFS',
        endpoint: process.env.SELF_HOSTED_IPFS_API,
        type: 'self-hosted',
      });
    }
    
    this.config = {
      ipfsGateway: process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/',
      ipfsApiUrl: process.env.IPFS_API_URL || 'https://ipfs.io/api/v0',
      gitMirrorUrl: process.env.GIT_MIRROR_URL,
      pinningServices: pinningServices.length > 0 ? pinningServices : undefined,
      selfHostedIpfsApi: process.env.SELF_HOSTED_IPFS_API,
      enableGitMirror: process.env.ENABLE_GIT_MIRROR === 'true',
      gitMirrorConfig: process.env.GIT_MIRROR_REPO ? {
        repository: process.env.GIT_MIRROR_REPO,
        branch: process.env.GIT_MIRROR_BRANCH || 'main',
        token: process.env.GIT_MIRROR_TOKEN,
      } : undefined,
      registryIndexCid: process.env.REGISTRY_INDEX_CID,
      ...config,
    };
  }

  /**
   * Upload manifest to IPFS
   * Returns IPFS CID
   * 
   * Uses multiple pinning services for reliability:
   * 1. Upload to public IPFS API (primary)
   * 2. Pin to multiple pinning services (redundancy)
   * 3. Optionally update Git registry (redundancy)
   */
  async uploadManifest(manifest: NetworkManifest): Promise<string> {
    try {
      this.logger.info('Uploading network manifest to IPFS with multiple pinning services', { networkId: manifest.networkId });

      // Step 1: Upload to public IPFS API (primary)
      const cid = await this.uploadViaPublicAPI(manifest);
      
      // Step 2: Pin to multiple pinning services for reliability
      if (this.config.pinningServices && this.config.pinningServices.length > 0) {
        await this.pinToMultipleServices(cid, manifest.networkId);
      } else {
        this.logger.warn('No pinning services configured - content may not persist. Consider configuring multiple pinning services or self-hosting an IPFS node.');
      }
      
      // Step 3: Optionally update Git registry for redundancy
      if (this.config.enableGitMirror && this.config.gitMirrorConfig) {
        await this.updateGitRegistry(manifest, cid).catch(error => {
          // Don't fail if Git update fails - IPFS is primary
          this.logger.warn('Failed to update Git registry (non-critical)', {
            networkId: manifest.networkId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
      
      return cid;
    } catch (error) {
      this.logger.error('Failed to upload manifest to IPFS', error);
      throw new Error(`IPFS upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload via public IPFS API (less reliable, but free)
   */
  private async uploadViaPublicAPI(manifest: NetworkManifest): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    formData.append('file', blob, `network-${manifest.networkId}.json`);

    const response = await axios.post(
      `${this.config.ipfsApiUrl}/add`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    const cid = response.data.Hash;
    this.logger.info('Manifest uploaded to IPFS via public API', { networkId: manifest.networkId, cid });
    
    return cid;
  }

  /**
   * Pin CID to multiple pinning services for reliability
   */
  private async pinToMultipleServices(cid: string, networkId: string): Promise<void> {
    if (!this.config.pinningServices || this.config.pinningServices.length === 0) {
      return;
    }

    const pinPromises = this.config.pinningServices.map(async (service) => {
      try {
        await this.pinToService(cid, service);
        this.logger.info('Manifest pinned to service', {
          networkId,
          cid,
          service: service.name,
        });
        return { service: service.name, success: true };
      } catch (error) {
        this.logger.warn('Failed to pin to service', {
          networkId,
          cid,
          service: service.name,
          error: error instanceof Error ? error.message : String(error),
        });
        return { service: service.name, success: false };
      }
    });

    const results = await Promise.allSettled(pinPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    
    this.logger.info('Pinning results', {
      networkId,
      cid,
      totalServices: this.config.pinningServices!.length,
      successful,
      failed: this.config.pinningServices!.length - successful,
    });
  }

  /**
   * Pin CID to a specific pinning service
   */
  private async pinToService(cid: string, service: PinningService): Promise<void> {
    switch (service.type) {
      case 'pinata':
        if (!service.apiKey) {
          throw new Error('Pinata API key required');
        }
        await axios.post(
          `${service.endpoint}/pinByHash`,
          {
            hashToPin: cid,
            pinataOptions: {
              cidVersion: 1,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'pinata_api_key': service.apiKey,
            },
            timeout: 10000,
          }
        );
        break;

      case 'web3storage':
        if (!service.apiKey) {
          throw new Error('Web3.Storage token required');
        }
        await axios.post(
          `${service.endpoint}/upload`,
          { cid },
          {
            headers: {
              'Authorization': `Bearer ${service.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );
        break;

      case 'nftstorage':
        if (!service.apiKey) {
          throw new Error('NFT.Storage token required');
        }
        await axios.post(
          `${service.endpoint}/upload`,
          { cid },
          {
            headers: {
              'Authorization': `Bearer ${service.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );
        break;

      case 'self-hosted':
        // Self-hosted IPFS node - use pin/add endpoint
        const ipfsApiUrl = service.endpoint.endsWith('/api/v0') 
          ? service.endpoint 
          : `${service.endpoint}/api/v0`;
        await axios.post(
          `${ipfsApiUrl}/pin/add?arg=${cid}`,
          {},
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );
        break;

      default:
        throw new Error(`Unsupported pinning service type: ${service.type}`);
    }
  }

  /**
   * Optionally update Git registry for redundancy
   */
  private async updateGitRegistry(manifest: NetworkManifest, cid: string): Promise<void> {
    if (!this.config.gitMirrorConfig) {
      return;
    }

    try {
      const { repository, branch = 'main', token } = this.config.gitMirrorConfig;
      
      // For GitHub repositories, we can use GitHub API to update files
      if (repository.includes('github.com')) {
        await this.updateGitHubRegistry(manifest, cid, repository, branch, token);
      } else {
        this.logger.warn('Git registry update only supports GitHub repositories', { repository });
      }
    } catch (error) {
      this.logger.error('Failed to update Git registry', {
        networkId: manifest.networkId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update GitHub registry (optional redundancy)
   */
  private async updateGitHubRegistry(
    manifest: NetworkManifest,
    cid: string,
    repository: string,
    branch: string,
    token?: string
  ): Promise<void> {
    // Extract owner and repo from GitHub URL
    // Format: https://github.com/owner/repo or owner/repo
    const repoMatch = repository.match(/(?:github\.com\/)?([^\/]+)\/([^\/]+)/);
    if (!repoMatch) {
      throw new Error(`Invalid GitHub repository format: ${repository}`);
    }

    const [, owner, repo] = repoMatch;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/manifests/${manifest.networkId}.json`;

    // Get current file SHA (if exists)
    let currentSha: string | undefined;
    try {
      const getResponse = await axios.get(apiUrl, {
        headers: token ? { 'Authorization': `token ${token}` } : {},
        params: { ref: branch },
      });
      currentSha = getResponse.data.sha;
    } catch (error: any) {
      // File doesn't exist yet, that's okay
      if (error.response?.status !== 404) {
        throw error;
      }
    }

    // Prepare manifest with updated CID
    const updatedManifest = {
      ...manifest,
      registry: {
        ...manifest.registry,
        ipfsCid: cid,
      },
    };

    // Encode content as base64
    const content = Buffer.from(JSON.stringify(updatedManifest, null, 2)).toString('base64');

    // Create or update file
    const putData: any = {
      message: `Update manifest for network ${manifest.networkId}`,
      content,
      branch,
    };

    if (currentSha) {
      putData.sha = currentSha; // Required for updates
    }

    await axios.put(apiUrl, putData, {
      headers: {
        'Authorization': token ? `token ${token}` : undefined,
        'Content-Type': 'application/json',
        ...(token ? {} : {}),
      },
      timeout: 10000,
    });

    this.logger.info('Manifest updated in Git registry', {
      networkId: manifest.networkId,
      repository,
      branch,
    });
  }

  /**
   * Fetch manifest from IPFS
   */
  async fetchManifest(ipfsCid: string): Promise<NetworkManifest | null> {
    try {
      const url = `${this.config.ipfsGateway}${ipfsCid}`;
      this.logger.info('Fetching manifest from IPFS', { cid: ipfsCid });

      const response = await axios.get(url, {
        timeout: 10000,
      });

      const manifest = response.data as NetworkManifest;
      
      // Validate manifest structure
      if (!manifest.networkId || !manifest.name) {
        throw new Error('Invalid manifest structure');
      }

      this.logger.info('Manifest fetched from IPFS', { networkId: manifest.networkId, cid: ipfsCid });
      return manifest;
    } catch (error) {
      this.logger.error('Failed to fetch manifest from IPFS', { cid: ipfsCid, error });
      return null;
    }
  }

  /**
   * Fetch manifest with fallback to Git
   */
  async fetchManifestWithFallback(ipfsCid: string, gitUrl?: string): Promise<NetworkManifest | null> {
    // Try IPFS first
    const manifest = await this.fetchManifest(ipfsCid);
    if (manifest) {
      return manifest;
    }

    // Fallback to Git if available
    if (gitUrl) {
      this.logger.info('IPFS fetch failed, trying Git fallback', { gitUrl });
      return await this.fetchManifestFromGit(gitUrl);
    }

    return null;
  }

  /**
   * Fetch manifest from Git repository
   */
  async fetchManifestFromGit(gitUrl: string): Promise<NetworkManifest | null> {
    try {
      // Convert GitHub URL to raw content URL
      let rawUrl = gitUrl;
      if (gitUrl.includes('github.com')) {
        rawUrl = gitUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }

      const response = await axios.get(rawUrl, {
        timeout: 10000,
      });

      const manifest = response.data as NetworkManifest;
      this.logger.info('Manifest fetched from Git', { gitUrl, networkId: manifest.networkId });
      return manifest;
    } catch (error) {
      this.logger.error('Failed to fetch manifest from Git', { gitUrl, error });
      return null;
    }
  }

  /**
   * List all networks from registry index
   * Fetches the registry index from IPFS (or Git fallback)
   */
  async listNetworks(): Promise<string[]> {
    try {
      const index = await this.getRegistryIndex();
      if (!index) {
        this.logger.warn('Registry index not available');
        return [];
      }

      return index.networks.map(n => n.networkId);
    } catch (error) {
      this.logger.error('Failed to list networks', error);
      return [];
    }
  }

  /**
   * Get full registry index with network details
   */
  async getRegistryIndex(): Promise<NetworkRegistryIndex | null> {
    // Check cache first
    if (this.registryIndexCache && Date.now() - this.registryIndexCacheTime < this.CACHE_TTL) {
      return this.registryIndexCache;
    }

    // Try to fetch from IPFS
    if (this.config.registryIndexCid) {
      try {
        const url = `${this.config.ipfsGateway}${this.config.registryIndexCid}`;
        const response = await axios.get<NetworkRegistryIndex>(url, {
          timeout: 10000,
        });

        if (response.data && response.data.networks) {
          this.registryIndexCache = response.data;
          this.registryIndexCacheTime = Date.now();
          this.logger.info('Registry index fetched from IPFS', { 
            networkCount: response.data.networks.length 
          });
          return response.data;
        }
      } catch (error) {
        this.logger.warn('Failed to fetch registry index from IPFS', { error });
      }
    }

    // Fallback to Git if available
    if (this.config.gitMirrorUrl) {
      try {
        let gitUrl = this.config.gitMirrorUrl;
        if (gitUrl.includes('github.com')) {
          gitUrl = gitUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        }
        if (!gitUrl.endsWith('/networks.json')) {
          gitUrl = gitUrl.endsWith('/') ? `${gitUrl}networks.json` : `${gitUrl}/networks.json`;
        }

        const response = await axios.get<NetworkRegistryIndex>(gitUrl, {
          timeout: 10000,
        });

        if (response.data && response.data.networks) {
          this.registryIndexCache = response.data;
          this.registryIndexCacheTime = Date.now();
          this.logger.info('Registry index fetched from Git', { 
            networkCount: response.data.networks.length 
          });
          return response.data;
        }
      } catch (error) {
        this.logger.warn('Failed to fetch registry index from Git', { error });
      }
    }

    // If no registry index configured, return empty index
    this.logger.warn('No registry index configured. Set REGISTRY_INDEX_CID or GIT_MIRROR_URL');
    return {
      version: '1.0.0',
      networks: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get network entry from registry index by network ID
   */
  async getNetworkFromIndex(networkId: string): Promise<{
    networkId: string;
    ipfsCid: string;
    gitUrl?: string;
  } | null> {
    const index = await this.getRegistryIndex();
    if (!index) {
      return null;
    }

    const network = index.networks.find(n => n.networkId === networkId);
    if (!network) {
      return null;
    }

    return {
      networkId: network.networkId,
      ipfsCid: network.ipfsCid,
      gitUrl: network.gitUrl,
    };
  }

  /**
   * Update registry index with new network
   * Creates/updates the registry index and uploads to IPFS
   * Note: In a fully decentralized system, multiple parties can maintain their own indexes
   */
  async registerNetwork(manifest: NetworkManifest): Promise<void> {
    this.logger.info('Registering network in index', { 
      networkId: manifest.networkId, 
      ipfsCid: manifest.registry.ipfsCid 
    });

    try {
      // Get current index (or create new one)
      let index = await this.getRegistryIndex();
      if (!index) {
        index = {
          version: '1.0.0',
          networks: [],
          lastUpdated: new Date().toISOString(),
        };
      }

      // Check if network already exists
      const existingIndex = index.networks.findIndex(n => n.networkId === manifest.networkId);
      const networkEntry = {
        networkId: manifest.networkId,
        name: manifest.name,
        category: manifest.category,
        ipfsCid: manifest.registry.ipfsCid,
        gitUrl: manifest.registry.gitUrl,
        createdAt: manifest.createdAt,
        creatorAddress: manifest.creatorAddress,
        settlementChain: manifest.settlement.chain,
      };

      if (existingIndex >= 0) {
        // Update existing entry
        index.networks[existingIndex] = networkEntry;
        this.logger.info('Updated network in registry index', { networkId: manifest.networkId });
      } else {
        // Add new entry
        index.networks.push(networkEntry);
        this.logger.info('Added network to registry index', { networkId: manifest.networkId });
      }

      index.lastUpdated = new Date().toISOString();

      // Upload updated index to IPFS
      if (this.config.pinningService) {
        // Use public API for now (pinning service method can be added later)
        const cid = await this.uploadIndexViaPublicAPI(index);
        this.logger.info('Registry index updated on IPFS', { cid });
        
        // Update cache
        this.registryIndexCache = index;
        this.registryIndexCacheTime = Date.now();
      } else {
        // Try public API
        const cid = await this.uploadIndexViaPublicAPI(index);
        this.logger.info('Registry index updated on IPFS (public API)', { cid });
        
        // Note: Public IPFS may not persist, recommend using pinning service
        this.logger.warn('Using public IPFS for registry index - may not persist. Set PINATA_API_KEY for reliable pinning.');
      }

      // Note: In a fully decentralized system, there's no single canonical registry
      // Multiple parties can maintain their own indexes, and clients can:
      // 1. Query multiple indexes
      // 2. Use Git repository mirrors
      // 3. Use P2P discovery (LibP2P)
      // 4. Maintain client-side indexes

    } catch (error) {
      this.logger.error('Failed to register network in index', { 
        networkId: manifest.networkId, 
        error 
      });
      // Don't throw - network registration should not fail if index update fails
      // The network manifest is already on IPFS, index is just for discovery
    }
  }

  /**
   * Upload registry index via public IPFS API
   * CRITICAL: No Pinata dependency - uses public IPFS
   * This is just ONE index - others can maintain their own (decentralized)
   */

  /**
   * Upload registry index via public IPFS API
   */
  private async uploadIndexViaPublicAPI(index: NetworkRegistryIndex): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' });
    formData.append('file', blob, 'networks.json');

    const response = await axios.post(
      `${this.config.ipfsApiUrl}/add`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    return response.data.Hash;
  }
}
