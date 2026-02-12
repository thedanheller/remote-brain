import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Hyperswarm from "hyperswarm";
import bs58 from "bs58";
import type { Duplex } from "stream";
import {
  encode,
  createDecoder,
  ErrorCode,
  generateRequestId,
  type ProtocolMessage,
  type ServerInfoMessage,
  type ChatChunkMessage,
  type ChatEndMessage,
  type ErrorMessage,
} from "@localllm/protocol";
import { SwarmServer } from "../src/server/swarm.js";
import { StreamingRelay } from "../src/relay/relay.js";

/**
 * Mock Ollama responses for testing.
 */
function mockOllamaFetch(scenario: "success" | "busy" | "abort") {
  return vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/api/generate")) {
      if (scenario === "success") {
        // Simulate streaming NDJSON response
        const chunks = [
          JSON.stringify({ model: "llama3.2", response: "Hello ", done: false }),
          JSON.stringify({ model: "llama3.2", response: "there!", done: false }),
          JSON.stringify({ model: "llama3.2", response: "", done: true }),
        ];

        const stream = new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              // Check if aborted
              if (options?.signal?.aborted) {
                controller.close();
                return;
              }
              controller.enqueue(new TextEncoder().encode(chunk + "\n"));
              // Small delay to simulate streaming
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            controller.close();
          },
        });

        return {
          ok: true,
          status: 200,
          body: stream,
        } as Response;
      }

      if (scenario === "abort") {
        // Simulate streaming that can be aborted
        const stream = new ReadableStream({
          async start(controller) {
            const chunks = [
              JSON.stringify({ model: "llama3.2", response: "Start ", done: false }),
              JSON.stringify({ model: "llama3.2", response: "of ", done: false }),
            ];

            for (const chunk of chunks) {
              if (options?.signal?.aborted) {
                controller.close();
                return;
              }
              controller.enqueue(new TextEncoder().encode(chunk + "\n"));
              await new Promise((resolve) => setTimeout(resolve, 10));
            }

            // Keep stream open so test can abort
            await new Promise((resolve) => setTimeout(resolve, 5000));
            controller.close();
          },
        });

        return {
          ok: true,
          status: 200,
          body: stream,
        } as Response;
      }
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response;
  });
}

/**
 * Helper to collect messages from a socket.
 */
function collectMessages(socket: Duplex): Promise<ProtocolMessage[]> {
  return new Promise((resolve) => {
    const messages: ProtocolMessage[] = [];
    const decoder = createDecoder((parsed) => {
      messages.push(parsed as ProtocolMessage);
    });

    socket.on("data", (chunk) => {
      decoder.write(chunk.toString());
    });

    // Resolve after a short delay to collect all messages
    setTimeout(() => resolve(messages), 200);
  });
}

/**
 * Helper to wait for a specific message type.
 */
function waitForMessage(
  socket: Duplex,
  messageType: string,
  timeout = 1000,
): Promise<ProtocolMessage> {
  return new Promise((resolve, reject) => {
    const decoder = createDecoder((parsed) => {
      const message = parsed as ProtocolMessage;
      if (message.type === messageType) {
        resolve(message);
      }
    });

    socket.on("data", (chunk) => {
      decoder.write(chunk.toString());
    });

    setTimeout(() => reject(new Error(`Timeout waiting for ${messageType}`)), timeout);
  });
}

describe.sequential("E2E Integration Test", () => {
  let server: SwarmServer;
  let relay: StreamingRelay;
  let serverId: string;
  let clientSwarm: Hyperswarm;
  let clientSocket: Duplex | null;
  let errorListeners: Array<(...args: any[]) => void> = [];

  beforeEach(async () => {
    // Add process error handler to suppress expected connection errors
    const errorHandler = (error: Error) => {
      if (
        error.message?.includes("connection reset") ||
        (error as any).code === "ECONNRESET"
      ) {
        // Silently ignore expected connection reset errors during tests
        return;
      }
    };
    process.on("uncaughtException", errorHandler);
    errorListeners.push(errorHandler);
    // Reset mocks
    vi.clearAllMocks();

    // Initialize server and relay
    relay = new StreamingRelay({
      model: "llama3.2",
      hostName: "Test Host",
      ollamaBaseUrl: "http://localhost:11434",
    });

    server = new SwarmServer({
      onConnection: (socket) => relay.handleConnection(socket),
      onDisconnection: (socket) => relay.handleDisconnection(socket),
    });

    // Start server
    serverId = await server.start();

    // Initialize client swarm
    clientSwarm = new Hyperswarm();
    clientSocket = null;
  });

  afterEach(async () => {
    // Clean up client socket first
    if (clientSocket) {
      try {
        clientSocket.removeAllListeners();
        clientSocket.destroy();
        clientSocket = null;
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Clean up client swarm
    if (clientSwarm) {
      try {
        await clientSwarm.destroy();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Clean up server
    if (server) {
      try {
        await server.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Remove error listeners
    for (const listener of errorListeners) {
      process.removeListener("uncaughtException", listener);
    }
    errorListeners = [];

    vi.restoreAllMocks();

    // Add longer delay to ensure cleanup completes and ports are released
    // Hyperswarm needs time to fully close connections
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

  it(
    "(a) Client connects and receives server_info with host_name and model",
    async () => {
      // Connect client to server
      const topic = bs58.decode(serverId);
      const discovery = clientSwarm.join(topic, { server: false, client: true });
      await discovery.flushed();

      // Wait for connection
      const connectionPromise = new Promise<Duplex>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 8000);

        clientSwarm.once("connection", (socket) => {
          clearTimeout(timeout);
          // Add error handler to prevent uncaught exceptions
          socket.on("error", () => {
            // Silently ignore socket errors during tests
          });
          resolve(socket);
        });
      });

      clientSocket = await connectionPromise;

      // Wait for server_info
      const serverInfo = (await waitForMessage(
        clientSocket,
        "server_info",
        3000,
      )) as ServerInfoMessage;

      expect(serverInfo.type).toBe("server_info");
      expect(serverInfo.payload.host_name).toBe("Test Host");
      expect(serverInfo.payload.model).toBe("llama3.2");
      expect(serverInfo.payload.status).toBe("ready");
    },
    15000,
  );

  it(
    "(b) Client sends chat_start and receives chat_chunk(s) and chat_end with finish_reason 'stop'",
    async () => {
      // Mock Ollama fetch
      global.fetch = mockOllamaFetch("success") as typeof fetch;

      // Connect client
      const topic = bs58.decode(serverId);
      const discovery = clientSwarm.join(topic, { server: false, client: true });
      await discovery.flushed();

      const connectionPromise = new Promise<Duplex>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 8000);

        clientSwarm.once("connection", (socket) => {
          clearTimeout(timeout);
          // Add error handler to prevent uncaught exceptions
          socket.on("error", () => {
            // Silently ignore socket errors during tests
          });
          resolve(socket);
        });
      });

      clientSocket = await connectionPromise;

      // Wait for server_info
      await waitForMessage(clientSocket, "server_info", 3000);

    // Send chat_start
    const requestId = generateRequestId();
    const chatStart = {
      type: "chat_start",
      request_id: requestId,
      payload: { prompt: "Hello" },
    };

    clientSocket.write(encode(chatStart));

    // Collect response messages
    const messages: ProtocolMessage[] = [];
    const decoder = createDecoder((parsed) => {
      const message = parsed as ProtocolMessage;
      if ("request_id" in message && message.request_id === requestId) {
        messages.push(message);
      }
    });

    clientSocket.on("data", (chunk) => {
      decoder.write(chunk.toString());
    });

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify we got chunks and end
    const chunks = messages.filter((m) => m.type === "chat_chunk") as ChatChunkMessage[];
    const end = messages.find((m) => m.type === "chat_end") as ChatEndMessage;

    expect(chunks.length).toBeGreaterThan(0);
    expect(end).toBeDefined();
    expect(end.payload.finish_reason).toBe("stop");

    // Verify chunk content
    const fullText = chunks.map((c) => c.payload.text).join("");
    expect(fullText).toContain("Hello");
    expect(fullText).toContain("there");
  },
  15000,
);

  it(
    "(c) Client sends chat_start while busy and receives error with MODEL_BUSY",
    async () => {
      // Mock Ollama fetch with a long-running response
      global.fetch = vi.fn(async (url: string) => {
        if (url.includes("/api/generate")) {
          const stream = new ReadableStream({
            async start(controller) {
              // Keep stream open for a long time
              await new Promise((resolve) => setTimeout(resolve, 2000));
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({ model: "llama3.2", response: "", done: true }) + "\n",
                ),
              );
              controller.close();
            },
          });

          return {
            ok: true,
            status: 200,
            body: stream,
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        } as Response;
      }) as typeof fetch;

      // Connect client
      const topic = bs58.decode(serverId);
      const discovery = clientSwarm.join(topic, { server: false, client: true });
      await discovery.flushed();

      const connectionPromise = new Promise<Duplex>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 8000);

        clientSwarm.once("connection", (socket) => {
          clearTimeout(timeout);
          // Add error handler to prevent uncaught exceptions
          socket.on("error", () => {
            // Silently ignore socket errors during tests
          });
          resolve(socket);
        });
      });

      clientSocket = await connectionPromise;

      // Wait for server_info
      await waitForMessage(clientSocket, "server_info", 3000);

    // Send first chat_start
    const requestId1 = generateRequestId();
    const chatStart1 = {
      type: "chat_start",
      request_id: requestId1,
      payload: { prompt: "First request" },
    };

    clientSocket.write(encode(chatStart1));

    // Wait a bit for the first request to start processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send second chat_start (should be rejected)
    const requestId2 = generateRequestId();
    const chatStart2 = {
      type: "chat_start",
      request_id: requestId2,
      payload: { prompt: "Second request" },
    };

    clientSocket.write(encode(chatStart2));

    // Wait for error message
    const errorMsg = (await waitForMessage(clientSocket, "error", 2000)) as ErrorMessage;

    expect(errorMsg.type).toBe("error");
    expect(errorMsg.request_id).toBe(requestId2);
    expect(errorMsg.payload.code).toBe(ErrorCode.MODEL_BUSY);
    expect(errorMsg.payload.message).toContain("processing another request");
  },
  15000,
);

  it(
    "(d) Client sends abort mid-stream and receives chat_end with finish_reason 'abort'",
    async () => {
      // Mock Ollama fetch with abortable stream
      global.fetch = mockOllamaFetch("abort") as typeof fetch;

      // Connect client
      const topic = bs58.decode(serverId);
      const discovery = clientSwarm.join(topic, { server: false, client: true });
      await discovery.flushed();

      const connectionPromise = new Promise<Duplex>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 8000);

        clientSwarm.once("connection", (socket) => {
          clearTimeout(timeout);
          // Add error handler to prevent uncaught exceptions
          socket.on("error", () => {
            // Silently ignore socket errors during tests
          });
          resolve(socket);
        });
      });

      clientSocket = await connectionPromise;

      // Wait for server_info
      await waitForMessage(clientSocket, "server_info", 3000);

      // Send chat_start
      const requestId = generateRequestId();
      const chatStart = {
        type: "chat_start",
        request_id: requestId,
        payload: { prompt: "Tell me a story" },
      };

      clientSocket.write(encode(chatStart));

      // Wait for at least one chunk
      await waitForMessage(clientSocket, "chat_chunk", 3000);

      // Send abort
      const abort = {
        type: "abort",
        request_id: requestId,
      };

      clientSocket.write(encode(abort));

      // Wait for chat_end with abort
      const endMsg = (await waitForMessage(clientSocket, "chat_end", 3000)) as ChatEndMessage;

      expect(endMsg.type).toBe("chat_end");
      expect(endMsg.request_id).toBe(requestId);
      expect(endMsg.payload.finish_reason).toBe("abort");
    },
    15000,
  );
});
