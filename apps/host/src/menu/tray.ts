import { app, Menu, Tray, clipboard, nativeImage } from "electron";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AppState = "stopped" | "ready" | "busy";

export interface MenuCallbacks {
  onStartServer: () => Promise<void>;
  onStopServer: () => Promise<void>;
  onSelectModel: (model: string) => void;
  onCopyServerId: () => void;
  onShowQR: () => Promise<void>;
  onToggleDebugLogs: () => void;
  onQuit: () => void;
}

/**
 * Menu bar tray application.
 */
export class TrayMenu {
  private tray: Tray | null = null;
  private state: AppState = "stopped";
  private clientCount = 0;
  private serverId: string | null = null;
  private currentModel = "llama3.2";
  private debugLogsEnabled = false;
  private callbacks: MenuCallbacks;

  constructor(callbacks: MenuCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Initialize the tray icon and menu.
   */
  async init(): Promise<void> {
    // Create a simple tray icon (you can replace this with a custom icon)
    const icon = nativeImage.createEmpty();
    this.tray = new Tray(icon);
    this.tray.setToolTip("LocalLLM Host");

    this.updateMenu();
  }

  /**
   * Update the application state.
   */
  setState(state: AppState): void {
    this.state = state;
    this.updateMenu();
    this.updateTooltip();
  }

  /**
   * Update the client count.
   */
  setClientCount(count: number): void {
    this.clientCount = count;
    this.updateMenu();
    this.updateTooltip();
  }

  /**
   * Set the server ID.
   */
  setServerId(serverId: string | null): void {
    this.serverId = serverId;
    this.updateMenu();
  }

  /**
   * Set the current model.
   */
  setModel(model: string): void {
    this.currentModel = model;
    this.updateMenu();
  }

  /**
   * Update the menu based on current state.
   */
  private updateMenu(): void {
    if (!this.tray) return;

    const template: Electron.MenuItemConstructorOptions[] = [];

    // State indicator
    template.push({
      label: `Status: ${this.state.charAt(0).toUpperCase() + this.state.slice(1)}`,
      enabled: false,
    });

    template.push({ type: "separator" });

    // Server controls
    if (this.state === "stopped") {
      template.push({
        label: "Start Server",
        click: () => this.callbacks.onStartServer(),
      });
    } else {
      template.push({
        label: "Stop Server",
        click: () => this.callbacks.onStopServer(),
      });
    }

    template.push({ type: "separator" });

    // Model selection
    const availableModels = [
      "llama3.2",
      "llama3.2:1b",
      "llama3.2:3b",
      "mistral",
      "codellama",
      "phi3",
    ];

    template.push({
      label: "Model",
      submenu: availableModels.map((model) => ({
        label: model,
        type: "radio" as const,
        checked: model === this.currentModel,
        enabled: this.state === "stopped",
        click: () => this.callbacks.onSelectModel(model),
      })),
    });

    template.push({ type: "separator" });

    // Server ID and QR
    if (this.serverId) {
      template.push({
        label: "Copy Server ID",
        click: () => this.callbacks.onCopyServerId(),
      });

      template.push({
        label: "Show QR Code",
        click: () => this.callbacks.onShowQR(),
      });
    }

    template.push({ type: "separator" });

    // Client counter
    template.push({
      label: `Clients Connected: ${this.clientCount}`,
      enabled: false,
    });

    template.push({ type: "separator" });

    // Debug logs toggle
    template.push({
      label: "Debug Logs",
      type: "checkbox",
      checked: this.debugLogsEnabled,
      click: () => {
        this.debugLogsEnabled = !this.debugLogsEnabled;
        this.callbacks.onToggleDebugLogs();
        this.updateMenu();
      },
    });

    template.push({ type: "separator" });

    // Quit
    template.push({
      label: "Quit",
      click: () => this.callbacks.onQuit(),
    });

    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
  }

  /**
   * Update the tray tooltip.
   */
  private updateTooltip(): void {
    if (!this.tray) return;

    let tooltip = "LocalLLM Host";
    tooltip += `\nStatus: ${this.state}`;
    if (this.state !== "stopped") {
      tooltip += `\nClients: ${this.clientCount}`;
    }

    this.tray.setToolTip(tooltip);
  }

  /**
   * Show QR code in a dialog.
   */
  async showQRCode(serverId: string): Promise<void> {
    try {
      const qrDataUrl = await QRCode.toDataURL(serverId, {
        width: 400,
        margin: 2,
      });

      // For simplicity, just copy the QR data URL to clipboard
      // In a full implementation, you'd show this in a window
      console.log("QR Code generated. In a full implementation, this would open a window.");
      console.log("Server ID:", serverId);
    } catch (error) {
      console.error("Failed to generate QR code:", error);
    }
  }

  /**
   * Destroy the tray.
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
