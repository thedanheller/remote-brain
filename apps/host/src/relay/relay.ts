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
import { Logger } from "../utils/logger.js";

export interface RelayConfig {
  model: string;
  hostName: string;
  ollamaBaseUrl?: string;
  logger?: Logger;
  onStateChange?: () => void;
  onOllamaUnreachable?: () => void;
}

const SERVER_INFO_TIMEOUT_MS = 5_000;

/**
 * Streaming relay that connects clients to the Ollama inference engine.
 */
export class StreamingRelay {
  private gate = new ConcurrencyGate();
  private ollama: OllamaAdapter;
  private config: RelayConfig;
  private socketMap = new Map<Duplex, string>();
  private logger: Logger;

  constructor(config: RelayConfig) {
    this.config = config;
    this.logger = config.logger || new Logger("StreamingRelay");
    this.ollama = new OllamaAdapter(config.ollamaBaseUrl, this.logger);
  }

  /**
   * Handle a new client connection.
   */
  handleConnection(socket: Duplex): void {
    this.logger.log("Handling new client connection");
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
    this.logger.log("Handling client disconnection");
    const requestId = this.socketMap.get(socket);
    if (requestId) {
      this.logger.log(`Cleaning up request ${requestId}`);
      this.ollama.abort(requestId);
      this.gate.release(requestId);
      this.socketMap.delete(socket);
    }
  }

  /**
   * Send server_info message to a client with a delivery timeout.
   * If the write doesn't flush within 5 seconds, close the socket.
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

    let delivered = false;
    const timeout = setTimeout(() => {
      if (!delivered) {
        this.logger.warn("server_info not delivered within 5s, closing socket");
        socket.destroy();
      }
    }, SERVER_INFO_TIMEOUT_MS);

    socket.write(encode(message), () => {
      delivered = true;
      clearTimeout(timeout);
    });
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

    this.logger.log(`Received chat_start for request ${request_id}`);

    // Validate prompt size (max 8 KB)
    if (payload.prompt.length > 8192) {
      this.logger.warn(`Request ${request_id} rejected: prompt too large`);
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
      this.logger.warn(`Request ${request_id} rejected: model busy`);
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

    this.logger.log(`Request ${request_id} acquired concurrency gate`);

    // Track this request for this socket
    this.socketMap.set(socket, request_id);

    // Notify state change (inference started)
    if (this.config.onStateChange) {
      this.config.onStateChange();
    }

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

        // Notify state change (inference ended)
        if (this.config.onStateChange) {
          this.config.onStateChange();
        }
      },

      onError: (code, errorMessage) => {
        socket.write(encode(createErrorMessage(code, errorMessage, request_id)));
        this.gate.release(request_id);
        this.socketMap.delete(socket);

        // If Ollama became unreachable, notify parent
        if (code === ErrorCode.OLLAMA_NOT_FOUND && this.config.onOllamaUnreachable) {
          this.config.onOllamaUnreachable();
        }

        // Notify state change (inference ended with error)
        if (this.config.onStateChange) {
          this.config.onStateChange();
        }
      },
    });
  }

  /**
   * Handle abort message.
   */
  private handleAbort(socket: Duplex, message: AbortMessage): void {
    const { request_id } = message;

    this.logger.log(`Received abort for request ${request_id}`);

    const activeRequest = this.socketMap.get(socket);
    if (activeRequest === request_id) {
      const aborted = this.ollama.abort(request_id);
      if (aborted) {
        this.logger.log(`Request ${request_id} aborted successfully`);
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
   * Get the active request ID if any.
   */
  getActiveRequestId(): string | null {
    return this.gate.getActiveRequest();
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
