import { describe, it, expect } from "vitest";
import { encode, createDecoder } from "../src/ndjson.js";
import { validateMessage } from "../src/validate.js";
import { createErrorMessage, ErrorCode } from "../src/errors.js";
import { generateRequestId } from "../src/helpers.js";
import type {
  ServerInfoMessage,
  ChatStartMessage,
  ChatChunkMessage,
  ChatEndMessage,
  ErrorMessage,
  ProtocolMessage,
} from "../src/types.js";

function simulate(rawMessages: unknown[]): ProtocolMessage[] {
  const wire = rawMessages.map(encode).join("");
  const results: ProtocolMessage[] = [];

  const decoder = createDecoder((parsed) => {
    const result = validateMessage(parsed);
    if (result.ok) {
      results.push(result.message);
    }
  });

  decoder.write(wire);
  return results;
}

describe("lifecycle", () => {
  it("simulates full chat: start → chunks → end", () => {
    const requestId = generateRequestId();

    const serverInfo: ServerInfoMessage = {
      type: "server_info",
      payload: { host_name: "Test Host", model: "llama3.2", status: "ready" },
    };

    const chatStart: ChatStartMessage = {
      type: "chat_start",
      request_id: requestId,
      payload: { prompt: "Hello" },
    };

    const chunks: ChatChunkMessage[] = [
      { type: "chat_chunk", request_id: requestId, payload: { text: "Hi " } },
      { type: "chat_chunk", request_id: requestId, payload: { text: "there!" } },
    ];

    const chatEnd: ChatEndMessage = {
      type: "chat_end",
      request_id: requestId,
      payload: { finish_reason: "stop" },
    };

    const messages = simulate([serverInfo, chatStart, ...chunks, chatEnd]);

    expect(messages).toHaveLength(5);
    expect(messages[0].type).toBe("server_info");
    expect(messages[1].type).toBe("chat_start");
    expect(messages[2].type).toBe("chat_chunk");
    expect(messages[3].type).toBe("chat_chunk");
    expect(messages[4].type).toBe("chat_end");
    expect((messages[4] as ChatEndMessage).payload.finish_reason).toBe("stop");
  });

  it("simulates abort mid-stream", () => {
    const requestId = generateRequestId();

    const messages = simulate([
      {
        type: "chat_start",
        request_id: requestId,
        payload: { prompt: "Tell me a story" },
      },
      {
        type: "chat_chunk",
        request_id: requestId,
        payload: { text: "Once upon " },
      },
      { type: "abort", request_id: requestId },
      {
        type: "chat_end",
        request_id: requestId,
        payload: { finish_reason: "abort" },
      },
    ]);

    expect(messages).toHaveLength(4);
    expect(messages[2].type).toBe("abort");
    expect((messages[3] as ChatEndMessage).payload.finish_reason).toBe("abort");
  });

  it("simulates MODEL_BUSY rejection", () => {
    const requestId = generateRequestId();

    const errorMsg = createErrorMessage(
      ErrorCode.MODEL_BUSY,
      "Host is processing another request",
      requestId,
    );

    const messages = simulate([
      {
        type: "chat_start",
        request_id: requestId,
        payload: { prompt: "Hello" },
      },
      errorMsg,
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[1].type).toBe("error");
    expect((messages[1] as ErrorMessage).payload.code).toBe("MODEL_BUSY");
    expect((messages[1] as ErrorMessage).request_id).toBe(requestId);
  });
});
