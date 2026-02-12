/**
 * Mock client test harness for end-to-end testing.
 *
 * This script connects to a running host via Hyperswarm, sends a chat_start
 * message, collects streamed chunks, and asserts it receives chat_end.
 *
 * Usage:
 *   tsx test/e2e/mock-client.ts <server-id>
 */

import Hyperswarm from "hyperswarm";
import bs58 from "bs58";
import { createDecoder, encode, type ProtocolMessage } from "@localllm/protocol";

interface TestResult {
  success: boolean;
  error?: string;
  receivedServerInfo: boolean;
  receivedChunks: number;
  receivedChatEnd: boolean;
  finishReason?: string;
}

async function runMockClient(serverId: string): Promise<TestResult> {
  const result: TestResult = {
    success: false,
    receivedServerInfo: false,
    receivedChunks: 0,
    receivedChatEnd: false,
  };

  return new Promise((resolve) => {
    const swarm = new Hyperswarm();
    const topic = bs58.decode(serverId);

    console.log(`[MockClient] Connecting to server: ${serverId}`);

    swarm.join(topic, { server: false, client: true });

    swarm.on("connection", (socket) => {
      console.log("[MockClient] Connected to host");

      const decoder = createDecoder((parsed) => {
        const message = parsed as ProtocolMessage;
        console.log("[MockClient] Received message:", message.type);

        switch (message.type) {
          case "server_info":
            result.receivedServerInfo = true;
            console.log("[MockClient] Server info:", message.payload);

            // Send chat_start message
            const chatStart = {
              type: "chat_start",
              request_id: "test-request-1",
              payload: {
                prompt: "Say hello in one word",
              },
            };
            console.log("[MockClient] Sending chat_start");
            socket.write(encode(chatStart));
            break;

          case "chat_chunk":
            result.receivedChunks++;
            console.log("[MockClient] Received chunk:", message.payload.text);
            break;

          case "chat_end":
            result.receivedChatEnd = true;
            result.finishReason = message.payload.finish_reason;
            console.log("[MockClient] Received chat_end, finish_reason:", result.finishReason);

            // Test completed successfully
            result.success =
              result.receivedServerInfo &&
              result.receivedChunks > 0 &&
              result.receivedChatEnd;

            // Close connection
            socket.destroy();
            swarm.leave(topic);
            swarm.destroy().then(() => {
              resolve(result);
            });
            break;

          case "error":
            result.error = `${message.payload.code}: ${message.payload.message}`;
            console.error("[MockClient] Received error:", result.error);

            socket.destroy();
            swarm.leave(topic);
            swarm.destroy().then(() => {
              resolve(result);
            });
            break;
        }
      });

      socket.on("data", (chunk) => {
        decoder.write(chunk.toString());
      });

      socket.on("error", (error) => {
        console.error("[MockClient] Socket error:", error);
        result.error = error.message;
        swarm.leave(topic);
        swarm.destroy().then(() => {
          resolve(result);
        });
      });

      socket.on("close", () => {
        console.log("[MockClient] Connection closed");
        if (!result.success && !result.error) {
          result.error = "Connection closed unexpectedly";
        }
        swarm.leave(topic);
        swarm.destroy().then(() => {
          resolve(result);
        });
      });
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!result.success) {
        result.error = "Timeout: no response within 30 seconds";
        swarm.leave(topic);
        swarm.destroy().then(() => {
          resolve(result);
        });
      }
    }, 30000);
  });
}

// Main execution
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const serverId = process.argv[2];

  if (!serverId) {
    console.error("Usage: node dist/test/e2e/mock-client.js <server-id>");
    process.exit(1);
  }

  console.log("[MockClient] Starting end-to-end test...");
  console.log("[MockClient] Target server ID:", serverId);

  runMockClient(serverId)
    .then((result) => {
      console.log("\n=== Test Result ===");
      console.log("Success:", result.success);
      console.log("Received server_info:", result.receivedServerInfo);
      console.log("Received chunks:", result.receivedChunks);
      console.log("Received chat_end:", result.receivedChatEnd);
      if (result.finishReason) {
        console.log("Finish reason:", result.finishReason);
      }
      if (result.error) {
        console.error("Error:", result.error);
      }

      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Test failed with exception:", error);
      process.exit(1);
    });
}

export { runMockClient };
