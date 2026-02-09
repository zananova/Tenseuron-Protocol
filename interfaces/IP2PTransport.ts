/**
 * P2P Transport Interface
 * 
 * Database-agnostic interface for P2P communication
 * Supports multiple transport implementations (LibP2P, HTTP, WebRTC, etc.)
 */

export interface P2PMessage {
    type: string;
    from: string;
    to: string;
    data: any;
    timestamp: Date;
    signature?: string;
}

export interface P2PPeer {
    id: string;
    address: string;
    endpoint: string;
    isConnected: boolean;
    lastSeen: Date;
    metadata?: any;
}

export interface IP2PTransport {
    /**
     * Initialize the transport
     */
    initialize(): Promise<void>;

    /**
     * Connect to a peer
     */
    connect(peerId: string, endpoint: string): Promise<void>;

    /**
     * Disconnect from a peer
     */
    disconnect(peerId: string): Promise<void>;

    /**
     * Send a message to a peer
     */
    sendMessage(peerId: string, message: P2PMessage): Promise<void>;

    /**
     * Broadcast a message to all connected peers
     */
    broadcast(message: P2PMessage): Promise<void>;

    /**
     * Listen for incoming messages
     */
    onMessage(callback: (message: P2PMessage) => void): void;

    /**
     * Get list of connected peers
     */
    getConnectedPeers(): Promise<P2PPeer[]>;

    /**
     * Check if connected to a peer
     */
    isConnected(peerId: string): Promise<boolean>;

    /**
     * Get local peer ID
     */
    getLocalPeerId(): string;

    /**
     * Shutdown the transport
     */
    shutdown(): Promise<void>;
}
