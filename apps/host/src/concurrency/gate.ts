import { ErrorCode } from "@localllm/protocol";

/**
 * Global concurrency gate that ensures only one inference can run at a time.
 * Additional requests are rejected with MODEL_BUSY error.
 */
export class ConcurrencyGate {
  private activeRequestId: string | null = null;

  /**
   * Attempt to acquire the gate for a request.
   * @returns true if acquired, false if busy
   */
  acquire(requestId: string): boolean {
    if (this.activeRequestId !== null) {
      return false;
    }
    this.activeRequestId = requestId;
    return true;
  }

  /**
   * Release the gate for a request.
   * Only the active request can release the gate.
   */
  release(requestId: string): void {
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
    }
  }

  /**
   * Check if the gate is currently busy.
   */
  isBusy(): boolean {
    return this.activeRequestId !== null;
  }

  /**
   * Get the currently active request ID, if any.
   */
  getActiveRequest(): string | null {
    return this.activeRequestId;
  }

  /**
   * Force release the gate (use with caution).
   */
  forceRelease(): void {
    this.activeRequestId = null;
  }
}
