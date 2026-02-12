import { describe, it, expect } from "vitest";
import {
  isValidEnvelope,
  isServerInfo,
  isChatStart,
  isChatChunk,
  isChatEnd,
  isAbort,
  isError,
  validateMessage,
} from "../src/validate.js";

describe("isValidEnvelope", () => {
  it("accepts a valid envelope", () => {
    expect(isValidEnvelope({ type: "server_info" })).toBe(true);
  });

  it("accepts envelope with request_id", () => {
    expect(isValidEnvelope({ type: "chat_start", request_id: "r1" })).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidEnvelope(null)).toBe(false);
  });

  it("rejects missing type", () => {
    expect(isValidEnvelope({ payload: {} })).toBe(false);
  });

  it("rejects unknown type", () => {
    expect(isValidEnvelope({ type: "unknown" })).toBe(false);
  });

  it("rejects non-string request_id", () => {
    expect(isValidEnvelope({ type: "abort", request_id: 123 })).toBe(false);
  });
});

describe("isServerInfo", () => {
  const valid = {
    type: "server_info",
    payload: { host_name: "Dan's Mac", model: "llama3.2", status: "ready" },
  };

  it("accepts valid server_info", () => {
    expect(isServerInfo(valid)).toBe(true);
  });

  it("rejects missing model", () => {
    expect(
      isServerInfo({
        type: "server_info",
        payload: { host_name: "Mac", status: "ready" },
      }),
    ).toBe(false);
  });

  it("rejects invalid status", () => {
    expect(
      isServerInfo({
        type: "server_info",
        payload: { host_name: "Mac", model: "x", status: "unknown" },
      }),
    ).toBe(false);
  });
});

describe("isChatStart", () => {
  it("accepts valid chat_start", () => {
    expect(
      isChatStart({
        type: "chat_start",
        request_id: "r1",
        payload: { prompt: "Hello" },
      }),
    ).toBe(true);
  });

  it("rejects missing request_id", () => {
    expect(
      isChatStart({ type: "chat_start", payload: { prompt: "Hello" } }),
    ).toBe(false);
  });

  it("rejects missing prompt", () => {
    expect(
      isChatStart({ type: "chat_start", request_id: "r1", payload: {} }),
    ).toBe(false);
  });
});

describe("isChatChunk", () => {
  it("accepts valid chat_chunk", () => {
    expect(
      isChatChunk({
        type: "chat_chunk",
        request_id: "r1",
        payload: { text: "token" },
      }),
    ).toBe(true);
  });

  it("rejects missing text", () => {
    expect(
      isChatChunk({ type: "chat_chunk", request_id: "r1", payload: {} }),
    ).toBe(false);
  });
});

describe("isChatEnd", () => {
  it("accepts valid chat_end", () => {
    expect(
      isChatEnd({
        type: "chat_end",
        request_id: "r1",
        payload: { finish_reason: "stop" },
      }),
    ).toBe(true);
  });

  it("accepts abort finish_reason", () => {
    expect(
      isChatEnd({
        type: "chat_end",
        request_id: "r1",
        payload: { finish_reason: "abort" },
      }),
    ).toBe(true);
  });

  it("rejects invalid finish_reason", () => {
    expect(
      isChatEnd({
        type: "chat_end",
        request_id: "r1",
        payload: { finish_reason: "timeout" },
      }),
    ).toBe(false);
  });
});

describe("isAbort", () => {
  it("accepts valid abort", () => {
    expect(isAbort({ type: "abort", request_id: "r1" })).toBe(true);
  });

  it("rejects missing request_id", () => {
    expect(isAbort({ type: "abort" })).toBe(false);
  });
});

describe("isError", () => {
  it("accepts valid error", () => {
    expect(
      isError({
        type: "error",
        payload: { code: "MODEL_BUSY", message: "Busy" },
      }),
    ).toBe(true);
  });

  it("rejects missing code", () => {
    expect(isError({ type: "error", payload: { message: "Busy" } })).toBe(false);
  });
});

describe("validateMessage", () => {
  it("returns ok for valid server_info", () => {
    const result = validateMessage({
      type: "server_info",
      payload: { host_name: "Mac", model: "llama3.2", status: "ready" },
    });
    expect(result.ok).toBe(true);
  });

  it("returns error for invalid envelope", () => {
    const result = validateMessage({ foo: "bar" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("envelope");
  });

  it("rejects prompt exceeding MAX_PROMPT_SIZE", () => {
    const result = validateMessage({
      type: "chat_start",
      request_id: "r1",
      payload: { prompt: "x".repeat(8193) },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Prompt exceeds");
  });

  it("accepts prompt within MAX_PROMPT_SIZE", () => {
    const result = validateMessage({
      type: "chat_start",
      request_id: "r1",
      payload: { prompt: "x".repeat(8192) },
    });
    expect(result.ok).toBe(true);
  });
});
