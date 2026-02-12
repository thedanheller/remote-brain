import type { ErrorMessage } from "./types.js";

export const ErrorCode = {
  // Connection
  INVALID_SERVER_ID: "INVALID_SERVER_ID",
  CONNECT_FAILED: "CONNECT_FAILED",
  HOST_OFFLINE: "HOST_OFFLINE",
  HOST_DISCONNECTED: "HOST_DISCONNECTED",
  USER_DISCONNECTED: "USER_DISCONNECTED",

  // Host / Ollama
  OLLAMA_NOT_FOUND: "OLLAMA_NOT_FOUND",
  OLLAMA_MODEL_NOT_AVAILABLE: "OLLAMA_MODEL_NOT_AVAILABLE",
  MODEL_BUSY: "MODEL_BUSY",
  GENERATION_FAILED: "GENERATION_FAILED",
  GENERATION_ABORTED: "GENERATION_ABORTED",

  // Protocol
  BAD_MESSAGE: "BAD_MESSAGE",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  TIMEOUT_NO_RESPONSE: "TIMEOUT_NO_RESPONSE",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function createErrorMessage(
  code: ErrorCodeValue,
  message: string,
  requestId?: string,
): ErrorMessage {
  return {
    type: "error",
    ...(requestId !== undefined && { request_id: requestId }),
    payload: { code, message },
  };
}
