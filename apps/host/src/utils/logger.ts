import fs from "fs";
import path from "path";
import os from "os";

// Global log file path (created once per session)
const LOG_FILE_PATH = path.join(os.tmpdir(), `localllm-host-${Date.now()}.log`);

/**
 * Simple debug logger that can be toggled on/off.
 * Verbose logs (log()) are written to file only when debug logs are enabled.
 * Warnings and errors are always written to file regardless of debug toggle.
 */
export class Logger {
  private enabled = false;
  private prefix: string;
  private static fileStream: fs.WriteStream | null = null;

  constructor(prefix: string) {
    this.prefix = `[${prefix}]`;
    Logger.ensureFileStream();
  }

  /**
   * Ensure the file stream is initialized.
   */
  private static ensureFileStream(): void {
    if (!Logger.fileStream) {
      Logger.fileStream = fs.createWriteStream(LOG_FILE_PATH, { flags: "a" });
    }
  }

  /**
   * Get the log file path.
   */
  static getLogFilePath(): string {
    return LOG_FILE_PATH;
  }

  /**
   * Enable or disable logging.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if logging is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Write to log file.
   */
  private writeToFile(level: string, ...args: any[]): void {
    if (Logger.fileStream) {
      const timestamp = new Date().toISOString();
      const message = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
      Logger.fileStream.write(`${timestamp} ${level} ${this.prefix} ${message}\n`);
    }
  }

  /**
   * Log a message (only if debug logs enabled).
   * Writes to file only when enabled.
   */
  log(...args: any[]): void {
    if (this.enabled) {
      console.log(this.prefix, ...args);
      this.writeToFile("INFO", ...args);
    }
  }

  /**
   * Log an error (always logged to file, console only if enabled).
   */
  error(...args: any[]): void {
    // Always write to file
    this.writeToFile("ERROR", ...args);
    if (this.enabled) {
      console.error(this.prefix, ...args);
    }
  }

  /**
   * Log a warning (always logged to file, console only if enabled).
   */
  warn(...args: any[]): void {
    // Always write to file
    this.writeToFile("WARN", ...args);
    if (this.enabled) {
      console.warn(this.prefix, ...args);
    }
  }

  /**
   * Close the log file stream.
   */
  static closeFileStream(): void {
    if (Logger.fileStream) {
      Logger.fileStream.end();
      Logger.fileStream = null;
    }
  }
}
