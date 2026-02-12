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
});
