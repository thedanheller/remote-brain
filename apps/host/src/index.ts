import { app, clipboard, dialog } from "electron";
import os from "os";
import { SwarmServer } from "./server/swarm.js";
import { StreamingRelay } from "./relay/relay.js";
import { TrayMenu, type AppState } from "./menu/tray.js";

/**
 * Main application class.
 */
class HostApp {
  private swarmServer: SwarmServer;
  private relay: StreamingRelay;
  private trayMenu: TrayMenu;
  private currentModel = "llama3.2";
  private debugLogsEnabled = false;

  constructor() {
    this.relay = new StreamingRelay({
      model: this.currentModel,
      hostName: os.hostname(),
    });

    this.swarmServer = new SwarmServer({
      onConnection: (socket) => {
        this.handleConnection(socket);
      },
      onDisconnection: (socket) => {
        this.handleDisconnection(socket);
      },
    });

    this.trayMenu = new TrayMenu({
      onStartServer: async () => this.startServer(),
      onStopServer: async () => this.stopServer(),
      onSelectModel: (model) => this.selectModel(model),
      onCopyServerId: () => this.copyServerId(),
      onShowQR: async () => this.showQR(),
      onToggleDebugLogs: () => this.toggleDebugLogs(),
      onQuit: () => this.quit(),
    });
  }

  /**
   * Initialize the application.
   */
  async init(): Promise<void> {
    await this.trayMenu.init();
    this.log("Application initialized");
  }

  /**
   * Start the Hyperswarm server.
   */
  private async startServer(): Promise<void> {
    try {
      this.log("Starting server...");
      const serverId = await this.swarmServer.start();
      this.trayMenu.setServerId(serverId);
      this.trayMenu.setState("ready");
      this.log(`Server started with ID: ${serverId}`);
    } catch (error) {
      this.log("Failed to start server:", error);
      dialog.showErrorBox("Failed to Start Server", String(error));
    }
  }

  /**
   * Stop the Hyperswarm server.
   */
  private async stopServer(): Promise<void> {
    try {
      this.log("Stopping server...");
      await this.swarmServer.stop();
      this.trayMenu.setServerId(null);
      this.trayMenu.setState("stopped");
      this.trayMenu.setClientCount(0);
      this.log("Server stopped");
    } catch (error) {
      this.log("Failed to stop server:", error);
      dialog.showErrorBox("Failed to Stop Server", String(error));
    }
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(socket: any): void {
    this.log("Client connected");
    this.relay.handleConnection(socket);
    this.updateClientCount();
    this.updateState();
  }

  /**
   * Handle client disconnection.
   */
  private handleDisconnection(socket: any): void {
    this.log("Client disconnected");
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
      this.trayMenu.setState("busy");
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
    this.log(`Model selected: ${model}`);
  }

  /**
   * Copy server ID to clipboard.
   */
  private copyServerId(): void {
    const serverId = this.swarmServer.getServerId();
    if (serverId) {
      clipboard.writeText(serverId);
      this.log("Server ID copied to clipboard");
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
    this.log(`Debug logs ${this.debugLogsEnabled ? "enabled" : "disabled"}`);
  }

  /**
   * Quit the application.
   */
  private quit(): void {
    this.log("Quitting application...");
    app.quit();
  }

  /**
   * Log a message (if debug logs enabled).
   */
  private log(...args: any[]): void {
    if (this.debugLogsEnabled) {
      console.log("[HostApp]", ...args);
    }
  }

  /**
   * Cleanup on app quit.
   */
  async cleanup(): Promise<void> {
    await this.stopServer();
    this.trayMenu.destroy();
  }
}

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
      await hostApp.cleanup();
      hostApp = null;
      app.exit(0);
    }
  });

  // Keep app running in background (menu bar mode)
  app.on("window-all-closed", () => {
    // Don't quit on window close for menu bar apps
  });
}
