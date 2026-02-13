import { Worklet } from "react-native-bare-kit";
import bs58 from "bs58";
import { SWARM_WORKLET_SOURCE } from "../worklet/swarmWorkletSource";
import type { BridgeCommand, WorkletEvent, WorkletEventHandler } from "../types/bridge";

interface WorkletIpc {
  on: (event: "data", handler: (chunk: Uint8Array) => void) => void;
  write: (chunk: Uint8Array) => void;
}

function isWorkletEvent(value: unknown): value is WorkletEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const event = value as Record<string, unknown>;
  if (typeof event.type !== "string") {
    return false;
  }

  switch (event.type) {
    case "onServerInfo":
      return (
        typeof event.hostName === "string" &&
        typeof event.model === "string" &&
        (event.status === "ready" || event.status === "busy")
      );
    case "onChunk":
      return typeof event.requestId === "string" && typeof event.text === "string";
    case "onChatEnd":
      return (
        typeof event.requestId === "string" &&
        (event.finishReason === "stop" || event.finishReason === "abort" || event.finishReason === "error")
      );
    case "onError":
      return (
        typeof event.code === "string" &&
        typeof event.message === "string" &&
        (event.requestId === undefined || typeof event.requestId === "string")
      );
    case "onDisconnect":
      return typeof event.code === "string" && typeof event.message === "string";
    case "onRawMessage":
      return (
        (event.direction === "in" || event.direction === "out") && typeof event.text === "string"
      );
    default:
      return false;
  }
}

export class WorkletBridge {
  private readonly worklet: Worklet;
  private readonly ipc: WorkletIpc;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private handler: WorkletEventHandler | null = null;
  private started = false;

  constructor() {
    this.worklet = new Worklet();
    this.ipc = this.worklet.IPC as unknown as WorkletIpc;

    this.ipc.on("data", (chunk: Uint8Array) => {
      if (!this.handler) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(this.decoder.decode(chunk));
      } catch {
        this.handler({
          type: "onError",
          code: "BAD_MESSAGE",
          message: "Malformed worklet event",
        });
        return;
      }

      if (!isWorkletEvent(parsed)) {
        this.handler({
          type: "onError",
          code: "BAD_MESSAGE",
          message: "Unsupported worklet event",
        });
        return;
      }

      this.handler(parsed);
    });
  }

  onEvent(handler: WorkletEventHandler): void {
    this.handler = handler;
  }

  connect(serverId: string): void {
    this.ensureStarted();
    const candidate = serverId.trim();

    let topic: Uint8Array;
    try {
      topic = bs58.decode(candidate);
    } catch {
      this.handler?.({
        type: "onError",
        code: "INVALID_SERVER_ID",
        message: "Could not decode Server ID",
      });
      return;
    }

    if (topic.length !== 32) {
      this.handler?.({
        type: "onError",
        code: "INVALID_SERVER_ID",
        message: "Server ID must decode to 32 bytes",
      });
      return;
    }

    this.send({ type: "connect", topic: Array.from(topic) });
  }

  disconnect(): void {
    if (!this.started) {
      return;
    }
    this.send({ type: "disconnect" });
  }

  sendPrompt(prompt: string): void {
    this.ensureStarted();
    this.send({ type: "sendPrompt", prompt });
  }

  abort(): void {
    if (!this.started) {
      return;
    }
    this.send({ type: "abort" });
  }

  destroy(): void {
    this.handler = null;
    this.worklet.terminate();
  }

  private ensureStarted(): void {
    if (this.started) {
      return;
    }

    this.worklet.start("/swarm-client.js", SWARM_WORKLET_SOURCE);
    this.started = true;
  }

  private send(command: BridgeCommand): void {
    const payload = JSON.stringify(command);
    this.ipc.write(this.encoder.encode(payload));
  }
}
