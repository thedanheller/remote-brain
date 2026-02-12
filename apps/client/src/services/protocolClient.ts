import {
  CLIENT_TIMEOUT_MS,
  ErrorCode,
  MAX_PROMPT_SIZE,
  createDecoder,
  encode,
  validateMessage,
  type ChatEndMessage,
  type ChatStartMessage,
  type ErrorMessage,
  type ProtocolMessage,
} from "@localllm/protocol";
import { BareSwarmTransport } from "./bareSwarmTransport";
import type { ProtocolEvent } from "../types/client";

interface ClientHandlers {
  onConnectionState: (
    state: "connecting" | "connected" | "disconnected" | "error",
    message?: string,
  ) => void;
  onEvent: (event: ProtocolEvent) => void;
}

export class ProtocolClient {
  private readonly transport: BareSwarmTransport;
  private readonly handlers: ClientHandlers;
  private readonly decoder;

  private activeRequestId: string | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(transport: BareSwarmTransport, handlers: ClientHandlers) {
    this.transport = transport;
    this.handlers = handlers;
    this.decoder = createDecoder((parsed) => {
      this.handleProtocolPayload(parsed);
    });

    this.transport.onEvent((event) => {
      this.handleTransportEvent(event);
    });
  }

  connect(serverId: string): void {
    this.transport.connect(serverId);
  }

  disconnect(): void {
    this.clearRequestState();
    this.transport.disconnect();
    this.handlers.onConnectionState("disconnected");
  }

  destroy(): void {
    this.clearRequestState();
    this.transport.destroy();
  }

  sendChatStart(prompt: string): { ok: true; requestId: string } | { ok: false; error: string } {
    const sanitized = prompt.trim();

    if (!sanitized) {
      return { ok: false, error: "Prompt cannot be empty" };
    }

    if (sanitized.length > MAX_PROMPT_SIZE) {
      return { ok: false, error: "Prompt exceeds 8 KB limit" };
    }

    if (this.activeRequestId) {
      return { ok: false, error: "A request is already in progress" };
    }

    const requestId = this.makeRequestId();
    const message: ChatStartMessage = {
      type: "chat_start",
      request_id: requestId,
      payload: { prompt: sanitized },
    };

    this.transport.sendLine(encode(message));
    this.activeRequestId = requestId;
    this.startTimeout(requestId);
    return { ok: true, requestId };
  }

  abort(): void {
    if (!this.activeRequestId) {
      return;
    }

    const requestId = this.activeRequestId;
    this.transport.sendLine(
      encode({
        type: "abort",
        request_id: requestId,
      }),
    );

    this.clearTimeoutGuard();
    this.activeRequestId = null;
  }

  private handleTransportEvent(event: {
    type: "connecting" | "connected" | "disconnected" | "incoming" | "network_error";
    chunk?: string;
    code?: string;
    message?: string;
  }): void {
    switch (event.type) {
      case "connecting": {
        this.handlers.onConnectionState("connecting");
        break;
      }
      case "connected": {
        this.handlers.onConnectionState("connected");
        break;
      }
      case "disconnected": {
        this.clearRequestState();
        this.handlers.onConnectionState("disconnected");
        break;
      }
      case "incoming": {
        if (event.chunk) {
          this.decoder.write(event.chunk);
        }
        break;
      }
      case "network_error": {
        this.clearRequestState();
        const details = event.code ? `${event.code}: ${event.message ?? "error"}` : event.message;
        this.handlers.onConnectionState("error", details ?? "Connection error");
        this.handlers.onEvent({
          type: "error",
          message: {
            type: "error",
            payload: {
              code: event.code ?? ErrorCode.CONNECT_FAILED,
              message: event.message ?? "Connection error",
            },
          } as ErrorMessage,
        });
        break;
      }
      default: {
        break;
      }
    }
  }

  private handleProtocolPayload(raw: unknown): void {
    const result = validateMessage(raw);

    if (!result.ok) {
      this.handlers.onEvent({ type: "bad_message", error: result.error });
      return;
    }

    this.handleProtocolMessage(result.message);
  }

  private handleProtocolMessage(message: ProtocolMessage): void {
    switch (message.type) {
      case "server_info": {
        this.handlers.onEvent({ type: "server_info", message });
        break;
      }
      case "chat_chunk": {
        if (this.activeRequestId === message.request_id) {
          this.startTimeout(message.request_id);
        }
        this.handlers.onEvent({
          type: "chat_chunk",
          requestId: message.request_id,
          text: message.payload.text,
        });
        break;
      }
      case "chat_end": {
        this.handleTerminalMessage(message);
        this.handlers.onEvent({ type: "chat_end", message: message as ChatEndMessage });
        break;
      }
      case "error": {
        this.handleTerminalMessage(message);
        this.handlers.onEvent({ type: "error", message: message as ErrorMessage });
        break;
      }
      default: {
        this.handlers.onEvent({ type: "unknown", message });
      }
    }
  }

  private handleTerminalMessage(message: ErrorMessage | ChatEndMessage): void {
    const requestId = "request_id" in message ? message.request_id : undefined;

    if (requestId && requestId === this.activeRequestId) {
      this.clearRequestState();
      return;
    }

    if (!requestId && this.activeRequestId) {
      this.clearRequestState();
    }
  }

  private startTimeout(requestId: string): void {
    this.clearTimeoutGuard();
    this.timeoutId = setTimeout(() => {
      if (this.activeRequestId !== requestId) {
        return;
      }

      this.clearRequestState();
      this.handlers.onEvent({ type: "timeout", requestId });
      this.handlers.onConnectionState(
        "error",
        `${ErrorCode.TIMEOUT_NO_RESPONSE}: No response for ${Math.floor(CLIENT_TIMEOUT_MS / 1000)} seconds`,
      );
    }, CLIENT_TIMEOUT_MS);
  }

  private clearTimeoutGuard(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private clearRequestState(): void {
    this.clearTimeoutGuard();
    this.activeRequestId = null;
  }

  private makeRequestId(): string {
    return `req-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }
}
