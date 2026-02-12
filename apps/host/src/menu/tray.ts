import { app, Menu, Tray, clipboard, nativeImage, BrowserWindow } from "electron";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AppState = "stopped" | "ready" | "busy" | "error";

export interface MenuCallbacks {
  onStartServer: () => Promise<void>;
  onStopServer: () => Promise<void>;
  onSelectModel: (model: string) => void;
  onCopyServerId: () => void;
  onShowQR: () => Promise<void>;
  onToggleDebugLogs: () => void;
  onRetryHealthCheck: () => Promise<void>;
  onQuit: () => Promise<void>;
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
  private qrWindow: BrowserWindow | null = null;
  private errorMessage: string | null = null;
  private activeRequestId: string | null = null;

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
  setState(state: AppState, errorMessage?: string, activeRequestId?: string | null): void {
    this.state = state;
    this.errorMessage = errorMessage || null;
    this.activeRequestId = activeRequestId ?? null;
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

    // Show error message if in error state
    if (this.state === "error" && this.errorMessage) {
      template.push({
        label: this.errorMessage,
        enabled: false,
      });
    }

    template.push({ type: "separator" });

    // Server controls
    if (this.state === "stopped" || this.state === "error") {
      template.push({
        label: "Start Server",
        enabled: this.state !== "error",
        click: () => this.callbacks.onStartServer(),
      });

      // Show "Retry Health Check" only in error state
      if (this.state === "error") {
        template.push({
          label: "Retry Health Check",
          click: () => this.callbacks.onRetryHealthCheck(),
        });
      }
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

    if (this.state === "busy" && this.activeRequestId) {
      tooltip = `Busy — generating for ${this.activeRequestId}`;
    } else if (this.state === "ready") {
      tooltip = `Ready — ${this.clientCount} client${this.clientCount !== 1 ? "s" : ""}`;
    } else {
      tooltip += `\nStatus: ${this.state}`;
      if (this.state !== "stopped") {
        tooltip += `\nClients: ${this.clientCount}`;
      }
    }

    this.tray.setToolTip(tooltip);
  }

  /**
   * Show QR code in a window.
   */
  async showQRCode(serverId: string): Promise<void> {
    try {
      const qrDataUrl = await QRCode.toDataURL(serverId, {
        width: 400,
        margin: 2,
      });

      // Close existing QR window if open
      if (this.qrWindow && !this.qrWindow.isDestroyed()) {
        this.qrWindow.close();
      }

      // Create new window
      this.qrWindow = new BrowserWindow({
        width: 500,
        height: 600,
        resizable: false,
        title: "Server QR Code",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // Generate HTML content
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Server QR Code</title>
            <style>
              body {
                margin: 0;
                padding: 20px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                background: #f5f5f5;
              }
              .container {
                background: white;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                text-align: center;
              }
              h1 {
                margin: 0 0 20px 0;
                font-size: 24px;
                color: #333;
              }
              .qr-code {
                margin: 20px 0;
              }
              .server-id {
                margin: 20px 0;
                padding: 10px;
                background: #f5f5f5;
                border-radius: 6px;
                font-family: monospace;
                font-size: 12px;
                word-break: break-all;
                color: #666;
              }
              .instructions {
                margin-top: 20px;
                font-size: 14px;
                color: #666;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>LocalLLM Server</h1>
              <div class="qr-code">
                <img src="${qrDataUrl}" alt="QR Code" />
              </div>
              <div class="server-id">${serverId}</div>
              <div class="instructions">
                Scan this QR code or copy the Server ID to connect from your client device.
              </div>
            </div>
          </body>
        </html>
      `;

      // Load HTML content
      await this.qrWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      // Clean up reference when window is closed
      this.qrWindow.on("closed", () => {
        this.qrWindow = null;
      });
    } catch (error) {
      console.error("Failed to show QR code:", error);
    }
  }

  /**
   * Destroy the tray.
   */
  destroy(): void {
    if (this.qrWindow && !this.qrWindow.isDestroyed()) {
      this.qrWindow.close();
      this.qrWindow = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
