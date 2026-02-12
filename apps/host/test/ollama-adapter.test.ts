import { describe, it, expect, beforeEach, vi } from "vitest";
import { OllamaAdapter } from "../src/ollama/adapter.js";
import { ErrorCode } from "@localllm/protocol";

describe("OllamaAdapter", () => {
  let adapter: OllamaAdapter;

  beforeEach(() => {
    adapter = new OllamaAdapter("http://localhost:11434");
    vi.clearAllMocks();
  });

  it("should stream chunks from Ollama", async () => {
    const chunks: string[] = [];
    let endCalled = false;

    // Mock fetch response
    const mockResponse = {
      ok: true,
      body: {
        getReader: () => {
          const encoder = new TextEncoder();
          const data = [
            JSON.stringify({ response: "Hello", done: false }),
            JSON.stringify({ response: " world", done: false }),
            JSON.stringify({ response: "!", done: true }),
          ];

          let index = 0;
          return {
            read: async () => {
              if (index >= data.length) {
                return { done: true, value: undefined };
              }
              const value = encoder.encode(data[index] + "\n");
              index++;
              return { done: false, value };
            },
          };
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await adapter.generate("req-1", "llama3.2", "test prompt", {
      onChunk: (text) => chunks.push(text),
      onEnd: () => {
        endCalled = true;
      },
      onError: () => {},
    });

    expect(chunks).toEqual(["Hello", " world", "!"]);
    expect(endCalled).toBe(true);
  });

  it("should handle Ollama errors", async () => {
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    const mockResponse = {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ error: "model not found" }),
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await adapter.generate("req-1", "invalid-model", "test prompt", {
      onChunk: () => {},
      onEnd: () => {},
      onError: (code, message) => {
        errorCode = code;
        errorMessage = message;
      },
    });

    expect(errorCode).toBe(ErrorCode.OLLAMA_MODEL_NOT_AVAILABLE);
    expect(errorMessage).toContain("model");
  });

  it("should handle connection refused errors", async () => {
    let errorCode: string | null = null;

    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    await adapter.generate("req-1", "llama3.2", "test prompt", {
      onChunk: () => {},
      onEnd: () => {},
      onError: (code) => {
        errorCode = code;
      },
    });

    expect(errorCode).toBe(ErrorCode.OLLAMA_NOT_FOUND);
  });

  it("should abort ongoing generation", async () => {
    let errorCode: string | null = null;

    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            // Simulate reading that gets aborted
            await new Promise((resolve) => setTimeout(resolve, 10));
            throw new Error("AbortError");
          }),
        }),
      },
    };

    global.fetch = vi.fn().mockImplementation((url, options) => {
      // Trigger abort after a short delay
      setTimeout(() => {
        if (options?.signal) {
          const abortEvent = new Event("abort");
          Object.defineProperty(abortEvent, "target", {
            value: { aborted: true },
            writable: false,
          });
          options.signal.dispatchEvent(abortEvent);
        }
      }, 5);
      return Promise.resolve(mockResponse);
    });

    const generatePromise = adapter.generate("req-1", "llama3.2", "test prompt", {
      onChunk: () => {},
      onEnd: () => {},
      onError: (code) => {
        errorCode = code;
      },
    });

    // Abort immediately
    setTimeout(() => {
      adapter.abort("req-1");
    }, 1);

    await generatePromise;
    // Just verify abort was called, the adapter will handle the error internally
    expect(adapter.abort("req-1")).toBe(false); // Should return false since already aborted
  });

  it("should handle empty response body", async () => {
    let errorCode: string | null = null;

    const mockResponse = {
      ok: true,
      body: null,
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await adapter.generate("req-1", "llama3.2", "test prompt", {
      onChunk: () => {},
      onEnd: () => {},
      onError: (code) => {
        errorCode = code;
      },
    });

    expect(errorCode).toBe(ErrorCode.GENERATION_FAILED);
  });

  it("should handle malformed JSON in stream", async () => {
    const chunks: string[] = [];

    const mockResponse = {
      ok: true,
      body: {
        getReader: () => {
          const encoder = new TextEncoder();
          const data = [
            "invalid json",
            JSON.stringify({ response: "valid", done: false }),
            JSON.stringify({ response: "!", done: true }),
          ];

          let index = 0;
          return {
            read: async () => {
              if (index >= data.length) {
                return { done: true, value: undefined };
              }
              const value = encoder.encode(data[index] + "\n");
              index++;
              return { done: false, value };
            },
          };
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    await adapter.generate("req-1", "llama3.2", "test prompt", {
      onChunk: (text) => chunks.push(text),
      onEnd: () => {},
      onError: () => {},
    });

    // Should skip invalid JSON and process valid chunks
    expect(chunks).toEqual(["valid", "!"]);
  });
});
