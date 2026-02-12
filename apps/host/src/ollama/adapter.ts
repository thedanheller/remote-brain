import { ErrorCode, type ErrorCodeValue } from "@localllm/protocol";

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
}

export interface OllamaChunk {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaError {
  error: string;
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (code: ErrorCodeValue, message: string) => void;
}

/**
 * Adapter for streaming inference from local Ollama API.
 */
export class OllamaAdapter {
  private baseUrl: string;
  private abortControllers = new Map<string, AbortController>();

  constructor(baseUrl = "http://localhost:11434") {
    this.baseUrl = baseUrl;
  }

  /**
   * Start a streaming generation request.
   */
  async generate(
    requestId: string,
    model: string,
    prompt: string,
    callbacks: StreamCallbacks,
  ): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(requestId, abortController);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          stream: true,
        } satisfies OllamaGenerateRequest),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: OllamaError;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}` };
        }

        const { code, message } = this.mapOllamaError(response.status, errorData.error);
        callbacks.onError(code, message);
        return;
      }

      if (!response.body) {
        callbacks.onError(ErrorCode.GENERATION_FAILED, "No response body from Ollama");
        return;
      }

      // Process NDJSON stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.length === 0) continue;

          try {
            const chunk: OllamaChunk = JSON.parse(line);

            if (chunk.response) {
              callbacks.onChunk(chunk.response);
            }

            if (chunk.done) {
              callbacks.onEnd();
              this.abortControllers.delete(requestId);
              return;
            }
          } catch (error) {
            console.error("Failed to parse Ollama chunk:", error);
          }
        }
      }

      callbacks.onEnd();
      this.abortControllers.delete(requestId);
    } catch (error) {
      this.abortControllers.delete(requestId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          callbacks.onError(ErrorCode.GENERATION_ABORTED, "Generation was aborted");
          return;
        }

        if (error.message.includes("ECONNREFUSED")) {
          callbacks.onError(ErrorCode.OLLAMA_NOT_FOUND, "Cannot connect to Ollama (not running?)");
          return;
        }

        callbacks.onError(ErrorCode.GENERATION_FAILED, error.message);
      } else {
        callbacks.onError(ErrorCode.GENERATION_FAILED, "Unknown error during generation");
      }
    }
  }

  /**
   * Abort an ongoing generation.
   */
  abort(requestId: string): boolean {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
      return true;
    }
    return false;
  }

  /**
   * Map Ollama HTTP errors to protocol error codes.
   */
  private mapOllamaError(
    status: number,
    errorMessage: string,
  ): { code: ErrorCodeValue; message: string } {
    const lowerError = errorMessage.toLowerCase();

    // Model not found
    if (lowerError.includes("model") && (lowerError.includes("not found") || lowerError.includes("not available"))) {
      return {
        code: ErrorCode.OLLAMA_MODEL_NOT_AVAILABLE,
        message: `Model not available: ${errorMessage}`,
      };
    }

    // Server errors
    if (status >= 500) {
      return {
        code: ErrorCode.GENERATION_FAILED,
        message: `Ollama server error: ${errorMessage}`,
      };
    }

    // Client errors
    if (status >= 400) {
      return {
        code: ErrorCode.GENERATION_FAILED,
        message: `Invalid request: ${errorMessage}`,
      };
    }

    // Generic error
    return {
      code: ErrorCode.GENERATION_FAILED,
      message: errorMessage,
    };
  }
}
