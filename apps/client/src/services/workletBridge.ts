import { Worklet } from "react-native-bare-kit";
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

  constructor() {
    this.worklet = new Worklet();
    this.ipc = this.worklet.IPC as unknown as WorkletIpc;
    this.worklet.start("/swarm-client.js", SWARM_WORKLET_SOURCE);

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
    this.send({ type: "connect", serverId });
  }

  disconnect(): void {
    this.send({ type: "disconnect" });
  }

  sendPrompt(prompt: string): void {
    this.send({ type: "sendPrompt", prompt });
  }

  abort(): void {
    this.send({ type: "abort" });
  }

  destroy(): void {
    this.handler = null;
    this.worklet.terminate();
  }

  private send(command: BridgeCommand): void {
    const payload = JSON.stringify(command);
    this.ipc.write(this.encoder.encode(payload));
  }
}
