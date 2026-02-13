import { app, clipboard, dialog } from "electron";
import os from "os";
import { SwarmServer } from "./server/swarm.js";
import { StreamingRelay } from "./relay/relay.js";
import { TrayMenu, type AppState } from "./menu/tray.js";
import { Logger } from "./utils/logger.js";
import { OllamaAdapter } from "./ollama/adapter.js";

/**
 * Main application class.
 */
class HostApp {
  private swarmServer: SwarmServer;
  private relay: StreamingRelay;
  private trayMenu: TrayMenu;
  private currentModel = "llama3.2";
  private debugLogsEnabled = false;
  private logger: Logger;
  private swarmLogger: Logger;
  private relayLogger: Logger;

  constructor() {
    // Create loggers for each component
    this.logger = new Logger("HostApp");
    this.swarmLogger = new Logger("SwarmServer");
    this.relayLogger = new Logger("StreamingRelay");

    this.relay = new StreamingRelay({
      model: this.currentModel,
      hostName: os.hostname(),
      logger: this.relayLogger,
      onStateChange: () => this.updateState(),
      onOllamaUnreachable: () => this.handleOllamaUnreachable(),
    });

    this.swarmServer = new SwarmServer({
      onConnection: (socket) => {
        this.handleConnection(socket);
      },
      onDisconnection: (socket) => {
        this.handleDisconnection(socket);
      },
      logger: this.swarmLogger,
    });

    this.trayMenu = new TrayMenu({
      onStartServer: async () => this.startServer(),
      onStopServer: async () => this.stopServer(),
      onSelectModel: (model) => this.selectModel(model),
      onCopyServerId: () => this.copyServerId(),
      onShowQR: async () => this.showQR(),
      onToggleDebugLogs: () => this.toggleDebugLogs(),
      onRetryHealthCheck: async () => this.retryHealthCheck(),
      onQuit: () => this.quit(),
    });
  }

  /**
   * Initialize the application.
   */
  async init(): Promise<void> {
    await this.trayMenu.init();
    this.logger.log("Application initialized");

    // Perform Ollama health check on startup
    await this.performHealthCheck();
  }

  /**
   * Perform Ollama health check.
   */
  private async performHealthCheck(): Promise<void> {
    this.logger.log("Performing Ollama health check...");

    // Create a temporary OllamaAdapter just for health check
    const ollamaAdapter = new OllamaAdapter("http://localhost:11434", this.logger);
    const result = await ollamaAdapter.healthCheck();

    if (!result.healthy) {
      this.logger.error("Ollama health check failed:", result.error);
      this.trayMenu.setState("error", "OLLAMA_NOT_FOUND");
    } else {
      this.logger.log("Ollama is healthy - keeping state as stopped until server starts");
      // Keep state as "stopped" - only transition to "ready" when server actually starts
      this.trayMenu.setState("stopped");
    }
  }

  /**
   * Handle Ollama becoming unreachable mid-session.
   */
  private handleOllamaUnreachable(): void {
    this.logger.error("Ollama became unreachable during inference");
    this.trayMenu.setState("error", "OLLAMA_NOT_FOUND");
  }

  /**
   * Retry Ollama health check and recover from error state.
   */
  private async retryHealthCheck(): Promise<void> {
    this.logger.log("Retrying Ollama health check...");

    const ollamaAdapter = new OllamaAdapter("http://localhost:11434", this.logger);
    const result = await ollamaAdapter.healthCheck();

    if (!result.healthy) {
      this.logger.error("Ollama health check still failing:", result.error);
      this.trayMenu.setState("error", "OLLAMA_NOT_FOUND");
      dialog.showErrorBox("Health Check Failed", result.error || "Ollama is still unreachable");
    } else {
      this.logger.log("Ollama health check passed - recovering to ready state");
      this.trayMenu.setState("ready");
    }
  }

  /**
   * Start the Hyperswarm server.
   */
  private async startServer(): Promise<void> {
    try {
      this.logger.log("Starting server...");
      const serverId = await this.swarmServer.start();
      this.trayMenu.setServerId(serverId);
      this.trayMenu.setState("ready");
      this.logger.log(`Server started with ID: ${serverId}`);
    } catch (error) {
      this.logger.error("Failed to start server:", error);
      dialog.showErrorBox("Failed to Start Server", String(error));
    }
  }

  /**
   * Stop the Hyperswarm server.
   */
  private async stopServer(): Promise<void> {
    try {
      this.logger.log("Stopping server...");

      const clientCount = this.swarmServer.getClientCount();

      // Abort any active inference and release the gate
      if (this.relay.isBusy()) {
        const activeRequestId = this.relay.getActiveRequestId();
        this.logger.log(`Aborting active inference: ${activeRequestId}`);
        this.relay.abortActiveInference();
      }

      // Close all connected sockets and leave the topic
      await this.swarmServer.stop();

      this.trayMenu.setServerId(null);
      this.trayMenu.setState("stopped");
      this.trayMenu.setClientCount(0);

      this.logger.log(`Server stopped. ${clientCount} client${clientCount !== 1 ? 's' : ''} disconnected.`);
    } catch (error) {
      this.logger.error("Failed to stop server:", error);
      dialog.showErrorBox("Failed to Stop Server", String(error));
    }
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: any): void {
    this.logger.log("Client connected");
    this.relay.handleConnection(socket);
    this.updateClientCount();
    this.updateState();
  }

  /**
   * Handle client disconnection.
   */
  private handleDisconnection(socket: any): void {
    this.logger.log("Client disconnected");
    this.relay.handleDisconnection(socket);
    this.updateClientCount();
    this.updateState();
  }

  /**
   * Update client count in menu.
   */
  private updateClientCount(): void {
    const count = this.swarmServer.getClientCount();
    this.trayMenu.setClientCount(count);
  }

  /**
   * Update application state based on relay status.
   */
  private updateState(): void {
    if (!this.swarmServer.isRunning()) {
      this.trayMenu.setState("stopped");
    } else if (this.relay.isBusy()) {
      const activeRequestId = this.relay.getActiveRequestId();
      this.trayMenu.setState("busy", undefined, activeRequestId);
    } else {
      this.trayMenu.setState("ready");
    }
  }

  /**
   * Select a model.
   */
  private selectModel(model: string): void {
    this.currentModel = model;
    this.relay.setModel(model);
    this.trayMenu.setModel(model);
    this.logger.log(`Model selected: ${model}`);
  }

  /**
   * Copy server ID to clipboard.
   */
  private copyServerId(): void {
    const serverId = this.swarmServer.getServerId();
    if (serverId) {
      clipboard.writeText(serverId);
      this.logger.log("Server ID copied to clipboard");
    }
  }

  /**
   * Show QR code.
   */
  private async showQR(): Promise<void> {
    const serverId = this.swarmServer.getServerId();
    if (serverId) {
      await this.trayMenu.showQRCode(serverId);
    }
  }

  /**
   * Toggle debug logs.
   */
  private toggleDebugLogs(): void {
    this.debugLogsEnabled = !this.debugLogsEnabled;

    // Enable/disable all loggers
    this.logger.setEnabled(this.debugLogsEnabled);
    this.swarmLogger.setEnabled(this.debugLogsEnabled);
    this.relayLogger.setEnabled(this.debugLogsEnabled);

    if (this.debugLogsEnabled) {
      this.logger.log(`Debug logs enabled. Writing to: ${Logger.getLogFilePath()}`);
    } else {
      this.logger.log("Debug logs disabled. Only warnings/errors will be logged to file.");
    }
  }

  /**
   * Quit the application.
   */
  private async quit(): Promise<void> {
    this.logger.log("Quitting application...");
    // Stop server gracefully before quitting
    if (this.swarmServer.isRunning()) {
      await this.stopServer();
    }
    app.quit();
  }

  /**
   * Cleanup on app quit.
   */
  async cleanup(): Promise<void> {
    await this.stopServer();
    this.trayMenu.destroy();
    Logger.closeFileStream();
  }
}

// Set application name
app.setName("LocalLLM");

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let hostApp: HostApp | null = null;

  app.on("ready", async () => {
    hostApp = new HostApp();
    await hostApp.init();
  });

  app.on("before-quit", async (event) => {
    if (hostApp) {
      event.preventDefault();
      try {
        await hostApp.cleanup();
      } catch (error) {
        console.error("Error during cleanup:", error);
      } finally {
        hostApp = null;
        app.exit(0);
      }
    }
  });

  // Keep app running in background (menu bar mode)
  app.on("window-all-closed", () => {
    // Don't quit on window close for menu bar apps
  });
}
