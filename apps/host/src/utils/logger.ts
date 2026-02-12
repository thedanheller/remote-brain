/**
 * Simple debug logger that can be toggled on/off.
 */
export class Logger {
  private enabled = false;
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = `[${prefix}]`;
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
   * Log a message (if enabled).
   */
  log(...args: any[]): void {
    if (this.enabled) {
      console.log(this.prefix, ...args);
    }
  }

  /**
   * Log an error (if enabled).
   */
  error(...args: any[]): void {
    if (this.enabled) {
      console.error(this.prefix, ...args);
    }
  }

  /**
   * Log a warning (if enabled).
   */
  warn(...args: any[]): void {
    if (this.enabled) {
      console.warn(this.prefix, ...args);
    }
  }
}
