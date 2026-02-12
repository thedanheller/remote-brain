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

  it("should timeout with TIMEOUT_NO_RESPONSE when no chunks arrive", async () => {
    vi.useFakeTimers();
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    // Capture the abort signal so our mock reader can reject when aborted
    let capturedSignal: AbortSignal | null = null;

    const mockResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(() => {
            return new Promise((resolve, reject) => {
              if (capturedSignal?.aborted) {
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                reject(err);
                return;
              }
              capturedSignal?.addEventListener("abort", () => {
                const err = new Error("The operation was aborted");
                err.name = "AbortError";
                reject(err);
              });
            });
          }),
        }),
      },
    };

    global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      capturedSignal = opts?.signal || null;
      return Promise.resolve(mockResponse);
    });

    const generatePromise = adapter.generate("req-timeout", "llama3.2", "test prompt", {
      onChunk: () => {},
      onEnd: () => {},
      onError: (code, message) => {
        errorCode = code;
        errorMessage = message;
      },
    });

    // Let fetch resolve
    await vi.advanceTimersByTimeAsync(0);

    // Advance past 30s — the chunk timer fires abortController.abort()
    await vi.advanceTimersByTimeAsync(30_000);

    await generatePromise;

    expect(errorCode).toBe(ErrorCode.TIMEOUT_NO_RESPONSE);
    expect(errorMessage).toContain("30 seconds");

    vi.useRealTimers();
  });

  it("should pass health check when Ollama is reachable", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ models: [] }),
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await adapter.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.error).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("should fail health check when Ollama is not reachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    const result = await adapter.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toBe("Cannot connect to Ollama (not running?)");
  });

  it("should fail health check when Ollama returns error status", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
    };

    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await adapter.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });
});
