import { app, Menu, Tray, clipboard, nativeImage, BrowserWindow } from "electron";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";
import { Logger } from "../utils/logger.js";

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
  private logger: Logger;

  constructor(callbacks: MenuCallbacks) {
    this.callbacks = callbacks;
    this.logger = new Logger("TrayMenu");
  }

  /**
   * Initialize the tray icon and menu.
   */
  async init(): Promise<void> {
    // Create a simple text-based tray icon for macOS
    // Generate a 16x16 PNG with "LLM" text
    const icon = this.createTrayIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip("LocalLLM Host");

    this.updateMenu();
  }

  /**
   * Create a simple monochrome tray icon.
   */
  private createTrayIcon(): Electron.NativeImage {
    // Create a 16x16 canvas-like bitmap
    // For macOS, we'll use a Template image (monochrome)
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4); // RGBA

    // Fill with transparent background
    canvas.fill(0);

    // Draw simple "LLM" pattern (simplified pixel art)
    // This creates a minimal recognizable icon
    const setPixel = (x: number, y: number, alpha: number) => {
      if (x >= 0 && x < size && y >= 0 && y < size) {
        const idx = (y * size + x) * 4;
        canvas[idx] = 0;     // R
        canvas[idx + 1] = 0; // G
        canvas[idx + 2] = 0; // B
        canvas[idx + 3] = alpha; // A (0-255)
      }
    };

    // Draw a simple "LLM" text pattern (3x5 pixels per letter, with spacing)
    // Letter "L" at x=2
    for (let y = 4; y < 9; y++) setPixel(2, y, 255);
    setPixel(3, 8, 255);

    // Letter "L" at x=5
    for (let y = 4; y < 9; y++) setPixel(5, y, 255);
    setPixel(6, 8, 255);

    // Letter "M" at x=8-11
    for (let y = 4; y < 9; y++) {
      setPixel(8, y, 255);
      setPixel(11, y, 255);
    }
    setPixel(9, 5, 255);
    setPixel(10, 5, 255);

    const image = nativeImage.createFromBuffer(canvas, {
      width: size,
      height: size,
    });

    // Mark as template image for macOS (will adapt to light/dark mode)
    image.setTemplateImage(true);

    return image;
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
      this.logger.error("Failed to show QR code:", error);
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
