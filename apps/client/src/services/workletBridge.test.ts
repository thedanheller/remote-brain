import bs58 from "bs58";
import type { WorkletEvent } from "../types/bridge";

const mockStart = jest.fn();
const mockTerminate = jest.fn();
const mockWrite = jest.fn();
const mockOn = jest.fn();

let dataHandler: ((chunk: Uint8Array) => void) | null = null;

jest.mock("react-native-bare-kit", () => {
  return {
    Worklet: jest.fn().mockImplementation(() => ({
      IPC: {
        on: mockOn.mockImplementation((event: "data", handler: (chunk: Uint8Array) => void) => {
          if (event === "data") {
            dataHandler = handler;
          }
        }),
        write: mockWrite,
      },
      start: mockStart,
      terminate: mockTerminate,
    })),
  };
});

import { WorkletBridge } from "./workletBridge";

function decodeCommandPayload(raw: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(raw));
}

function emitWorkletEvent(event: WorkletEvent): void {
  if (!dataHandler) {
    throw new Error("worklet data handler not registered");
  }
  dataHandler(new TextEncoder().encode(JSON.stringify(event)));
}

describe("WorkletBridge", () => {
  beforeEach(() => {
    dataHandler = null;
    jest.clearAllMocks();
  });

  test("connect calls worklet with decoded topic", () => {
    const bridge = new WorkletBridge();
    const serverId = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

    bridge.connect(serverId);

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const command = decodeCommandPayload(mockWrite.mock.calls[0][0] as Uint8Array);
    expect(command).toEqual({
      type: "connect",
      topic: Array.from(bs58.decode(serverId)),
    });
  });

  test("disconnect sends disconnect command for worklet-side cleanup", () => {
    const bridge = new WorkletBridge();
    const serverId = bs58.encode(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

    bridge.connect(serverId);

    bridge.disconnect();

    expect(mockWrite).toHaveBeenCalledTimes(2);
    const command = decodeCommandPayload(mockWrite.mock.calls[1][0] as Uint8Array);
    expect(command).toEqual({ type: "disconnect" });
  });

  test("forwards onChunk, onChatEnd and onError events to listener", () => {
    const bridge = new WorkletBridge();
    const handler = jest.fn();

    bridge.onEvent(handler);

    emitWorkletEvent({ type: "onChunk", requestId: "req-1", text: "hello" });
    emitWorkletEvent({ type: "onChatEnd", requestId: "req-1", finishReason: "stop" });
    emitWorkletEvent({ type: "onError", code: "TIMEOUT_NO_RESPONSE", message: "No response", requestId: "req-1" });

    expect(handler).toHaveBeenNthCalledWith(1, { type: "onChunk", requestId: "req-1", text: "hello" });
    expect(handler).toHaveBeenNthCalledWith(2, {
      type: "onChatEnd",
      requestId: "req-1",
      finishReason: "stop",
    });
    expect(handler).toHaveBeenNthCalledWith(3, {
      type: "onError",
      code: "TIMEOUT_NO_RESPONSE",
      message: "No response",
      requestId: "req-1",
    });
  });
});
