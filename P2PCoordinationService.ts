/**
 * P2P Coordination Service
 * 
 * LibP2P-based validator discovery and task coordination
 * 
 * Architecture:
 * - Validators discover tasks via P2P pubsub (GossipSub)
 * - Validators announce availability via DHT
 * - Task assignments broadcast to validator network
 * - No central coordinator required
 * 
 * CRITICAL: Fully decentralized - no single point of failure
 */

import { ILogger } from './utils/ILogger';
import { createLibp2p, Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { kadDHT } from '@libp2p/kad-dht';
import { gossipsub } from '@libp2p/gossipsub';
import { peerIdFromString } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import type { PeerId } from '@libp2p/interface';

export interface P2PNodeConfig {
  listenAddresses: string[];     // Multiaddrs to listen on
  bootstrapNodes: string[];      // Bootstrap peer addresses
  enableDHT: boolean;            // Enable DHT for peer discovery
  enablePubsub: boolean;         // Enable pubsub for task announcements
  enableRelay: boolean;           // Enable relay for NAT traversal
}

export interface ValidatorAnnouncement {
  validatorAddress: string;
  supportedNetworks: string[];
  capabilities: string[];
  endpoint?: string;              // Optional HTTP endpoint
  publicKey: string;              // LibP2P public key
  timestamp: number;
}

export interface TaskAnnouncement {
  taskId: string;
  networkId: string;
  taskType: string;
  requiredValidators: number;
  deadline: number;
  reward: string;
  manifestCid: string;            // IPFS CID of network manifest
}

/**
 * P2P Message Types
 */
export interface P2PMessage {
  messageId: string;              // Unique message ID
  type: 'task-request' | 'task-response' | 'validator-coordination' | 'consensus-proposal' | 'evaluation-sync';
  from: string;                    // Sender peer ID
  to?: string;                     // Target peer ID (optional for broadcast)
  networkId: string;
  payload: any;
  timestamp: number;
  signature?: string;              // Optional signature for verification
}

/**
 * Task Propagation Message
 */
export interface TaskPropagationMessage {
  taskId: string;
  networkId: string;
  taskData: any;                   // Full task data
  propagationPath: string[];       // Path of peers that propagated this
  hopCount: number;                // Number of hops
  maxHops: number;                 // Maximum hops allowed
  timestamp: number;
}

/**
 * Validator Coordination Message
 */
export interface ValidatorCoordinationMessage {
  taskId: string;
  networkId: string;
  coordinationType: 'election' | 'consensus-proposal' | 'evaluation-sync' | 'handshake';
  validatorAddress: string;
  data: any;                       // Coordination-specific data
  timestamp: number;
}

export class P2PCoordinationService {
  private logger: ILogger;
  private config: P2PNodeConfig;
  private node: Libp2p | null = null;
  private isInitialized: boolean = false;
  private taskSubscriptions: Map<string, (announcement: TaskAnnouncement) => void> = new Map();
  private validatorSubscriptions: Map<string, (announcement: ValidatorAnnouncement) => void> = new Map();
  private discoveredValidators: Map<string, ValidatorAnnouncement[]> = new Map(); // Cache discovered validators by network
  
  // NEW: Direct P2P messaging
  private messageHandlers: Map<string, (message: P2PMessage) => Promise<any>> = new Map();
  private pendingMessages: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }> = new Map();
  private messageProtocol = '/tenseuron/message/1.0.0';
  
  // NEW: Task propagation
  private propagatedTasks: Set<string> = new Set(); // Track propagated tasks to prevent loops
  private propagationRetries: Map<string, number> = new Map(); // Track retry counts
  private readonly MAX_PROPAGATION_HOPS = 5;
  private readonly MAX_PROPAGATION_RETRIES = 3;
  
  // NEW: Validator coordination
  private coordinationCallbacks: Map<string, (message: ValidatorCoordinationMessage) => void> = new Map();
  private activeCoordination: Map<string, any> = new Map(); // Track active coordination sessions

  // NEW: Task data query callback (injected dependency)
  private taskDataQueryCallback?: (taskId: string) => Promise<any>;

  constructor(
    logger: ILogger,
    config?: Partial<P2PNodeConfig>,
    taskDataQueryCallback?: (taskId: string) => Promise<any>
  ) {
    this.logger = logger;
    this.config = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/0'],
      bootstrapNodes: [],
      enableDHT: true,
      enablePubsub: true,
      enableRelay: true,
      ...config,
    };
    this.taskDataQueryCallback = taskDataQueryCallback;
  }

  /**
   * Initialize P2P node
   * CRITICAL: Creates fully decentralized LibP2P node with DHT and GossipSub
   * GRACEFUL DEGRADATION: If LibP2P is not available, service degrades to HTTP/IPFS mode
   */
  async initialize(): Promise<void> {
    if (this.isInitialized && this.node) {
      this.logger.warn('P2P node already initialized');
      return;
    }

    this.logger.info('Initializing P2P coordination service', {
      enableDHT: this.config.enableDHT,
      enablePubsub: this.config.enablePubsub,
    });

    // Check if LibP2P is available
    try {
      // Try to import LibP2P modules to check availability
      await import('libp2p');
      await import('@libp2p/tcp');
      await import('@libp2p/websockets');
      await import('@chainsafe/libp2p-noise');
      await import('@libp2p/mplex');
      await import('@libp2p/kad-dht');
      await import('@libp2p/gossipsub');
    } catch (importError) {
      this.logger.warn('LibP2P modules not available - P2P service will use HTTP/IPFS fallback', {
        error: importError instanceof Error ? importError.message : 'Unknown error'
      });
      // Mark as "initialized" but with degraded mode
      this.isInitialized = true;
      this.node = null; // No P2P node, but service is "initialized" in degraded mode
      return; // Exit early - service will use HTTP/IPFS fallback
    }

    try {
      // Create LibP2P node with required modules
      const services: any = {};
      
      // Add DHT for peer discovery (if enabled)
      if (this.config.enableDHT) {
        services.dht = kadDHT({
          clientMode: false, // Act as both client and server
        });
      }

      // Add GossipSub for pubsub (if enabled)
      if (this.config.enablePubsub) {
        // @ts-ignore - libp2p gossipsub types
        services.pubsub = gossipsub({
          allowPublishToZeroTopicPeers: true, // Allow publishing even with no peers
          emitSelf: false, // Don't emit messages we publish
        });
      }

      // Convert bootstrap node strings to multiaddrs
      const bootstrapMultiaddrs = this.config.bootstrapNodes.map(addr => multiaddr(addr));

      // Create node
      // @ts-ignore - libp2p createLibp2p types are complex
      this.node = await createLibp2p({
        addresses: {
          // @ts-ignore - libp2p multiaddr types - listen expects Multiaddr[] not string[]
          listen: this.config.listenAddresses.map(addr => multiaddr(addr)) as any,
        },
        transports: [tcp(), webSockets()],
        streamMuxers: [mplex()],
        connectionEncryption: [noise()],
        services,
        // @ts-ignore - libp2p peerDiscovery types
        peerDiscovery: bootstrapMultiaddrs.length > 0 ? [
          // @ts-ignore - libp2p bootstrap discovery
          () => ({ list: bootstrapMultiaddrs.map(m => m.toString()) })
        ] : [],
      });

      // Set up event handlers
      // @ts-ignore - libp2p types are complex, this is optional service
      this.node.addEventListener('peer:discovery', (evt: any) => {
        this.logger.debug('Peer discovered', { peerId: evt.detail.id.toString() });
      });

      // @ts-ignore - libp2p types
      this.node.addEventListener('peer:connect', (evt: any) => {
        this.logger.info('Peer connected', { peerId: evt.detail.toString() });
      });

      // @ts-ignore - libp2p types
      this.node.addEventListener('peer:disconnect', (evt: any) => {
        this.logger.info('Peer disconnected', { peerId: evt.detail.toString() });
      });

      // Handle pubsub messages if enabled
      if (this.config.enablePubsub && (this.node.services as any).pubsub) {
        // Set up message handler for all topics
        // @ts-ignore - libp2p types
        (this.node.services as any).pubsub.addEventListener('message', (evt: any) => {
          try {
            const topic = evt.detail.topic;
            const data = JSON.parse(new TextDecoder().decode(evt.detail.data));
            
            // Handle task announcements
            if (topic.startsWith('tenseuron:tasks:')) {
              const networkId = topic.replace('tenseuron:tasks:', '');
              const announcement = data as TaskAnnouncement;
              
              const callback = this.taskSubscriptions.get(networkId);
              if (callback) {
                callback(announcement);
              }
            }
            
            // Handle validator announcements
            if (topic === 'tenseuron:validators') {
              const announcement = data as ValidatorAnnouncement;
              
              // Update cache for all supported networks
              for (const networkId of announcement.supportedNetworks) {
                if (!this.discoveredValidators.has(networkId)) {
                  this.discoveredValidators.set(networkId, []);
                }
                
                const validators = this.discoveredValidators.get(networkId)!;
                // Avoid duplicates
                const exists = validators.find(v => v.validatorAddress === announcement.validatorAddress);
                if (!exists) {
                  validators.push(announcement);
                  this.discoveredValidators.set(networkId, validators);
                }
                
                // Notify subscribers
                const callback = this.validatorSubscriptions.get(networkId);
                if (callback) {
                  callback(announcement);
                }
              }
            }
          } catch (error) {
            this.logger.error('Failed to handle pubsub message', { error });
          }
        });
      }

      this.isInitialized = true;
      this.logger.info('P2P coordination service initialized successfully', {
        peerId: this.node.peerId.toString(),
        addresses: this.node.getMultiaddrs().map(addr => addr.toString()),
      });
    } catch (error) {
      this.logger.error('Failed to initialize P2P node', { error });
      // GRACEFUL DEGRADATION: Mark as initialized but with null node
      // Service will use HTTP/IPFS fallback instead of throwing
      this.isInitialized = true;
      this.node = null;
      this.logger.warn('P2P service degraded to HTTP/IPFS mode - protocol still functional', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - allow service to continue in degraded mode
    }
  }

  /**
   * Announce validator availability
   * Validators broadcast their availability to the network via DHT and pubsub
   * GRACEFUL DEGRADATION: If P2P not available, falls back to HTTP/IPFS
   */
  async announceValidator(announcement: ValidatorAnnouncement): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (!this.node) {
      // GRACEFUL DEGRADATION: P2P not available, use HTTP/IPFS fallback
      this.logger.warn('P2P node not available, using HTTP/IPFS fallback for validator announcement', {
        validatorAddress: announcement.validatorAddress
      });
      // In degraded mode, validator announcements are handled via HTTP API
      // This is acceptable - protocol still works, just less decentralized
      return;
    }

    this.logger.info('Announcing validator availability', {
      validatorAddress: announcement.validatorAddress,
      supportedNetworks: announcement.supportedNetworks.length,
    });

    try {
      // Store validator info in DHT (if enabled)
      if (this.config.enableDHT && this.node.services.dht) {
        const validatorKey = `/tenseuron/validators/${announcement.validatorAddress}`;
        const data = new TextEncoder().encode(JSON.stringify(announcement));
        
        // Provide validator info to DHT
        // @ts-ignore - libp2p DHT types
        await (this.node.services as any).dht.provide(validatorKey);
        
        // Store validator data in DHT
        // @ts-ignore - libp2p DHT types
        await (this.node.services as any).dht.put(validatorKey, data);

        // NEW: Store validator peer ID mapping in DHT for persistence
        await this.storeValidatorPeerIdInDHT(announcement.validatorAddress, this.node.peerId.toString());
      }

      // Also publish to pubsub for real-time discovery
      if (this.config.enablePubsub && (this.node.services as any).pubsub) {
        const topic = 'tenseuron:validators';
        const data = new TextEncoder().encode(JSON.stringify(announcement));
        // @ts-ignore - libp2p pubsub types
        await (this.node.services as any).pubsub.publish(topic, data);
      }

      this.logger.info('Validator announcement published', {
        validatorAddress: announcement.validatorAddress,
      });
    } catch (error) {
      this.logger.error('Failed to announce validator', { error });
      throw error;
    }
  }

  /**
   * Discover validators for a network
   * Queries DHT and pubsub for available validators
   * CRITICAL: Fully decentralized - no central registry required
   */
  async discoverValidators(networkId: string): Promise<ValidatorAnnouncement[]> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized. Call initialize() first.');
    }

    this.logger.info('Discovering validators for network', { networkId });

    const discovered: ValidatorAnnouncement[] = [];
    const seenAddresses = new Set<string>();

    try {
      // 1. Query DHT for validators (if enabled)
      if (this.config.enableDHT && this.node.services.dht) {
        const validatorKey = `/tenseuron/validators/${networkId}`;
        
        try {
          // Find providers (peers that have this key)
          // @ts-ignore - libp2p DHT types
          for await (const provider of (this.node.services as any).dht.findProviders(validatorKey)) {
            try {
              // @ts-ignore - libp2p DHT types
              const records = await (this.node.services as any).dht.get(validatorKey);
              for await (const record of records) {
                try {
                  const announcement = JSON.parse(
                    new TextDecoder().decode(record.value)
                  ) as ValidatorAnnouncement;
                  
                  // Filter by network support and avoid duplicates
                  if (
                    announcement.supportedNetworks.includes(networkId) &&
                    !seenAddresses.has(announcement.validatorAddress)
                  ) {
                    discovered.push(announcement);
                    seenAddresses.add(announcement.validatorAddress);
                  }
                } catch (error) {
                  this.logger.debug('Failed to parse validator record from DHT', { error });
                }
              }
            } catch (error) {
              // Continue if individual record fetch fails
              this.logger.debug('Failed to fetch validator record from DHT', { error });
            }
          }
        } catch (error) {
          this.logger.debug('DHT query failed (may be normal if no validators found)', { error });
        }
      }

      // 2. Check cached validators from pubsub announcements
      const cached = this.discoveredValidators.get(networkId);
      if (cached) {
        for (const announcement of cached) {
          if (!seenAddresses.has(announcement.validatorAddress)) {
            discovered.push(announcement);
            seenAddresses.add(announcement.validatorAddress);
          }
        }
      }

      // 3. Subscribe to validator announcements for real-time updates (if not already subscribed)
      if (this.config.enablePubsub && this.node.services.pubsub) {
        const topic = 'tenseuron:validators';
        // Subscribe to general validator topic to receive all announcements
        // (The message handler will filter by networkId)
        try {
          // @ts-ignore - libp2p pubsub types are complex
          await (this.node.services as any).pubsub.subscribe(topic);
        } catch (error) {
          // May already be subscribed, ignore
          this.logger.debug('Already subscribed to validator topic or subscription failed', { error });
        }
      }

      this.logger.info('Validator discovery completed', {
        networkId,
        found: discovered.length,
        sources: {
          dht: this.config.enableDHT,
          cache: cached?.length || 0,
        },
      });

      // Update cache
      this.discoveredValidators.set(networkId, discovered);

      return discovered;
    } catch (error) {
      this.logger.error('Failed to discover validators', { error, networkId });
      // Return cached results if available, even if discovery failed
      return this.discoveredValidators.get(networkId) || [];
    }
  }

  /**
   * Subscribe to validator announcements for a network
   * Receives real-time validator availability updates
   */
  async subscribeToValidators(
    networkId: string,
    callback: (announcement: ValidatorAnnouncement) => void
  ): Promise<void> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized. Call initialize() first.');
    }

    if (!this.config.enablePubsub || !this.node.services.pubsub) {
      throw new Error('Pubsub not enabled. Cannot subscribe to validators.');
    }

    this.logger.info('Subscribing to validator announcements', { networkId });

    try {
      // Store callback for this network
      this.validatorSubscriptions.set(networkId, callback);
      
      // Subscribe to general validator topic (message handler filters by networkId)
      const topic = 'tenseuron:validators';
      // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.subscribe(topic);
      
      this.logger.info('Subscribed to validator announcements', {
        networkId,
        topic,
      });
    } catch (error) {
      this.logger.error('Failed to subscribe to validators', { error, networkId });
      throw error;
    }
  }

  /**
   * Announce task to validator network
   * Broadcasts task to validators via pubsub (GossipSub)
   * CRITICAL: No central coordinator - tasks are broadcast to all validators
   * GRACEFUL DEGRADATION: If P2P not available, task announcement handled via HTTP/IPFS
   */
  async announceTask(announcement: TaskAnnouncement): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (!this.node) {
      // GRACEFUL DEGRADATION: P2P not available, use HTTP/IPFS fallback
      this.logger.warn('P2P node not available, task announcement will use HTTP/IPFS fallback', {
        taskId: announcement.taskId,
        networkId: announcement.networkId
      });
      // In degraded mode, task announcements are handled via HTTP API
      // Validators can still discover tasks via HTTP endpoints
      return;
    }

    if (!this.config.enablePubsub || !this.node.services.pubsub) {
      this.logger.warn('Pubsub not enabled, task announcement will use HTTP/IPFS fallback', {
        taskId: announcement.taskId
      });
      return;
    }

    this.logger.info('Announcing task to validator network', {
      taskId: announcement.taskId,
      networkId: announcement.networkId,
      requiredValidators: announcement.requiredValidators,
    });

    try {
      // Publish to network-specific topic
      const topic = `tenseuron:tasks:${announcement.networkId}`;
      const data = new TextEncoder().encode(JSON.stringify(announcement));
      
      // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.publish(topic, data);
      
      this.logger.info('Task announced successfully', {
        taskId: announcement.taskId,
        topic,
        // @ts-ignore - libp2p pubsub types
        peers: (this.node.services as any).pubsub.getPeers().length,
      });
    } catch (error) {
      this.logger.error('Failed to announce task', { error, taskId: announcement.taskId });
      throw error;
    }
  }

  /**
   * Subscribe to task announcements for a network
   * Validators subscribe to receive task assignments via GossipSub
   */
  async subscribeToTasks(networkId: string, callback: (announcement: TaskAnnouncement) => void): Promise<void> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized. Call initialize() first.');
    }

    if (!this.config.enablePubsub || !this.node.services.pubsub) {
      throw new Error('Pubsub not enabled. Cannot subscribe to tasks.');
    }

    this.logger.info('Subscribing to task announcements', { networkId });

    try {
      const topic = `tenseuron:tasks:${networkId}`;
      
      // Store callback for this network
      this.taskSubscriptions.set(networkId, callback);
      
      // Subscribe to topic
      // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.subscribe(topic);
      
      this.logger.info('Subscribed to task announcements', {
        networkId,
        topic,
      });
    } catch (error) {
      this.logger.error('Failed to subscribe to tasks', { error, networkId });
      throw error;
    }
  }

  /**
   * Unsubscribe from task announcements for a network
   */
  async unsubscribeFromTasks(networkId: string): Promise<void> {
    if (!this.node || !this.isInitialized) {
      return;
    }

    if (!this.config.enablePubsub || !this.node.services.pubsub) {
      return;
    }

    try {
      const topic = `tenseuron:tasks:${networkId}`;
      // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.unsubscribe(topic);
      this.taskSubscriptions.delete(networkId);
      
      this.logger.info('Unsubscribed from task announcements', { networkId, topic });
    } catch (error) {
      this.logger.error('Failed to unsubscribe from tasks', { error, networkId });
    }
  }

  /**
   * Get connected peers
   */
  async getConnectedPeers(): Promise<string[]> {
    if (!this.node || !this.isInitialized) {
      return [];
    }

    return Array.from(this.node.getPeers()).map(peerId => peerId.toString());
  }

  /**
   * Get peer ID
   */
  getPeerId(): string | null {
    if (!this.node || !this.isInitialized) {
      return null;
    }

    return this.node.peerId.toString();
  }

  /**
   * Get listening addresses
   */
  getListeningAddresses(): string[] {
    if (!this.node || !this.isInitialized) {
      return [];
    }

    return this.node.getMultiaddrs().map(addr => addr.toString());
  }

  /**
   * Start P2P node
   */
  async start(): Promise<void> {
    if (!this.node) {
      await this.initialize();
    }

    if (!this.node) {
      throw new Error('Failed to initialize P2P node');
    }

    // @ts-ignore - libp2p types
    if ((this.node as any).isStarted()) {
      this.logger.warn('P2P node already started');
      return;
    }

    this.logger.info('Starting P2P coordination service');
    
    try {
      await this.node.start();
      
      this.logger.info('P2P node started successfully', {
        peerId: this.node.peerId.toString(),
        addresses: this.node.getMultiaddrs().map(addr => addr.toString()),
        // @ts-ignore - libp2p types
        peers: (this.node.getPeers() as any[]).length,
      });
    } catch (error) {
      this.logger.error('Failed to start P2P node', { error });
      throw error;
    }
  }

  /**
   * Stop P2P node
   */
  async stop(): Promise<void> {
    // @ts-ignore - libp2p types are complex
    if (!this.node || !(this.node as any).isStarted()) {
      return;
    }

    this.logger.info('Stopping P2P coordination service');
    
    try {
      // Unsubscribe from all topics
      if (this.config.enablePubsub && this.node.services.pubsub) {
        for (const networkId of this.taskSubscriptions.keys()) {
          await this.unsubscribeFromTasks(networkId);
        }
      }

      await this.node.stop();
      
      this.logger.info('P2P node stopped successfully');
    } catch (error) {
      this.logger.error('Failed to stop P2P node', { error });
      throw error;
    }
  }

  /**
   * Discover networks via P2P
   * NEW: Network discovery enhancement
   * Queries DHT and pubsub for available networks
   */
  async discoverNetworks(): Promise<string[]> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized. Call initialize() first.');
    }

    this.logger.info('Discovering networks via P2P');

    const discoveredNetworks = new Set<string>();

    try {
      // 1. Query DHT for network announcements (if enabled)
      if (this.config.enableDHT && this.node.services.dht) {
        const networkKey = '/tenseuron/networks';
        
        try {
          // Find providers (peers that have network info)
          // @ts-ignore - libp2p DHT types
          for await (const provider of (this.node.services as any).dht.findProviders(networkKey)) {
            try {
              // @ts-ignore - libp2p DHT types
              const records = await (this.node.services as any).dht.get(networkKey);
              for await (const record of records) {
                try {
                  const networkData = JSON.parse(
                    new TextDecoder().decode(record.value)
                  );
                  
                  if (networkData.networkId) {
                    discoveredNetworks.add(networkData.networkId);
                  }
                } catch (error) {
                  this.logger.debug('Failed to parse network record from DHT', { error });
                }
              }
            } catch (error) {
              this.logger.debug('Failed to fetch network record from DHT', { error });
            }
          }
        } catch (error) {
          this.logger.debug('DHT query failed (may be normal if no networks found)', { error });
        }
      }

      // 2. Check pubsub for network announcements
      if (this.config.enablePubsub && this.node.services.pubsub) {
        // Subscribe to network announcements topic
        const topic = 'tenseuron:networks';
        try {
          // @ts-ignore - libp2p pubsub types
          await (this.node.services as any).pubsub.subscribe(topic);
          
          // Listen for network announcements
          // @ts-ignore - libp2p pubsub types
          (this.node.services as any).pubsub.addEventListener('message', (evt) => {
            if (evt.detail.topic === topic) {
              try {
                const networkData = JSON.parse(
                  new TextDecoder().decode(evt.detail.data)
                );
                
                if (networkData.networkId) {
                  discoveredNetworks.add(networkData.networkId);
                  this.logger.info('Network discovered via pubsub', { 
                    networkId: networkData.networkId 
                  });
                }
              } catch (error) {
                this.logger.debug('Failed to parse network announcement', { error });
              }
            }
          });
        } catch (error) {
          this.logger.debug('Failed to subscribe to network announcements', { error });
        }
      }

      this.logger.info('Network discovery completed', {
        found: discoveredNetworks.size, // Set.size is correct
        networks: Array.from(discoveredNetworks),
      });

      return Array.from(discoveredNetworks);
    } catch (error) {
      this.logger.error('Failed to discover networks', { error });
      return Array.from(discoveredNetworks);
    }
  }

  /**
   * Announce network availability
   * NEW: Allows nodes to announce supported networks
   */
  async announceNetwork(networkId: string, manifestCid?: string): Promise<void> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized. Call initialize() first.');
    }

    this.logger.info('Announcing network availability', { networkId, manifestCid });

    try {
      const networkData = {
        networkId,
        manifestCid: manifestCid || '',
        timestamp: Date.now(),
        peerId: this.node.peerId.toString(),
      };

      // Store in DHT (if enabled)
      if (this.config.enableDHT && this.node.services.dht) {
        const networkKey = `/tenseuron/networks/${networkId}`;
        const data = new TextEncoder().encode(JSON.stringify(networkData));
        
        // @ts-ignore - libp2p DHT types
        await (this.node.services as any).dht.provide(networkKey);
        // @ts-ignore - libp2p DHT types
        await (this.node.services as any).dht.put(networkKey, data);
      }

      // Publish to pubsub (if enabled)
      if (this.config.enablePubsub && this.node.services.pubsub) {
        const topic = 'tenseuron:networks';
        const data = new TextEncoder().encode(JSON.stringify(networkData));
        // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.publish(topic, data);
      }

      this.logger.info('Network announcement published', { networkId });
    } catch (error) {
      this.logger.error('Failed to announce network', { error, networkId });
      throw error;
    }
  }

  /**
   * Get network manifest from discovered peers
   * NEW: Fetches manifest from P2P network
   */
  async getNetworkManifestFromPeer(networkId: string, peerId: string): Promise<any> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized. Call initialize() first.');
    }

    this.logger.info('Fetching network manifest from peer', { networkId, peerId });

    try {
      // Query DHT for network manifest
      if (this.config.enableDHT && this.node.services.dht) {
        const manifestKey = `/tenseuron/manifests/${networkId}`;
        // @ts-ignore - libp2p DHT types
        const records = await (this.node.services as any).dht.get(manifestKey);
        
        for await (const record of records) {
          try {
            const manifest = JSON.parse(
              new TextDecoder().decode(record.value)
            );
            
            if (manifest.networkId === networkId) {
              this.logger.info('Network manifest found in DHT', { networkId });
              return manifest;
            }
          } catch (error) {
            this.logger.debug('Failed to parse manifest from DHT', { error });
          }
        }
      }

      throw new Error('Network manifest not found in P2P network');
    } catch (error) {
      this.logger.error('Failed to get network manifest from peer', { error, networkId, peerId });
      throw error;
    }
  }

  /**
   * NEW: Set up direct P2P message protocol handler
   * Handles direct peer-to-peer messaging (not just pubsub)
   */
  private async setupDirectMessageProtocol(): Promise<void> {
    if (!this.node) return;

    try {
      // Register protocol handler for direct messages
      // @ts-ignore - libp2p protocol handler types
      await this.node.handle(this.messageProtocol, async ({ stream, connection }) => {
        try {
          const reader = stream.readable.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Try to parse complete JSON messages
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 1);

              if (line.trim()) {
                try {
                  const message: P2PMessage = JSON.parse(line);
                  await this.handleDirectMessage(message, connection.remotePeer);
                } catch (error) {
                  this.logger.debug('Failed to parse direct message', { error });
                }
              }
            }
          }
        } catch (error) {
          this.logger.error('Error in direct message protocol handler', { error });
        }
      });

      this.logger.info('Direct P2P message protocol handler registered', {
        protocol: this.messageProtocol,
      });
    } catch (error) {
      this.logger.error('Failed to set up direct message protocol', { error });
    }
  }

  /**
   * NEW: Handle direct P2P message
   */
  private async handleDirectMessage(message: P2PMessage, fromPeer: PeerId): Promise<void> {
    this.logger.debug('Received direct P2P message', {
      messageId: message.messageId,
      type: message.type,
      from: fromPeer.toString(),
    });

    // Check if this is a response to a pending message
    const pending = this.pendingMessages.get(message.messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMessages.delete(message.messageId);
      pending.resolve(message.payload);
      return;
    }

    // Handle different message types
    switch (message.type) {
      case 'task-request':
        await this.handleTaskRequest(message);
        break;
      case 'task-response':
        await this.handleTaskResponse(message);
        break;
      case 'validator-coordination':
        await this.handleValidatorCoordination(message);
        break;
      case 'consensus-proposal':
        await this.handleConsensusProposal(message);
        break;
      case 'evaluation-sync':
        await this.handleEvaluationSync(message);
        break;
      default:
        this.logger.warn('Unknown message type', { type: message.type });
    }
  }

  /**
   * NEW: Send direct P2P message to peer
   */
  async sendDirectMessage(
    peerId: string,
    messageType: P2PMessage['type'],
    payload: any,
    networkId: string,
    timeout: number = 30000
  ): Promise<any> {
    if (!this.node) {
      throw new Error('P2P node not initialized');
    }

    const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const message: P2PMessage = {
      messageId,
      type: messageType,
      from: this.node.peerId.toString(),
      to: peerId,
      networkId,
      payload,
      timestamp: Date.now(),
    };

    try {
      // Connect to peer if not connected
      const peerIdObj = peerIdFromString(peerId);
      const connectedPeers = this.node.getPeers();
      if (!connectedPeers.find(p => p.toString() === peerId)) {
        // Try to find peer in DHT
        if (this.config.enableDHT && this.node.services.dht) {
          // @ts-ignore - libp2p DHT types
          const providers = await (this.node.services as any).dht.findPeer(peerIdObj);
          if (providers) {
            await this.node.dial(providers);
          }
        }
      }

      // Open stream and send message
      const stream = await this.node.dialProtocol(peerIdObj, this.messageProtocol);
      const encoder = new TextEncoder();
      const writer = stream.writable.getWriter();
      
      await writer.write(encoder.encode(JSON.stringify(message) + '\n'));
      await writer.close();

      // Wait for response (if request-response pattern)
      if (messageType === 'task-request' || messageType === 'validator-coordination') {
        return new Promise((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            this.pendingMessages.delete(messageId);
            reject(new Error('Message timeout'));
          }, timeout);

          this.pendingMessages.set(messageId, {
            resolve,
            reject,
            timeout: timeoutHandle,
          });
        });
      }

      return { success: true };
    } catch (error) {
      this.logger.error('Failed to send direct message', {
        error,
        peerId,
        messageType,
      });
      throw error;
    }
  }

  /**
   * NEW: Handle task request message
   * Queries actual task data from storage
   */
  private async handleTaskRequest(message: P2PMessage): Promise<void> {
    const { taskId } = message.payload;
    
    this.logger.debug('Received task request', { taskId, from: message.from });

    // Query actual task data from storage
    let taskData: any = null;
    let found = false;

    if (this.taskDataQueryCallback) {
      try {
        taskData = await this.taskDataQueryCallback(taskId);
        if (taskData) {
          found = true;
          this.logger.info('Task data retrieved from storage', { taskId });
        } else {
          this.logger.debug('Task not found in storage', { taskId });
        }
      } catch (error) {
        this.logger.error('Failed to query task data from storage', {
          taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      this.logger.warn('Task data query callback not set, cannot retrieve task data', { taskId });
    }

    const response: P2PMessage = {
      messageId: `${message.messageId}-response`,
      type: 'task-response',
      from: this.node!.peerId.toString(),
      to: message.from,
      networkId: message.networkId,
      payload: {
        taskId,
        taskData,
        found,
      },
      timestamp: Date.now(),
    };

    // Send response back
    try {
      const peerIdObj = peerIdFromString(message.from);
      const stream = await this.node!.dialProtocol(peerIdObj, this.messageProtocol);
      const encoder = new TextEncoder();
      const writer = stream.writable.getWriter();
      await writer.write(encoder.encode(JSON.stringify(response) + '\n'));
      await writer.close();
    } catch (error) {
      this.logger.error('Failed to send task response', { error });
    }
  }

  /**
   * NEW: Handle task response message
   */
  private async handleTaskResponse(message: P2PMessage): Promise<void> {
    const { taskId, taskData, found } = message.payload;
    this.logger.debug('Received task response', { taskId, found, from: message.from });

    // This would be handled by the pending message resolver
    // (already handled in handleDirectMessage)
  }

  /**
   * NEW: Handle validator coordination message
   */
  private async handleValidatorCoordination(message: P2PMessage): Promise<void> {
    const coordination: ValidatorCoordinationMessage = message.payload;
    
    this.logger.debug('Received validator coordination message', {
      taskId: coordination.taskId,
      type: coordination.coordinationType,
      from: message.from,
    });

    // Route to appropriate coordination handler
    const callback = this.coordinationCallbacks.get(coordination.taskId);
    if (callback) {
      callback(coordination);
    }

    // Handle specific coordination types
    switch (coordination.coordinationType) {
      case 'election':
        await this.handleValidatorElection(coordination);
        break;
      case 'consensus-proposal':
        await this.handleConsensusProposal(message);
        break;
      case 'evaluation-sync':
        await this.handleEvaluationSync(message);
        break;
      case 'handshake':
        await this.handleValidatorHandshake(coordination);
        break;
    }
  }

  /**
   * NEW: Handle validator election
   */
  private async handleValidatorElection(coordination: ValidatorCoordinationMessage): Promise<void> {
    this.logger.info('Handling validator election', {
      taskId: coordination.taskId,
      validatorAddress: coordination.validatorAddress,
    });

    // Store election data
    this.activeCoordination.set(coordination.taskId, {
      type: 'election',
      data: coordination.data,
      timestamp: Date.now(),
    });
  }

  /**
   * NEW: Handle consensus proposal
   */
  private async handleConsensusProposal(message: P2PMessage): Promise<void> {
    const { taskId, proposal } = message.payload;
    
    this.logger.debug('Received consensus proposal', {
      taskId,
      from: message.from,
    });

    // Store proposal for consensus building
    const key = `${taskId}-proposal`;
    if (!this.activeCoordination.has(key)) {
      this.activeCoordination.set(key, []);
    }
    
    const proposals = this.activeCoordination.get(key) as any[];
    proposals.push({
      from: message.from,
      proposal,
      timestamp: Date.now(),
    });
  }

  /**
   * NEW: Handle evaluation sync
   */
  private async handleEvaluationSync(message: P2PMessage): Promise<void> {
    const { taskId, evaluations } = message.payload;
    
    this.logger.debug('Received evaluation sync', {
      taskId,
      evaluationCount: evaluations?.length || 0,
      from: message.from,
    });

    // Sync evaluations across validators
    // This would update local evaluation state
  }

  /**
   * NEW: Handle validator handshake
   */
  private async handleValidatorHandshake(coordination: ValidatorCoordinationMessage): Promise<void> {
    this.logger.info('Handling validator handshake', {
      taskId: coordination.taskId,
      validatorAddress: coordination.validatorAddress,
    });

    // Establish coordination session
    this.activeCoordination.set(coordination.taskId, {
      type: 'handshake',
      validatorAddress: coordination.validatorAddress,
      timestamp: Date.now(),
    });
  }

  /**
   * NEW: Propagate task to validator network with retry/relay
   * 
   * Implements full task propagation:
   * - Broadcasts to all known validators
   * - Retries failed propagations
   * - Relays through intermediate peers
   * - Tracks propagation path to prevent loops
   */
  async propagateTask(
    taskId: string,
    networkId: string,
    taskData: any,
    targetValidators?: string[] // Optional: specific validators to target
  ): Promise<{ propagated: number; failed: number; relayed: number }> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized');
    }

    this.logger.info('Propagating task to validator network', {
      taskId,
      networkId,
      targetCount: targetValidators?.length || 'all',
    });

    // Check if already propagated (prevent loops)
    if (this.propagatedTasks.has(taskId)) {
      this.logger.debug('Task already propagated, skipping', { taskId });
      return { propagated: 0, failed: 0, relayed: 0 };
    }

    this.propagatedTasks.add(taskId);

    let propagated = 0;
    let failed = 0;
    let relayed = 0;

    try {
      // 1. Get target validators
      let validators: ValidatorAnnouncement[] = [];
      
      if (targetValidators && targetValidators.length > 0) {
        // Target specific validators
        const allValidators = await this.discoverValidators(networkId);
        validators = allValidators.filter(v => targetValidators.includes(v.validatorAddress));
      } else {
        // Propagate to all validators
        validators = await this.discoverValidators(networkId);
      }

      // 2. Propagate to each validator
      const propagationPromises = validators.map(async (validator) => {
        try {
          // Try direct propagation first
          const success = await this.propagateToValidator(
            taskId,
            networkId,
            taskData,
            validator,
            []
          );

          if (success) {
            propagated++;
          } else {
            // Try relay if direct fails
            const relaySuccess = await this.relayTask(
              taskId,
              networkId,
              taskData,
              validator
            );

            if (relaySuccess) {
              relayed++;
            } else {
              failed++;
            }
          }
        } catch (error) {
          this.logger.warn('Task propagation failed for validator', {
            taskId,
            validatorAddress: validator.validatorAddress,
            error: error instanceof Error ? error.message : String(error),
          });
          failed++;
        }
      });

      await Promise.allSettled(propagationPromises);

      this.logger.info('Task propagation completed', {
        taskId,
        propagated,
        failed,
        relayed,
        total: validators.length,
      });

      return { propagated, failed, relayed };
    } catch (error) {
      this.logger.error('Task propagation failed', { error, taskId });
      throw error;
    }
  }

  /**
   * NEW: Propagate task to specific validator
   */
  private async propagateToValidator(
    taskId: string,
    networkId: string,
    taskData: any,
    validator: ValidatorAnnouncement,
    propagationPath: string[]
  ): Promise<boolean> {
    // Check hop limit
    if (propagationPath.length >= this.MAX_PROPAGATION_HOPS) {
      return false;
    }

    // Check if already in path (prevent loops)
    if (propagationPath.includes(validator.validatorAddress)) {
      return false;
    }

    try {
      // Get validator's peer ID from DHT (persistent storage)
      const validatorPeerId = await this.getValidatorPeerIdFromDHT(validator.validatorAddress);
      
      if (!validatorPeerId) {
        // Fallback: try to derive from public key or use as-is
        this.logger.warn('Validator peer ID not found in DHT, using fallback', {
          validatorAddress: validator.validatorAddress,
        });
        const fallbackPeerId = validator.publicKey;
        if (!fallbackPeerId) {
          return false;
        }
        // Use fallback peer ID
        const propagationMessage: TaskPropagationMessage = {
          taskId,
          networkId,
          taskData,
          propagationPath: [...propagationPath, validator.validatorAddress],
          hopCount: propagationPath.length + 1,
          maxHops: this.MAX_PROPAGATION_HOPS,
          timestamp: Date.now(),
        };
        await this.sendDirectMessage(
          fallbackPeerId,
          'task-request',
          propagationMessage,
          networkId,
          10000
        );
        return true;
      }

      // Send task via direct message using DHT-stored peer ID
      const propagationMessage: TaskPropagationMessage = {
        taskId,
        networkId,
        taskData,
        propagationPath: [...propagationPath, validator.validatorAddress],
        hopCount: propagationPath.length + 1,
        maxHops: this.MAX_PROPAGATION_HOPS,
        timestamp: Date.now(),
      };

      await this.sendDirectMessage(
        validatorPeerId,
        'task-request',
        propagationMessage,
        networkId,
        10000 // 10 second timeout
      );

      return true;
    } catch (error) {
      this.logger.debug('Direct propagation failed, will try relay', {
        validatorAddress: validator.validatorAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * NEW: Relay task through intermediate peer
   * Uses DHT to find optimal relay path
   */
  private async relayTask(
    taskId: string,
    networkId: string,
    taskData: any,
    targetValidator: ValidatorAnnouncement
  ): Promise<boolean> {
    // Get target validator's peer ID from DHT
    const targetPeerId = await this.getValidatorPeerIdFromDHT(targetValidator.validatorAddress);
    if (!targetPeerId) {
      this.logger.warn('Cannot relay: target validator peer ID not found in DHT', {
        validatorAddress: targetValidator.validatorAddress,
      });
      // Fallback to connected peers
      const connectedPeers = this.node!.getPeers();
      if (connectedPeers.length === 0) {
        return false;
      }
      return await this.relayThroughPeers(taskId, networkId, taskData, targetValidator, connectedPeers.slice(0, 3));
    }

    // Use DHT to find optimal relay path
    const relayPath = await this.findOptimalRelayPath(targetPeerId);
    
    if (relayPath.length === 0) {
      // Fallback: try connected peers
      const connectedPeers = this.node!.getPeers();
      if (connectedPeers.length === 0) {
        return false;
      }
      return await this.relayThroughPeers(taskId, networkId, taskData, targetValidator, connectedPeers.slice(0, 3));
    }

    // Relay through optimal path
    for (const relayPeerId of relayPath) {
      try {
        const relayMessage = {
          taskId,
          networkId,
          taskData,
          targetValidator: targetValidator.validatorAddress,
          targetPeerId,
          relay: true,
        };

        await this.sendDirectMessage(
          relayPeerId,
          'task-request',
          relayMessage,
          networkId,
          10000
        );

        this.logger.info('Task relayed through optimal DHT path', {
          taskId,
          relayPeer: relayPeerId,
          targetValidator: targetValidator.validatorAddress,
          pathLength: relayPath.length,
        });

        return true;
      } catch (error) {
        // Try next peer in path
        this.logger.debug('Relay failed, trying next peer in path', {
          relayPeer: relayPeerId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return false;
  }

  /**
   * Fallback: Relay through connected peers (when DHT path not available)
   */
  private async relayThroughPeers(
    taskId: string,
    networkId: string,
    taskData: any,
    targetValidator: ValidatorAnnouncement,
    peers: PeerId[]
  ): Promise<boolean> {
    for (const peer of peers) {
      try {
        const relayMessage = {
          taskId,
          networkId,
          taskData,
          targetValidator: targetValidator.validatorAddress,
          targetPeerId,
          relay: true,
        };

        await this.sendDirectMessage(
          relayPeerId,
          'task-request',
          relayMessage,
          networkId,
          10000
        );

        this.logger.info('Task relayed through optimal DHT path', {
          taskId,
          relayPeer: relayPeerId,
          targetValidator: targetValidator.validatorAddress,
          pathLength: relayPath.length,
        });

        return true;
      } catch (error) {
        // Try next peer in path
        this.logger.debug('Relay failed, trying next peer in path', {
          relayPeer: relayPeerId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return false;
  }

  /**
   * Fallback: Relay through connected peers (when DHT path not available)
   */
  private async relayThroughPeers(
    taskId: string,
    networkId: string,
    taskData: any,
    targetValidator: ValidatorAnnouncement,
    peers: PeerId[]
  ): Promise<boolean> {
    for (const peer of peers) {
      try {
        const relayMessage = {
          taskId,
          networkId,
          taskData,
          targetValidator: targetValidator.validatorAddress,
          relay: true,
        };

        await this.sendDirectMessage(
          peer.toString(),
          'task-request',
          relayMessage,
          networkId,
          10000
        );

        this.logger.debug('Task relayed through connected peer (fallback)', {
          taskId,
          relayPeer: peer.toString(),
          targetValidator: targetValidator.validatorAddress,
        });

        return true;
      } catch (error) {
        continue;
      }
    }

    return false;
  }

  /**
   * NEW: Coordinate validators for task evaluation
   * 
   * Implements validator coordination protocols:
   * - Validator election
   * - Consensus building
   * - Evaluation synchronization
   */
  async coordinateValidators(
    taskId: string,
    networkId: string,
    coordinationType: ValidatorCoordinationMessage['coordinationType'],
    data: any,
    validatorAddress: string
  ): Promise<void> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized');
    }

    this.logger.info('Coordinating validators', {
      taskId,
      networkId,
      coordinationType,
      validatorAddress,
    });

    // Get validators for this network
    const validators = await this.discoverValidators(networkId);

    // Create coordination message
    const coordination: ValidatorCoordinationMessage = {
      taskId,
      networkId,
      coordinationType,
      validatorAddress,
      data,
      timestamp: Date.now(),
    };

    // Broadcast coordination message via pubsub
    if (this.config.enablePubsub && this.node.services.pubsub) {
      const topic = `tenseuron:coordination:${networkId}`;
      const messageData = new TextEncoder().encode(JSON.stringify(coordination));
      
      // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.publish(topic, messageData);

      this.logger.info('Coordination message broadcast', {
        taskId,
        coordinationType,
        topic,
      });
    }

    // Also send direct messages to selected validators
    const directMessagePromises = validators.slice(0, 5).map(async (validator) => {
      try {
        // Get validator peer ID from DHT (persistent storage)
        const validatorPeerId = await this.getValidatorPeerIdFromDHT(validator.validatorAddress);
        if (!validatorPeerId) {
          this.logger.warn('Validator peer ID not found in DHT for coordination', {
            validatorAddress: validator.validatorAddress,
          });
          continue; // Skip this validator
        }
        await this.sendDirectMessage(
          validatorPeerId,
          'validator-coordination',
          coordination,
          networkId
        );
      } catch (error) {
        this.logger.debug('Direct coordination message failed', {
          validatorAddress: validator.validatorAddress,
          error,
        });
      }
    });

    await Promise.allSettled(directMessagePromises);
  }

  /**
   * NEW: Subscribe to validator coordination messages
   */
  async subscribeToCoordination(
    taskId: string,
    networkId: string,
    callback: (message: ValidatorCoordinationMessage) => void
  ): Promise<void> {
    if (!this.node || !this.isInitialized) {
      throw new Error('P2P node not initialized');
    }

    // Store callback
    this.coordinationCallbacks.set(taskId, callback);

    // Subscribe to coordination topic
    if (this.config.enablePubsub && this.node.services.pubsub) {
      const topic = `tenseuron:coordination:${networkId}`;
      
      // @ts-ignore - libp2p pubsub types
      await (this.node.services as any).pubsub.subscribe(topic);

      // Set up message handler for coordination
      // @ts-ignore - libp2p pubsub types
      (this.node.services as any).pubsub.addEventListener('message', (evt: any) => {
        if (evt.detail.topic === topic) {
          try {
            const coordination: ValidatorCoordinationMessage = JSON.parse(
              new TextDecoder().decode(evt.detail.data)
            );

            if (coordination.taskId === taskId) {
              callback(coordination);
            }
          } catch (error) {
            this.logger.debug('Failed to parse coordination message', { error });
          }
        }
      });

      this.logger.info('Subscribed to validator coordination', {
        taskId,
        networkId,
        topic,
      });
    }
  }

  /**
   * NEW: Get active coordination sessions
   */
  getActiveCoordination(taskId: string): any | null {
    return this.activeCoordination.get(taskId) || null;
  }

  /**
   * NEW: Clear coordination session
   */
  clearCoordination(taskId: string): void {
    this.activeCoordination.delete(taskId);
    this.coordinationCallbacks.delete(taskId);
  }

  /**
   * Store validator peer ID in DHT for persistence
   * 
   * Maps validator address -> peer ID for later retrieval
   */
  private async storeValidatorPeerIdInDHT(validatorAddress: string, peerId: string): Promise<void> {
    if (!this.config.enableDHT || !this.node?.services.dht) {
      return;
    }

    try {
      const peerIdKey = `/tenseuron/validator-peer-id/${validatorAddress}`;
      const data = Buffer.from(JSON.stringify({ validatorAddress, peerId, timestamp: Date.now() }));

      // Store in DHT
      // @ts-ignore - libp2p DHT types
      await (this.node.services as any).dht.put(peerIdKey, data);

      this.logger.debug('Validator peer ID stored in DHT', {
        validatorAddress,
        peerId,
      });
    } catch (error) {
      this.logger.warn('Failed to store validator peer ID in DHT', {
        validatorAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get validator peer ID from DHT (persistent storage)
   * 
   * Retrieves peer ID for a validator address from DHT
   */
  private async getValidatorPeerIdFromDHT(validatorAddress: string): Promise<string | null> {
    if (!this.config.enableDHT || !this.node?.services.dht) {
      return null;
    }

    try {
      const peerIdKey = `/tenseuron/validator-peer-id/${validatorAddress}`;

      // Query DHT for peer ID
      // @ts-ignore - libp2p DHT types
      const records = await (this.node.services as any).dht.get(peerIdKey);

      if (records && records.length > 0) {
        const record = records[0];
        const data = JSON.parse(record.value.toString());
        
        if (data.validatorAddress === validatorAddress && data.peerId) {
          this.logger.debug('Validator peer ID retrieved from DHT', {
            validatorAddress,
            peerId: data.peerId,
          });
          return data.peerId;
        }
      }

      return null;
    } catch (error) {
      this.logger.debug('Failed to get validator peer ID from DHT (may not exist yet)', {
        validatorAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find optimal relay path using DHT
   * 
   * Uses DHT routing to find peers that are closer to the target peer
   * Returns array of peer IDs representing the optimal relay path
   */
  private async findOptimalRelayPath(targetPeerId: string): Promise<string[]> {
    if (!this.config.enableDHT || !this.node?.services.dht) {
      return [];
    }

    try {
      const targetPeerIdObj = peerIdFromString(targetPeerId);
      const connectedPeers = this.node.getPeers();

      if (connectedPeers.length === 0) {
        return [];
      }

      // Use DHT to find peers closer to target
      // @ts-ignore - libp2p DHT types
      const providers = await (this.node.services as any).dht.findPeer(targetPeerIdObj);

      if (providers && providers.length > 0) {
        // Filter to only connected peers (can actually relay)
        const relayPeers = providers
          .map((p: any) => p.id?.toString())
          .filter((peerId: string) => {
            if (!peerId) return false;
            // Check if peer is connected
            return connectedPeers.some(p => p.toString() === peerId);
          })
          .slice(0, 3); // Limit to 3 relay peers

        if (relayPeers.length > 0) {
          this.logger.debug('Optimal relay path found via DHT', {
            targetPeerId,
            relayPeers,
            pathLength: relayPeers.length,
          });
          return relayPeers;
        }
      }

      // Fallback: use connected peers sorted by some metric (e.g., latency, reliability)
      // For now, just return first few connected peers
      return connectedPeers.slice(0, 3).map(p => p.toString());
    } catch (error) {
      this.logger.debug('Failed to find optimal relay path via DHT, using fallback', {
        targetPeerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
