/**
 * LibP2P Transport Adapter
 * 
 * Production-grade P2P transport using LibP2P
 */

import { IP2PTransport, P2PMessage, P2PPeer } from '../interfaces/IP2PTransport';
import { ILogger } from '../utils/ILogger';

export class LibP2PTransport implements IP2PTransport {
    private logger: ILogger;
    private node: any; // libp2p node
    private localPeerId: string = '';
    private connectedPeers: Map<string, P2PPeer> = new Map();
    private messageCallbacks: Array<(message: P2PMessage) => void> = [];

    constructor(logger: ILogger) {
        this.logger = logger;
    }

    async initialize(): Promise<void> {
        try {
            // Dynamic import to avoid bundling issues
            const { createLibp2p } = await import('libp2p');
            const { tcp } = await import('@libp2p/tcp');
            const { noise } = await import('@chainsafe/libp2p-noise');
            const { mplex } = await import('@libp2p/mplex');
            const { gossipsub } = await import('@chainsafe/libp2p-gossipsub');

            this.node = await createLibp2p({
                addresses: {
                    listen: ['/ip4/0.0.0.0/tcp/0']
                },
                transports: [tcp()],
                connectionEncryption: [noise()],
                streamMuxers: [mplex()],
                pubsub: gossipsub({ allowPublishToZeroPeers: true })
            });

            await this.node.start();
            this.localPeerId = this.node.peerId.toString();

            // Listen for incoming connections
            this.node.addEventListener('peer:connect', (evt: any) => {
                const peerId = evt.detail.toString();
                this.handlePeerConnect(peerId);
            });

            this.node.addEventListener('peer:disconnect', (evt: any) => {
                const peerId = evt.detail.toString();
                this.handlePeerDisconnect(peerId);
            });

            // Subscribe to messages
            if (this.node.pubsub) {
                this.node.pubsub.addEventListener('message', (evt: any) => {
                    this.handleIncomingMessage(evt.detail);
                });
                await this.node.pubsub.subscribe('tenseuron-protocol');
            }

            this.logger.info('LibP2P transport initialized', { peerId: this.localPeerId });
        } catch (error) {
            this.logger.error('Failed to initialize LibP2P transport', { error });
            throw error;
        }
    }

    async connect(peerId: string, endpoint: string): Promise<void> {
        try {
            const multiaddr = endpoint; // Should be in multiaddr format
            await this.node.dial(multiaddr);
            this.logger.info('Connected to peer', { peerId, endpoint });
        } catch (error) {
            this.logger.error('Failed to connect to peer', { peerId, endpoint, error });
            throw error;
        }
    }

    async disconnect(peerId: string): Promise<void> {
        try {
            const connections = this.node.getConnections(peerId);
            for (const conn of connections) {
                await conn.close();
            }
            this.connectedPeers.delete(peerId);
            this.logger.info('Disconnected from peer', { peerId });
        } catch (error) {
            this.logger.error('Failed to disconnect from peer', { peerId, error });
            throw error;
        }
    }

    async sendMessage(peerId: string, message: P2PMessage): Promise<void> {
        try {
            const messageData = JSON.stringify(message);
            const encoder = new TextEncoder();
            const data = encoder.encode(messageData);

            // Use pubsub for messaging
            if (this.node.pubsub) {
                await this.node.pubsub.publish('tenseuron-protocol', data);
            }

            this.logger.debug('Message sent', { peerId, type: message.type });
        } catch (error) {
            this.logger.error('Failed to send message', { peerId, error });
            throw error;
        }
    }

    async broadcast(message: P2PMessage): Promise<void> {
        try {
            const messageData = JSON.stringify(message);
            const encoder = new TextEncoder();
            const data = encoder.encode(messageData);

            if (this.node.pubsub) {
                await this.node.pubsub.publish('tenseuron-protocol', data);
            }

            this.logger.debug('Message broadcasted', { type: message.type });
        } catch (error) {
            this.logger.error('Failed to broadcast message', { error });
            throw error;
        }
    }

    onMessage(callback: (message: P2PMessage) => void): void {
        this.messageCallbacks.push(callback);
    }

    async getConnectedPeers(): Promise<P2PPeer[]> {
        return Array.from(this.connectedPeers.values());
    }

    async isConnected(peerId: string): Promise<boolean> {
        return this.connectedPeers.has(peerId);
    }

    getLocalPeerId(): string {
        return this.localPeerId;
    }

    async shutdown(): Promise<void> {
        try {
            if (this.node) {
                await this.node.stop();
            }
            this.connectedPeers.clear();
            this.messageCallbacks = [];
            this.logger.info('LibP2P transport shutdown');
        } catch (error) {
            this.logger.error('Failed to shutdown LibP2P transport', { error });
            throw error;
        }
    }

    private handlePeerConnect(peerId: string): void {
        this.connectedPeers.set(peerId, {
            id: peerId,
            address: peerId,
            endpoint: '', // Will be populated from multiaddr
            isConnected: true,
            lastSeen: new Date(),
        });
        this.logger.info('Peer connected', { peerId });
    }

    private handlePeerDisconnect(peerId: string): void {
        this.connectedPeers.delete(peerId);
        this.logger.info('Peer disconnected', { peerId });
    }

    private handleIncomingMessage(evt: any): void {
        try {
            const decoder = new TextDecoder();
            const messageData = decoder.decode(evt.data);
            const message: P2PMessage = JSON.parse(messageData);

            // Call all registered callbacks
            for (const callback of this.messageCallbacks) {
                callback(message);
            }

            this.logger.debug('Message received', { type: message.type, from: message.from });
        } catch (error) {
            this.logger.error('Failed to handle incoming message', { error });
        }
    }
}
