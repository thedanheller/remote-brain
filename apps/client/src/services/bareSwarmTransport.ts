import { Worklet } from "react-native-bare-kit";
import { SWARM_WORKLET_SOURCE } from "../worklet/swarmWorkletSource";

type WorkletCommand =
  | { type: "connect"; serverId: string }
  | { type: "disconnect" }
  | { type: "send"; data: string };

type WorkletEvent =
  | { type: "connecting" }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "incoming"; chunk: string }
  | { type: "network_error"; code: string; message: string };

export type TransportEventHandler = (event: WorkletEvent) => void;

export class BareSwarmTransport {
  private readonly worklet: Worklet;
  private readonly ipc: {
    on: (event: "data", handler: (chunk: Uint8Array) => void) => void;
    write: (chunk: Uint8Array) => void;
  };
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private handler: TransportEventHandler | null = null;

  constructor() {
    this.worklet = new Worklet();
    this.ipc = this.worklet.IPC as unknown as {
      on: (event: "data", handler: (chunk: Uint8Array) => void) => void;
      write: (chunk: Uint8Array) => void;
    };
    this.worklet.start("/swarm-client.js", SWARM_WORKLET_SOURCE);

    this.ipc.on("data", (chunk: Uint8Array) => {
      this.handleIncomingEvent(chunk);
    });
  }

  onEvent(handler: TransportEventHandler): void {
    this.handler = handler;
  }

  connect(serverId: string): void {
    this.sendCommand({ type: "connect", serverId });
  }

  disconnect(): void {
    this.sendCommand({ type: "disconnect" });
  }

  sendLine(data: string): void {
    this.sendCommand({ type: "send", data });
  }

  destroy(): void {
    this.handler = null;
    this.worklet.terminate();
  }

  private sendCommand(command: WorkletCommand): void {
    const raw = JSON.stringify(command);
    this.ipc.write(this.encoder.encode(raw));
  }

  private handleIncomingEvent(chunk: Uint8Array): void {
    if (!this.handler) {
      return;
    }

    let parsed: WorkletEvent;
    try {
      parsed = JSON.parse(this.decoder.decode(chunk)) as WorkletEvent;
    } catch {
      this.handler({
        type: "network_error",
        code: "BAD_MESSAGE",
        message: "Malformed worklet event",
      });
      return;
    }

    this.handler(parsed);
  }
}
