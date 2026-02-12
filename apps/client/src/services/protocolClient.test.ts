import { ProtocolClient } from "./protocolClient";
import type { BareSwarmTransport } from "./bareSwarmTransport";

type TransportEvent = {
  type: "connecting" | "connected" | "disconnected" | "incoming" | "network_error";
  chunk?: string;
  code?: string;
  message?: string;
};

function createTransportMock() {
  let handler: ((event: TransportEvent) => void) | null = null;

  return {
    connect: jest.fn(),
    destroy: jest.fn(),
    disconnect: jest.fn(),
    onEvent: jest.fn((next: (event: TransportEvent) => void) => {
      handler = next;
    }),
    sendLine: jest.fn(),
    emit(event: TransportEvent) {
      if (handler) {
        handler(event);
      }
    },
  };
}

describe("ProtocolClient", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("sendChatStart encodes NDJSON with request_id", () => {
    jest.spyOn(Date, "now").mockReturnValue(1700000000000);
    jest.spyOn(Math, "random").mockReturnValue(0.12345);

    const transport = createTransportMock();
    const handlers = {
      onConnectionState: jest.fn(),
      onEvent: jest.fn(),
    };
    const client = new ProtocolClient(transport as unknown as BareSwarmTransport, handlers);

    const result = client.sendChatStart("  hello world  ");

    expect(result).toEqual({ ok: true, requestId: "req-1700000000000-12345" });
    expect(transport.sendLine).toHaveBeenCalledTimes(1);

    const line = transport.sendLine.mock.calls[0][0] as string;
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: "chat_start",
      request_id: "req-1700000000000-12345",
      payload: { prompt: "hello world" },
    });
  });

  test("incoming chat_chunk resets 30s timeout guard", () => {
    const transport = createTransportMock();
    const handlers = {
      onConnectionState: jest.fn(),
      onEvent: jest.fn(),
    };
    const client = new ProtocolClient(transport as unknown as BareSwarmTransport, handlers);

    const start = client.sendChatStart("prompt");
    if (!start.ok) {
      throw new Error("expected chat_start to succeed");
    }

    jest.advanceTimersByTime(20_000);
    transport.emit({
      type: "incoming",
      chunk: `${JSON.stringify({
        type: "chat_chunk",
        request_id: start.requestId,
        payload: { text: "hi" },
      })}\n`,
    });

    jest.advanceTimersByTime(20_000);
    expect(handlers.onConnectionState).not.toHaveBeenCalledWith(
      "error",
      "TIMEOUT_NO_RESPONSE: No response for 30 seconds",
    );

    jest.advanceTimersByTime(10_001);
    expect(handlers.onEvent).toHaveBeenCalledWith({ type: "timeout", requestId: start.requestId });
    expect(handlers.onConnectionState).toHaveBeenCalledWith(
      "error",
      "TIMEOUT_NO_RESPONSE: No response for 30 seconds",
    );
  });

  test("timeout emits TIMEOUT_NO_RESPONSE when no chunk arrives in 30s", () => {
    const transport = createTransportMock();
    const handlers = {
      onConnectionState: jest.fn(),
      onEvent: jest.fn(),
    };
    const client = new ProtocolClient(transport as unknown as BareSwarmTransport, handlers);

    const start = client.sendChatStart("prompt");
    if (!start.ok) {
      throw new Error("expected chat_start to succeed");
    }

    jest.advanceTimersByTime(30_001);

    expect(handlers.onEvent).toHaveBeenCalledWith({ type: "timeout", requestId: start.requestId });
    expect(handlers.onConnectionState).toHaveBeenCalledWith(
      "error",
      "TIMEOUT_NO_RESPONSE: No response for 30 seconds",
    );
  });

  test("abort sends abort message and clears active request", () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);
    const randomSpy = jest.spyOn(Math, "random");
    randomSpy.mockReturnValueOnce(0.5).mockReturnValueOnce(0.6);

    const transport = createTransportMock();
    const handlers = {
      onConnectionState: jest.fn(),
      onEvent: jest.fn(),
    };
    const client = new ProtocolClient(transport as unknown as BareSwarmTransport, handlers);

    const first = client.sendChatStart("first");
    if (!first.ok) {
      throw new Error("expected first chat_start to succeed");
    }

    client.abort();

    expect(transport.sendLine).toHaveBeenCalledTimes(2);
    expect(JSON.parse(transport.sendLine.mock.calls[1][0] as string)).toEqual({
      type: "abort",
      request_id: first.requestId,
    });

    const second = client.sendChatStart("second");
    expect(second.ok).toBe(true);
  });

  test("emits server_info event for a valid server_info message", () => {
    const transport = createTransportMock();
    const handlers = {
      onConnectionState: jest.fn(),
      onEvent: jest.fn(),
    };
    new ProtocolClient(transport as unknown as BareSwarmTransport, handlers);

    transport.emit({
      type: "incoming",
      chunk: `${JSON.stringify({
        type: "server_info",
        payload: {
          host_name: "Host A",
          model: "llama3.2",
          status: "ready",
        },
      })}\n`,
    });

    expect(handlers.onEvent).toHaveBeenCalledWith({
      type: "server_info",
      message: {
        type: "server_info",
        payload: {
          host_name: "Host A",
          model: "llama3.2",
          status: "ready",
        },
      },
    });
  });
});
