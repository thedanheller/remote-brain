import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamingRelay } from "../src/relay/relay.js";
import { Duplex } from "stream";
import { ErrorCode } from "@localllm/protocol";

// Mock socket implementation
class MockSocket extends Duplex {
  private messages: string[] = [];

  _read() {}

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void) {
    this.messages.push(chunk.toString());
    callback();
  }

  getMessages(): any[] {
    return this.messages.map((msg) => {
      try {
        return JSON.parse(msg);
      } catch {
        return msg;
      }
    });
  }

  clearMessages(): void {
    this.messages = [];
  }

  simulateMessage(message: any): void {
    this.push(JSON.stringify(message) + "\n");
  }
}

describe("StreamingRelay", () => {
  let relay: StreamingRelay;
  let socket: MockSocket;

  beforeEach(() => {
    relay = new StreamingRelay({
      model: "llama3.2",
      hostName: "Test Host",
    });

    socket = new MockSocket();
    vi.clearAllMocks();
  });

  it("should send server_info on connection", () => {
    relay.handleConnection(socket);

    const messages = socket.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "server_info",
      payload: {
        host_name: "Test Host",
        model: "llama3.2",
        status: "ready",
      },
    });
  });

  it("should reject prompt exceeding 8KB", async () => {
    relay.handleConnection(socket);
    socket.clearMessages();

    const largePrompt = "a".repeat(8193);
    socket.simulateMessage({
      type: "chat_start",
      request_id: "req-1",
      payload: { prompt: largePrompt },
    });

    // Wait for message processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    const messages = socket.getMessages();
    expect(messages.some((m) => m.type === "error" && m.payload?.code === ErrorCode.BAD_MESSAGE)).toBe(true);
  });

  it("should handle model busy scenario", async () => {
    relay.handleConnection(socket);
    socket.clearMessages();

    // Mock Ollama adapter to simulate long-running generation
    const mockGenerate = vi.fn().mockImplementation((requestId, model, prompt, callbacks) => {
      // Simulate async operation
      setTimeout(() => {
        callbacks.onChunk("test");
        callbacks.onEnd();
      }, 100);
    });

    // Replace the Ollama adapter's generate method
    (relay as any).ollama.generate = mockGenerate;

    // First request should succeed
    socket.simulateMessage({
      type: "chat_start",
      request_id: "req-1",
      payload: { prompt: "First prompt" },
    });

    // Second request should be rejected with MODEL_BUSY
    socket.simulateMessage({
      type: "chat_start",
      request_id: "req-2",
      payload: { prompt: "Second prompt" },
    });

    // Wait a bit for messages to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messages = socket.getMessages();
    const errorMessage = messages.find((m) => m.type === "error" && m.request_id === "req-2");

    expect(errorMessage).toBeDefined();
    expect(errorMessage?.payload?.code).toBe(ErrorCode.MODEL_BUSY);
  });

  it("should update model", () => {
    relay.setModel("mistral");
    expect(relay.getModel()).toBe("mistral");
  });

  it("should track busy state", async () => {
    expect(relay.isBusy()).toBe(false);

    relay.handleConnection(socket);
    socket.clearMessages();

    // Mock Ollama to make relay busy
    const mockGenerate = vi.fn().mockImplementation((requestId, model, prompt, callbacks) => {
      // Don't call callbacks immediately to keep it busy
    });

    (relay as any).ollama.generate = mockGenerate;

    socket.simulateMessage({
      type: "chat_start",
      request_id: "req-1",
      payload: { prompt: "Test" },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(relay.isBusy()).toBe(true);
  });

  it("should handle abort message", async () => {
    relay.handleConnection(socket);
    socket.clearMessages();

    let aborted = false;
    const mockAbort = vi.fn().mockImplementation(() => {
      aborted = true;
      return true;
    });

    (relay as any).ollama.abort = mockAbort;

    // Simulate active request
    (relay as any).gate.acquire("req-1");
    (relay as any).socketMap.set(socket, "req-1");

    socket.simulateMessage({
      type: "abort",
      request_id: "req-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAbort).toHaveBeenCalledWith("req-1");

    const messages = socket.getMessages();
    const endMessage = messages.find((m) => m.type === "chat_end" && m.request_id === "req-1");

    expect(endMessage).toBeDefined();
    expect(endMessage?.payload?.finish_reason).toBe("abort");
  });

  it("should close socket if server_info write doesn't flush within 5s", async () => {
    vi.useFakeTimers();

    // Create a socket that never flushes writes (callback never called)
    const slowSocket = new MockSocket();
    const originalWrite = slowSocket.write.bind(slowSocket);
    let destroyCalled = false;

    slowSocket.write = ((data: any, encodingOrCallback?: any, callback?: any) => {
      // Accept the data but never call the callback to simulate stalled write
      return true;
    }) as any;

    slowSocket.destroy = (() => {
      destroyCalled = true;
    }) as any;

    relay.handleConnection(slowSocket);

    // Advance past the 5s timeout
    await vi.advanceTimersByTimeAsync(5_000);

    expect(destroyCalled).toBe(true);

    vi.useRealTimers();
  });

  it("should not close socket if server_info flushes in time", async () => {
    vi.useFakeTimers();

    let destroyCalled = false;
    const originalDestroy = socket.destroy.bind(socket);
    socket.destroy = (() => {
      destroyCalled = true;
      originalDestroy();
    }) as any;

    relay.handleConnection(socket);

    // Advance time but within the timeout — write should have flushed synchronously
    await vi.advanceTimersByTimeAsync(5_000);

    // Socket should NOT be destroyed because write flushed synchronously
    expect(destroyCalled).toBe(false);

    vi.useRealTimers();
  });

  it("should cleanup on disconnection", () => {
    relay.handleConnection(socket);

    // Simulate active request
    (relay as any).gate.acquire("req-1");
    (relay as any).socketMap.set(socket, "req-1");

    const mockAbort = vi.fn().mockReturnValue(true);
    (relay as any).ollama.abort = mockAbort;

    relay.handleDisconnection(socket);

    expect(mockAbort).toHaveBeenCalledWith("req-1");
    expect((relay as any).socketMap.has(socket)).toBe(false);
  });

  it("should send OLLAMA_NOT_FOUND error when Ollama becomes unreachable mid-inference", async () => {
    relay.handleConnection(socket);
    socket.clearMessages();

    let ollamaUnreachableCalled = false;
    relay = new StreamingRelay({
      model: "llama3.2",
      hostName: "Test Host",
      onOllamaUnreachable: () => {
        ollamaUnreachableCalled = true;
      },
    });

    relay.handleConnection(socket);
    socket.clearMessages();

    // Mock Ollama to simulate connection refused error mid-inference
    const mockGenerate = vi.fn().mockImplementation((requestId, model, prompt, callbacks) => {
      // Simulate Ollama becoming unreachable during generation
      setTimeout(() => {
        callbacks.onError(ErrorCode.OLLAMA_NOT_FOUND, "Cannot connect to Ollama (not running?)");
      }, 10);
    });

    (relay as any).ollama.generate = mockGenerate;

    socket.simulateMessage({
      type: "chat_start",
      request_id: "req-1",
      payload: { prompt: "Test prompt" },
    });

    // Wait for the error to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messages = socket.getMessages();
    const errorMessage = messages.find((m) => m.type === "error" && m.request_id === "req-1");

    // Verify error message was sent to client
    expect(errorMessage).toBeDefined();
    expect(errorMessage?.payload?.code).toBe(ErrorCode.OLLAMA_NOT_FOUND);
    expect(errorMessage?.payload?.message).toContain("Cannot connect to Ollama");

    // Verify onOllamaUnreachable callback was triggered
    expect(ollamaUnreachableCalled).toBe(true);

    // Verify gate was released (relay should no longer be busy)
    expect(relay.isBusy()).toBe(false);
  });
});
