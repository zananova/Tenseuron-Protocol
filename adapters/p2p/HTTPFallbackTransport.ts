/**
 * HTTP Fallback Transport
 * 
 * Simple HTTP-based P2P transport for environments where LibP2P is not available
 * Uses polling and HTTP POST for message exchange
 */

import { IP2PTransport, P2PMessage, P2PPeer } from '../interfaces/IP2PTransport';
import { ILogger } from '../utils/ILogger';

export class HTTPFallbackTransport implements IP2PTransport {
    private logger: ILogger;
    private localPeerId: string;
    private connectedPeers: Map<string, P2PPeer> = new Map();
    private messageCallbacks: Array<(message: P2PMessage) => void> = [];
    private pollingInterval: NodeJS.Timeout | null = null;
    private serverUrl: string;

    constructor(logger: ILogger, serverUrl: string, localPeerId: string) {
        this.logger = logger;
        this.serverUrl = serverUrl;
        this.localPeerId = localPeerId;
    }

    async initialize(): Promise<void> {
        try {
            // Register with server
            await fetch(`${this.serverUrl}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerId: this.localPeerId }),
            });

            // Start polling for messages
            this.startPolling();

            this.logger.info('HTTP fallback transport initialized', { peerId: this.localPeerId });
        } catch (error) {
            this.logger.error('Failed to initialize HTTP transport', { error });
            throw error;
        }
    }

    async connect(peerId: string, endpoint: string): Promise<void> {
        try {
            this.connectedPeers.set(peerId, {
                id: peerId,
                address: peerId,
                endpoint,
                isConnected: true,
                lastSeen: new Date(),
            });

            this.logger.info('Connected to peer (HTTP)', { peerId, endpoint });
        } catch (error) {
            this.logger.error('Failed to connect to peer', { peerId, error });
            throw error;
        }
    }

    async disconnect(peerId: string): Promise<void> {
        this.connectedPeers.delete(peerId);
        this.logger.info('Disconnected from peer (HTTP)', { peerId });
    }

    async sendMessage(peerId: string, message: P2PMessage): Promise<void> {
        try {
            await fetch(`${this.serverUrl}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: this.localPeerId,
                    to: peerId,
                    message,
                }),
            });

            this.logger.debug('Message sent (HTTP)', { peerId, type: message.type });
        } catch (error) {
            this.logger.error('Failed to send message', { peerId, error });
            throw error;
        }
    }

    async broadcast(message: P2PMessage): Promise<void> {
        try {
            await fetch(`${this.serverUrl}/broadcast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: this.localPeerId,
                    message,
                }),
            });

            this.logger.debug('Message broadcasted (HTTP)', { type: message.type });
        } catch (error) {
            this.logger.error('Failed to broadcast message', { error });
            throw error;
        }
    }

    onMessage(callback: (message: P2PMessage) => void): void {
        this.messageCallbacks.push(callback);
    }

    async getConnectedPeers(): Promise<P2PPeer[]> {
        try {
            const response = await fetch(`${this.serverUrl}/peers`);
            const peers = await response.json();

            return peers.map((peer: any) => ({
                id: peer.peerId,
                address: peer.peerId,
                endpoint: peer.endpoint || '',
                isConnected: true,
                lastSeen: new Date(peer.lastSeen),
            }));
        } catch (error) {
            this.logger.error('Failed to get connected peers', { error });
            return [];
        }
    }

    async isConnected(peerId: string): Promise<boolean> {
        return this.connectedPeers.has(peerId);
    }

    getLocalPeerId(): string {
        return this.localPeerId;
    }

    async shutdown(): Promise<void> {
        try {
            // Stop polling
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }

            // Unregister from server
            await fetch(`${this.serverUrl}/unregister`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerId: this.localPeerId }),
            });

            this.connectedPeers.clear();
            this.messageCallbacks = [];

            this.logger.info('HTTP fallback transport shutdown');
        } catch (error) {
            this.logger.error('Failed to shutdown HTTP transport', { error });
            throw error;
        }
    }

    private startPolling(): void {
        this.pollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`${this.serverUrl}/poll?peerId=${this.localPeerId}`);
                const messages: P2PMessage[] = await response.json();

                for (const message of messages) {
                    // Call all registered callbacks
                    for (const callback of this.messageCallbacks) {
                        callback(message);
                    }
                }
            } catch (error) {
                this.logger.error('Polling failed', { error });
            }
        }, 1000); // Poll every second
    }
}
