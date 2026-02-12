import Hyperswarm from "hyperswarm";
import bs58 from "bs58";
import crypto from "crypto";
import type { Duplex } from "stream";

export interface SwarmServerConfig {
  onConnection: (socket: Duplex) => void;
  onDisconnection: (socket: Duplex) => void;
}

/**
 * Hyperswarm server manager for P2P connections.
 */
export class SwarmServer {
  private swarm: Hyperswarm | null = null;
  private topic: Buffer | null = null;
  private serverId: string | null = null;
  private connectedSockets = new Set<Duplex>();
  private config: SwarmServerConfig;

  constructor(config: SwarmServerConfig) {
    this.config = config;
  }

  /**
   * Start the Hyperswarm server with a new random topic.
   */
  async start(): Promise<string> {
    if (this.swarm) {
      throw new Error("Server already running");
    }

    // Generate random 32-byte topic
    this.topic = crypto.randomBytes(32);
    this.serverId = bs58.encode(this.topic);

    // Create Hyperswarm instance
    this.swarm = new Hyperswarm();

    // Join the topic as a server
    const discovery = this.swarm.join(this.topic, { server: true, client: false });
    await discovery.flushed();

    // Handle connections
    this.swarm.on("connection", (socket: Duplex) => {
      this.connectedSockets.add(socket);
      this.config.onConnection(socket);

      socket.on("close", () => {
        this.connectedSockets.delete(socket);
        this.config.onDisconnection(socket);
      });

      socket.on("error", (error) => {
        console.error("Socket error:", error);
        this.connectedSockets.delete(socket);
        this.config.onDisconnection(socket);
      });
    });

    return this.serverId;
  }

  /**
   * Stop the Hyperswarm server and close all connections.
   */
  async stop(): Promise<void> {
    if (!this.swarm) {
      return;
    }

    // Close all connected sockets
    for (const socket of this.connectedSockets) {
      socket.destroy();
    }
    this.connectedSockets.clear();

    // Leave the topic
    if (this.topic) {
      this.swarm.leave(this.topic);
    }

    // Destroy the swarm
    await this.swarm.destroy();
    this.swarm = null;
    this.topic = null;
    this.serverId = null;
  }

  /**
   * Get the server ID (base58-encoded topic).
   */
  getServerId(): string | null {
    return this.serverId;
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.connectedSockets.size;
  }

  /**
   * Check if the server is running.
   */
  isRunning(): boolean {
    return this.swarm !== null;
  }

  /**
   * Get all connected sockets.
   */
  getConnectedSockets(): Duplex[] {
    return Array.from(this.connectedSockets);
  }
}
