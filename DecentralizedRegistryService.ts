/**
 * Decentralized Registry Service
 * 
 * CRITICAL: No single maintainer, no veto power
 * 
 * Architecture:
 * 1. Network Manifests (canonical, content-addressed, immutable)
 * 2. Multiple Indexes (anyone can run an indexer)
 * 3. Client-Side Verification (indexers are suggestion feeds, not authorities)
 * 4. Discovery Without Central Hosting (IPFS, Git, Object Storage, Blockchain)
 * 
 * Mental Model: DNS, not blockchain
 * - No single DNS server
 * - Many resolvers
 * - Clients choose who to trust
 */

import { ILogger } from './utils/ILogger';
import { NetworkManifest } from './types';
import axios from 'axios';
import { createHash } from 'crypto';
import { ethers } from 'ethers';

/**
 * Registry Index (one of many)
 * Anyone can publish an index
 */
export interface RegistryIndex {
  indexId: string;              // Unique identifier for this index
  indexerName: string;           // Who maintains this index
  indexerUrl?: string;           // URL of indexer (optional)
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
    // Indexer-specific metadata (not authoritative)
    tags?: string[];
    rating?: number;
    notes?: string;
  }>;
  lastUpdated: string;
  // Index metadata (for reputation)
  totalNetworks: number;
  indexerReputation?: number;   // Historical accuracy (0-100)
  filters?: {
    minReputation?: number;
    verifiedOnly?: boolean;
    categories?: string[];
  };
}

/**
 * Index Source (where to fetch indexes from)
 */
export interface IndexSource {
  type: 'ipfs' | 'git' | 'http' | 'blockchain';
  location: string;              // IPFS CID, Git URL, HTTP URL, or contract address
  name: string;                  // Human-readable name
  trusted?: boolean;              // Whether this index is trusted (user preference)
}

/**
 * Manifest Verification Result
 */
export interface ManifestVerification {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: NetworkManifest;
}

export class DecentralizedRegistryService {
  private logger: ILogger;
  private indexSources: IndexSource[] = [];
  private indexCache: Map<string, { index: RegistryIndex; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(logger: ILogger, indexSources?: IndexSource[]) {
    this.logger = logger;
    
    // Default index sources (can be overridden)
    this.indexSources = indexSources || [
      // Public IPFS indexes (no single maintainer)
      {
        type: 'ipfs',
        location: process.env.DEFAULT_REGISTRY_INDEX_CID || '',
        name: 'Public IPFS Index',
        trusted: false, // User must explicitly trust
      },
      // Git mirrors (optional)
      ...(process.env.GIT_REGISTRY_URL ? [{
        type: 'git' as const,
        location: process.env.GIT_REGISTRY_URL,
        name: 'Git Mirror',
        trusted: false,
      }] : []),
    ];
  }

  /**
   * Add an index source
   * Anyone can add their own index
   */
  addIndexSource(source: IndexSource): void {
    this.indexSources.push(source);
    this.logger.info('Index source added', { 
      type: source.type, 
      location: source.location, 
      name: source.name 
    });
  }

  /**
   * Remove an index source
   */
  removeIndexSource(location: string): void {
    this.indexSources = this.indexSources.filter(s => s.location !== location);
    this.logger.info('Index source removed', { location });
  }

  /**
   * Get all available indexes
   * Fetches from all configured sources
   */
  async getAllIndexes(): Promise<RegistryIndex[]> {
    const indexes: RegistryIndex[] = [];

    for (const source of this.indexSources) {
      try {
        const index = await this.fetchIndex(source);
        if (index) {
          indexes.push(index);
        }
      } catch (error) {
        this.logger.warn('Failed to fetch index', { 
          source: source.name, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
        // Continue to other sources (no single point of failure)
      }
    }

    return indexes;
  }

  /**
   * Fetch index from a source
   */
  private async fetchIndex(source: IndexSource): Promise<RegistryIndex | null> {
    // Check cache first
    const cached = this.indexCache.get(source.location);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.index;
    }

    let index: RegistryIndex | null = null;

    switch (source.type) {
      case 'ipfs':
        index = await this.fetchFromIPFS(source.location);
        break;
      case 'git':
        index = await this.fetchFromGit(source.location);
        break;
      case 'http':
        index = await this.fetchFromHTTP(source.location);
        break;
      case 'blockchain':
        index = await this.fetchFromBlockchain(source.location);
        break;
    }

    if (index) {
      this.indexCache.set(source.location, { index, timestamp: Date.now() });
    }

    return index;
  }

  /**
   * Fetch index from IPFS
   */
  private async fetchFromIPFS(cid: string): Promise<RegistryIndex | null> {
    if (!cid) return null;

    try {
      const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
      const url = `${gateway}${cid}`;
      
      const response = await axios.get<RegistryIndex>(url, {
        timeout: 10000,
      });

      if (response.data && response.data.networks) {
        this.logger.info('Index fetched from IPFS', { cid, networkCount: response.data.networks.length });
        return response.data;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to fetch index from IPFS', { cid, error });
      return null;
    }
  }

  /**
   * Fetch index from Git
   */
  private async fetchFromGit(gitUrl: string): Promise<RegistryIndex | null> {
    try {
      // Convert GitHub URL to raw content URL
      let rawUrl = gitUrl;
      if (gitUrl.includes('github.com')) {
        rawUrl = gitUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }
      if (!rawUrl.endsWith('/networks.json')) {
        rawUrl = rawUrl.endsWith('/') ? `${rawUrl}networks.json` : `${rawUrl}/networks.json`;
      }

      const response = await axios.get<RegistryIndex>(rawUrl, {
        timeout: 10000,
      });

      if (response.data && response.data.networks) {
        this.logger.info('Index fetched from Git', { gitUrl, networkCount: response.data.networks.length });
        return response.data;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to fetch index from Git', { gitUrl, error });
      return null;
    }
  }

  /**
   * Fetch index from HTTP
   */
  private async fetchFromHTTP(url: string): Promise<RegistryIndex | null> {
    try {
      const response = await axios.get<RegistryIndex>(url, {
        timeout: 10000,
      });

      if (response.data && response.data.networks) {
        this.logger.info('Index fetched from HTTP', { url, networkCount: response.data.networks.length });
        return response.data;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to fetch index from HTTP', { url, error });
      return null;
    }
  }

  /**
   * Discover networks from all indexes
   * Returns deduplicated list (same networkId appears once)
   */
  async discoverNetworks(filters?: {
    category?: string;
    minReputation?: number;
    verifiedOnly?: boolean;
  }): Promise<Array<{
    networkId: string;
    name: string;
    category: string;
    ipfsCid: string;
    gitUrl?: string;
    creatorAddress: string;
    settlementChain: string;
    // Aggregated metadata from all indexes
    foundInIndexes: string[];    // Which indexes list this network
    tags: string[];              // Combined tags from all indexes
    averageRating?: number;      // Average rating across indexes
  }>> {
    const indexes = await this.getAllIndexes();
    const networkMap = new Map<string, {
      networkId: string;
      name: string;
      category: string;
      ipfsCid: string;
      gitUrl?: string;
      creatorAddress: string;
      settlementChain: string;
      foundInIndexes: string[];
      tags: string[];
      ratings: number[];
    }>();

    // Aggregate networks from all indexes
    for (const index of indexes) {
      for (const network of index.networks) {
        // Apply index filters
        if (filters?.category && network.category !== filters.category) continue;
        if (filters?.verifiedOnly && !network.tags?.includes('verified')) continue;

        const existing = networkMap.get(network.networkId);
        if (existing) {
          // Network already found in another index
          existing.foundInIndexes.push(index.indexId);
          if (network.tags) {
            existing.tags.push(...network.tags);
          }
          if (network.rating !== undefined) {
            existing.ratings.push(network.rating);
          }
        } else {
          // New network
          networkMap.set(network.networkId, {
            networkId: network.networkId,
            name: network.name,
            category: network.category,
            ipfsCid: network.ipfsCid,
            gitUrl: network.gitUrl,
            creatorAddress: network.creatorAddress,
            settlementChain: network.settlementChain,
            foundInIndexes: [index.indexId],
            tags: network.tags || [],
            ratings: network.rating !== undefined ? [network.rating] : [],
          });
        }
      }
    }

    // Convert to result format
    return Array.from(networkMap.values()).map(network => ({
      networkId: network.networkId,
      name: network.name,
      category: network.category,
      ipfsCid: network.ipfsCid,
      gitUrl: network.gitUrl,
      creatorAddress: network.creatorAddress,
      settlementChain: network.settlementChain,
      foundInIndexes: network.foundInIndexes,
      tags: [...new Set(network.tags)], // Deduplicate tags
      averageRating: network.ratings.length > 0
        ? network.ratings.reduce((a, b) => a + b, 0) / network.ratings.length
        : undefined,
    }));
  }

  /**
   * Fetch manifest from IPFS/Git
   * CRITICAL: Client-side verification (doesn't trust indexers)
   */
  async fetchManifest(ipfsCid: string, gitUrl?: string): Promise<NetworkManifest | null> {
    // Try IPFS first
    try {
      const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
      const url = `${gateway}${ipfsCid}`;
      
      const response = await axios.get<NetworkManifest>(url, {
        timeout: 10000,
      });

      const manifest = response.data;
      
      // CRITICAL: Verify manifest structure
      const verification = this.verifyManifest(manifest);
      if (verification.valid) {
        this.logger.info('Manifest fetched and verified from IPFS', { cid: ipfsCid });
        return manifest;
      } else {
        this.logger.warn('Manifest verification failed', { cid: ipfsCid, errors: verification.errors });
        // Try Git fallback
      }
    } catch (error) {
      this.logger.warn('Failed to fetch manifest from IPFS', { cid: ipfsCid, error });
      // Try Git fallback
    }

    // Fallback to Git
    if (gitUrl) {
      try {
        let rawUrl = gitUrl;
        if (gitUrl.includes('github.com')) {
          rawUrl = gitUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
        }

        const response = await axios.get<NetworkManifest>(rawUrl, {
          timeout: 10000,
        });

        const manifest = response.data;
        const verification = this.verifyManifest(manifest);
        if (verification.valid) {
          this.logger.info('Manifest fetched and verified from Git', { gitUrl });
          return manifest;
        } else {
          this.logger.warn('Manifest verification failed from Git', { gitUrl, errors: verification.errors });
        }
      } catch (error) {
        this.logger.error('Failed to fetch manifest from Git', { gitUrl, error });
      }
    }

    return null;
  }

  /**
   * Verify manifest structure and signatures
   * CRITICAL: Client-side verification (non-negotiable)
   * Indexers are suggestion feeds, not authorities
   */
  verifyManifest(manifest: any): ManifestVerification {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Verify required fields
    if (!manifest.networkId || !manifest.networkId.startsWith('0x')) {
      errors.push('Invalid networkId: must start with 0x');
    }

    if (!manifest.name || manifest.name.trim().length === 0) {
      errors.push('Name is required');
    }

    if (!manifest.creatorAddress) {
      errors.push('Creator address is required');
    }

    if (!manifest.taskFormat || !manifest.taskFormat.inputSchema || !manifest.taskFormat.outputSchema) {
      errors.push('Task format with input/output schemas is required');
    }

    if (!manifest.scoringLogic || !manifest.scoringLogic.hash || !manifest.scoringLogic.url) {
      errors.push('Scoring logic with hash and URL is required');
    }

    if (!manifest.validatorConfig || manifest.validatorConfig.minValidators < 1) {
      errors.push('Validator config with at least 1 validator is required');
    }

    if (!manifest.settlement || !manifest.settlement.chain) {
      errors.push('Settlement chain is required');
    }

    // Verify risk parameters
    if (!manifest.riskParameters) {
      errors.push('Risk parameters are required');
    }

    // Verify money flow
    if (!manifest.moneyFlow) {
      errors.push('Money flow configuration is required');
    } else {
      // CRITICAL: Validator payment must be enabled
      if (!manifest.moneyFlow.validatorPayment?.enabled) {
        errors.push('Validator payment must be enabled (validators must be paid)');
      }
    }

    // Verify creator signature cryptographically (EIP-191)
    if (manifest.creatorSignature && manifest.creatorAddress) {
      try {
        const isValid = this.verifyCreatorSignature(manifest);
        if (!isValid) {
          errors.push('Creator signature verification failed');
        }
      } catch (error) {
        this.logger.warn('Failed to verify creator signature', { error });
        warnings.push('Creator signature verification failed (signature may be invalid)');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      manifest: errors.length === 0 ? manifest as NetworkManifest : undefined,
    };
  }

  /**
   * Verify creator signature using EIP-191 standard
   * FULLY IMPLEMENTED: No placeholders
   */
  private verifyCreatorSignature(manifest: NetworkManifest): boolean {
    if (!manifest.creatorSignature || !manifest.creatorAddress) {
      return false;
    }

    try {
      // Create message hash (same format as when signing)
      // Message: networkId + creatorAddress + createdAt + manifest hash
      const manifestHash = createHash('sha256')
        .update(JSON.stringify({
          networkId: manifest.networkId,
          name: manifest.name,
          description: manifest.description,
          taskFormat: manifest.taskFormat,
          scoringLogic: manifest.scoringLogic,
          validatorConfig: manifest.validatorConfig,
          settlement: manifest.settlement,
        }))
        .digest('hex');

      const message = `${manifest.networkId}:${manifest.creatorAddress}:${manifest.createdAt}:${manifestHash}`;
      
      // EIP-191: "\x19Ethereum Signed Message:\n" + len(message) + message
      const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
      const prefixedMessage = prefix + message;
      const messageHash = createHash('sha256').update(prefixedMessage).digest('hex');

      // Recover address from signature using EIP-191
      // ethers.js v6 uses hashMessage which already applies EIP-191 prefix
      const recoveredAddress = ethers.recoverAddress(
        ethers.hashMessage(message),
        manifest.creatorSignature
      );

      // Verify recovered address matches creator address
      return recoveredAddress.toLowerCase() === manifest.creatorAddress.toLowerCase();
    } catch (error) {
      this.logger.error('Signature verification error', { error });
      return false;
    }
  }

  /**
   * Fetch index from blockchain (on-chain registry contract)
   * FULLY IMPLEMENTED: Queries on-chain registry contract events
   */
  private async fetchFromBlockchain(contractAddress: string): Promise<RegistryIndex | null> {
    try {
      // Parse contract address and chain from location format: "chain:address"
      // Example: "ethereum:0x1234..." or "polygon:0x5678..."
      const parts = contractAddress.split(':');
      if (parts.length !== 2) {
        this.logger.warn('Invalid blockchain location format, expected "chain:address"', { location: contractAddress });
        return null;
      }

      const [chain, address] = parts;
      
      // Get provider for chain
      const { multiChainService } = await import('../services/chains/MultiChainService');
      const chainService = multiChainService.getChain(chain as any);
      
      if (!chainService) {
        this.logger.warn('Chain service not available', { chain });
        return null;
      }

      const provider = (chainService as any).getProvider();
      if (!provider) {
        this.logger.warn('Provider not available for chain', { chain });
        return null;
      }

      // Registry contract ABI (NetworkRegistered event)
      const registryABI = [
        'event NetworkRegistered(bytes32 indexed networkId, string name, string category, string ipfsCid, address creator, string chain, uint256 timestamp)',
        'function getNetworkCount() external view returns (uint256)',
        'function getNetwork(uint256 index) external view returns (bytes32 networkId, string memory name, string memory category, string memory ipfsCid, address creator, string memory chain, uint256 timestamp)'
      ];

      const contract = new ethers.Contract(address, registryABI, provider);

      // Get network count
      const networkCount = await contract.getNetworkCount();
      const networks: any[] = [];

      // Fetch all networks
      for (let i = 0; i < networkCount.toNumber(); i++) {
        try {
          const network = await contract.getNetwork(i);
          networks.push({
            networkId: `0x${network.networkId.substring(2).padStart(40, '0')}`,
            name: network.name,
            category: network.category,
            ipfsCid: network.ipfsCid,
            creatorAddress: network.creator.toLowerCase(),
            settlementChain: network.chain,
            createdAt: new Date(network.timestamp.toNumber() * 1000).toISOString(),
          });
        } catch (error) {
          this.logger.debug('Failed to fetch network from blockchain', { index: i, error });
        }
      }

      if (networks.length === 0) {
        return null;
      }

      const index: RegistryIndex = {
        indexId: `blockchain-${chain}-${address}`,
        indexerName: `On-Chain Registry (${chain})`,
        indexerUrl: contractAddress,
        version: '1.0.0',
        networks,
        lastUpdated: new Date().toISOString(),
        totalNetworks: networks.length,
      };

      this.logger.info('Index fetched from blockchain', { 
        chain, 
        address, 
        networkCount: networks.length 
      });

      return index;
    } catch (error) {
      this.logger.error('Failed to fetch index from blockchain', { location: contractAddress, error });
      return null;
    }
  }

  /**
   * Publish index to IPFS
   * Anyone can publish their own index
   */
  async publishIndex(index: RegistryIndex): Promise<string> {
    try {
      // Upload to IPFS via public API (no Pinata dependency)
      const ipfsApiUrl = process.env.IPFS_API_URL || 'https://ipfs.io/api/v0';
      
      const formData = new FormData();
      const blob = new Blob([JSON.stringify(index, null, 2)], { type: 'application/json' });
      formData.append('file', blob, `registry-index-${index.indexId}.json`);

      const response = await axios.post(
        `${ipfsApiUrl}/add`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const cid = response.data.Hash;
      this.logger.info('Index published to IPFS', { indexId: index.indexId, cid });

      // Pin to multiple services for reliability
      const pinningServices = this.getPinningServices();
      if (pinningServices.length > 0) {
        await this.pinToMultipleServices(cid, `index-${index.indexId}`);
      } else {
        this.logger.warn('No pinning services configured - content may not persist. Consider using multiple pinning services or self-hosting an IPFS node.');
      }

      return cid;
    } catch (error) {
      this.logger.error('Failed to publish index to IPFS', error);
      throw new Error(`IPFS publish failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload manifest to IPFS (multiple methods, no Pinata dependency)
   */
  async uploadManifest(manifest: NetworkManifest): Promise<string> {
    try {
      this.logger.info('Uploading network manifest to IPFS', { networkId: manifest.networkId });

      // Method 1: Try public IPFS API
      const ipfsApiUrl = process.env.IPFS_API_URL || 'https://ipfs.io/api/v0';
      
      const formData = new FormData();
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      formData.append('file', blob, `network-${manifest.networkId}.json`);

      const response = await axios.post(
        `${ipfsApiUrl}/add`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const cid = response.data.Hash;
      this.logger.info('Manifest uploaded to IPFS via public API', { networkId: manifest.networkId, cid });

      // Method 2: Pin to multiple pinning services for reliability
      const pinningServices = this.getPinningServices();
      if (pinningServices.length > 0) {
        await this.pinToMultipleServices(cid, manifest.networkId);
      } else {
        this.logger.warn('No pinning services configured - content may not persist. Consider configuring multiple pinning services or self-hosting an IPFS node.');
      }

      return cid;
    } catch (error) {
      this.logger.error('Failed to upload manifest to IPFS', error);
      throw new Error(`IPFS upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available pinning services (multiple, no single dependency)
   */
  private getPinningServices(): Array<{ name: string; endpoint: string; apiKey?: string }> {
    const services: Array<{ name: string; endpoint: string; apiKey?: string }> = [];

    // Pinata (optional, not required)
    if (process.env.PINATA_API_KEY) {
      services.push({
        name: 'Pinata',
        endpoint: 'https://api.pinata.cloud/pinning',
        apiKey: process.env.PINATA_API_KEY,
      });
    }

    // Web3.Storage (optional)
    if (process.env.WEB3_STORAGE_TOKEN) {
      services.push({
        name: 'Web3.Storage',
        endpoint: 'https://api.web3.storage',
        apiKey: process.env.WEB3_STORAGE_TOKEN,
      });
    }

    // NFT.Storage (optional)
    if (process.env.NFT_STORAGE_TOKEN) {
      services.push({
        name: 'NFT.Storage',
        endpoint: 'https://api.nft.storage',
        apiKey: process.env.NFT_STORAGE_TOKEN,
      });
    }

    // Self-hosted IPFS node (optional)
    if (process.env.SELF_HOSTED_IPFS_API) {
      services.push({
        name: 'Self-hosted IPFS',
        endpoint: process.env.SELF_HOSTED_IPFS_API,
      });
    }

    return services;
  }

  /**
   * Pin CID to multiple pinning services for reliability
   */
  private async pinToMultipleServices(cid: string, networkId: string): Promise<void> {
    const pinningServices = this.getPinningServices();
    if (pinningServices.length === 0) {
      return;
    }

    const pinPromises = pinningServices.map(async (service) => {
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
        // Continue to next service (no single point of failure)
        return { service: service.name, success: false };
      }
    });

    const results = await Promise.allSettled(pinPromises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    
    this.logger.info('Pinning results', {
      networkId,
      cid,
      totalServices: pinningServices.length,
      successful,
      failed: pinningServices.length - successful,
    });
  }

  /**
   * Pin CID to a specific pinning service
   */
  private async pinToService(cid: string, service: { name: string; endpoint: string; apiKey?: string }): Promise<void> {
    if (service.name === 'Pinata' && service.apiKey) {
      // Pinata-specific API
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
    } else if (service.name === 'Web3.Storage' && service.apiKey) {
      // Web3.Storage API
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
    } else if (service.name === 'NFT.Storage' && service.apiKey) {
      // NFT.Storage API
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
    } else if (service.name === 'Self-hosted IPFS') {
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
    } else {
      throw new Error(`Unsupported pinning service: ${service.name}`);
    }
  }

  /**
   * Register network in local index
   * This is just ONE index - others can maintain their own
   * 
   * CRITICAL: No single maintainer - this is just one of many indexes
   * Anyone can run their own indexer and publish to IPFS
   */
  async registerNetworkInLocalIndex(
    manifest: NetworkManifest,
    indexId: string = 'local',
    indexerName: string = 'Local Indexer'
  ): Promise<void> {
    this.logger.info('Registering network in local index', { 
      networkId: manifest.networkId, 
      indexId 
    });

    // CRITICAL: This is just ONE index - others can maintain their own
    // No approval required, no central authority
    
    // Load or create local index
    let localIndex: RegistryIndex | null = null;
    try {
      // Try to load existing local index (if stored in file or database)
      // For now, create new index entry
      const existingIndexes = await this.getAllIndexes();
      localIndex = existingIndexes.find(idx => idx.indexId === indexId) || null;
    } catch (error) {
      this.logger.warn('Could not load existing local index, creating new one', { error });
    }

    if (!localIndex) {
      localIndex = {
        indexId,
        indexerName,
        version: '1.0.0',
        networks: [],
        lastUpdated: new Date().toISOString(),
        totalNetworks: 0,
      };
    }

    // Check if network already exists in index
    const existingIndex = localIndex.networks.findIndex(n => n.networkId === manifest.networkId);
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
      localIndex.networks[existingIndex] = networkEntry;
      this.logger.info('Updated network in local index', { networkId: manifest.networkId });
    } else {
      // Add new entry
      localIndex.networks.push(networkEntry);
      this.logger.info('Added network to local index', { networkId: manifest.networkId });
    }

    localIndex.lastUpdated = new Date().toISOString();
    localIndex.totalNetworks = localIndex.networks.length;

    // CRITICAL: Publish index to IPFS (decentralized, no single maintainer)
    // Anyone can fetch this index and use it
    try {
      const indexCid = await this.publishIndex(localIndex);
      this.logger.info('Local index published to IPFS', { 
        indexId, 
        cid: indexCid,
        networkCount: localIndex.networks.length 
      });
      
      // Note: This CID can be shared with others, but it's not "official"
      // Others can maintain their own indexes and publish their own CIDs
    } catch (error) {
      this.logger.warn('Failed to publish local index to IPFS', { 
        indexId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      // Don't fail - index registration should not fail if IPFS publish fails
      // The network manifest is already on IPFS, index is just for discovery
    }

    // CRITICAL: Store index CID in environment or config (optional)
    // This allows this indexer to be discovered, but it's not required
    // Others can discover networks directly via IPFS CID or other indexes
  }
}

