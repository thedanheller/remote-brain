import type { Duplex } from "stream";
import {
  encode,
  createDecoder,
  ErrorCode,
  createErrorMessage,
  type ProtocolMessage,
  type ChatStartMessage,
  type AbortMessage,
  type ChatChunkMessage,
  type ChatEndMessage,
  type ServerInfoMessage,
} from "@localllm/protocol";
import { ConcurrencyGate } from "../concurrency/gate.js";
import { OllamaAdapter } from "../ollama/adapter.js";

export interface RelayConfig {
  model: string;
  hostName: string;
  ollamaBaseUrl?: string;
}

/**
 * Streaming relay that connects clients to the Ollama inference engine.
 */
export class StreamingRelay {
  private gate = new ConcurrencyGate();
  private ollama: OllamaAdapter;
  private config: RelayConfig;
  private socketMap = new Map<Duplex, string>();

  constructor(config: RelayConfig) {
    this.config = config;
    this.ollama = new OllamaAdapter(config.ollamaBaseUrl);
  }

  /**
   * Handle a new client connection.
   */
  handleConnection(socket: Duplex): void {
    const decoder = createDecoder((parsed) => {
      this.handleMessage(socket, parsed);
    });

    // Send server_info on connection
    this.sendServerInfo(socket);

    socket.on("data", (chunk) => {
      decoder.write(chunk.toString());
    });
  }

  /**
   * Handle a client disconnection.
   */
  handleDisconnection(socket: Duplex): void {
    const requestId = this.socketMap.get(socket);
    if (requestId) {
      this.ollama.abort(requestId);
      this.gate.release(requestId);
      this.socketMap.delete(socket);
    }
  }

  /**
   * Send server_info message to a client.
   */
  private sendServerInfo(socket: Duplex): void {
    const message: ServerInfoMessage = {
      type: "server_info",
      payload: {
        host_name: this.config.hostName,
        model: this.config.model,
        status: this.gate.isBusy() ? "busy" : "ready",
      },
    };
    socket.write(encode(message));
  }

  /**
   * Handle incoming protocol messages.
   */
  private handleMessage(socket: Duplex, parsed: unknown): void {
    try {
      const message = parsed as ProtocolMessage;

      switch (message.type) {
        case "chat_start":
          this.handleChatStart(socket, message as ChatStartMessage);
          break;

        case "abort":
          this.handleAbort(socket, message as AbortMessage);
          break;

        default:
          console.warn("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      socket.write(encode(createErrorMessage(ErrorCode.BAD_MESSAGE, "Invalid message format")));
    }
  }

  /**
   * Handle chat_start message.
   */
  private handleChatStart(socket: Duplex, message: ChatStartMessage): void {
    const { request_id, payload } = message;

    // Validate prompt size (max 8 KB)
    if (payload.prompt.length > 8192) {
      socket.write(
        encode(
          createErrorMessage(
            ErrorCode.BAD_MESSAGE,
            "Prompt exceeds maximum size of 8 KB",
            request_id,
          ),
        ),
      );
      return;
    }

    // Try to acquire the concurrency gate
    if (!this.gate.acquire(request_id)) {
      socket.write(
        encode(
          createErrorMessage(
            ErrorCode.MODEL_BUSY,
            "Host is processing another request",
            request_id,
          ),
        ),
      );
      return;
    }

    // Track this request for this socket
    this.socketMap.set(socket, request_id);

    // Start Ollama generation
    this.ollama.generate(request_id, this.config.model, payload.prompt, {
      onChunk: (text) => {
        const chunk: ChatChunkMessage = {
          type: "chat_chunk",
          request_id,
          payload: { text },
        };
        socket.write(encode(chunk));
      },

      onEnd: () => {
        const end: ChatEndMessage = {
          type: "chat_end",
          request_id,
          payload: { finish_reason: "stop" },
        };
        socket.write(encode(end));
        this.gate.release(request_id);
        this.socketMap.delete(socket);
      },

      onError: (code, errorMessage) => {
        socket.write(encode(createErrorMessage(code, errorMessage, request_id)));
        this.gate.release(request_id);
        this.socketMap.delete(socket);
      },
    });
  }

  /**
   * Handle abort message.
   */
  private handleAbort(socket: Duplex, message: AbortMessage): void {
    const { request_id } = message;

    const activeRequest = this.socketMap.get(socket);
    if (activeRequest === request_id) {
      const aborted = this.ollama.abort(request_id);
      if (aborted) {
        this.gate.release(request_id);
        this.socketMap.delete(socket);

        const end: ChatEndMessage = {
          type: "chat_end",
          request_id,
          payload: { finish_reason: "abort" },
        };
        socket.write(encode(end));
      }
    }
  }

  /**
   * Check if the relay is busy.
   */
  isBusy(): boolean {
    return this.gate.isBusy();
  }

  /**
   * Update the model.
   */
  setModel(model: string): void {
    this.config.model = model;
  }

  /**
   * Get the current model.
   */
  getModel(): string {
    return this.config.model;
  }
}
