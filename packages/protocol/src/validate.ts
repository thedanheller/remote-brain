import type {
  ProtocolMessage,
  ServerInfoMessage,
  ChatStartMessage,
  ChatChunkMessage,
  ChatEndMessage,
  AbortMessage,
  ErrorMessage,
} from "./types.js";
import { MAX_PROMPT_SIZE } from "./helpers.js";

const VALID_TYPES = new Set([
  "server_info",
  "chat_start",
  "chat_chunk",
  "chat_end",
  "abort",
  "error",
]);

type Obj = Record<string, unknown>;

function asObj(val: unknown): Obj | null {
  return typeof val === "object" && val !== null ? (val as Obj) : null;
}

export function isValidEnvelope(
  msg: unknown,
): msg is Obj & { type: string; request_id?: string; payload?: unknown } {
  const obj = asObj(msg);
  if (!obj) return false;
  if (typeof obj.type !== "string") return false;
  if (!VALID_TYPES.has(obj.type)) return false;
  if (obj.request_id !== undefined && typeof obj.request_id !== "string")
    return false;
  return true;
}

export function isServerInfo(msg: unknown): msg is ServerInfoMessage {
  if (!isValidEnvelope(msg)) return false;
  if (msg.type !== "server_info") return false;
  const payload = asObj(msg.payload);
  if (!payload) return false;
  return (
    typeof payload.host_name === "string" &&
    typeof payload.model === "string" &&
    (payload.status === "ready" || payload.status === "busy")
  );
}

export function isChatStart(msg: unknown): msg is ChatStartMessage {
  if (!isValidEnvelope(msg)) return false;
  if (msg.type !== "chat_start") return false;
  if (typeof msg.request_id !== "string") return false;
  const payload = asObj(msg.payload);
  if (!payload) return false;
  return typeof payload.prompt === "string";
}

export function isChatChunk(msg: unknown): msg is ChatChunkMessage {
  if (!isValidEnvelope(msg)) return false;
  if (msg.type !== "chat_chunk") return false;
  if (typeof msg.request_id !== "string") return false;
  const payload = asObj(msg.payload);
  if (!payload) return false;
  return typeof payload.text === "string";
}

export function isChatEnd(msg: unknown): msg is ChatEndMessage {
  if (!isValidEnvelope(msg)) return false;
  if (msg.type !== "chat_end") return false;
  if (typeof msg.request_id !== "string") return false;
  const payload = asObj(msg.payload);
  if (!payload) return false;
  return (
    payload.finish_reason === "stop" ||
    payload.finish_reason === "abort" ||
    payload.finish_reason === "error"
  );
}

export function isAbort(msg: unknown): msg is AbortMessage {
  if (!isValidEnvelope(msg)) return false;
  if (msg.type !== "abort") return false;
  if (typeof msg.request_id !== "string") return false;
  return true;
}

export function isError(msg: unknown): msg is ErrorMessage {
  if (!isValidEnvelope(msg)) return false;
  if (msg.type !== "error") return false;
  const payload = asObj(msg.payload);
  if (!payload) return false;
  return typeof payload.code === "string" && typeof payload.message === "string";
}

export type ValidateResult =
  | { ok: true; message: ProtocolMessage }
  | { ok: false; error: string };

export function validateMessage(raw: unknown): ValidateResult {
  if (!isValidEnvelope(raw)) {
    return { ok: false, error: "Invalid message envelope" };
  }

  // Check prompt size for chat_start
  if (raw.type === "chat_start") {
    const payload = asObj(raw.payload);
    if (
      payload &&
      typeof payload.prompt === "string" &&
      payload.prompt.length > MAX_PROMPT_SIZE
    ) {
      return { ok: false, error: "Prompt exceeds maximum size" };
    }
  }

  switch (raw.type) {
    case "server_info":
      if (isServerInfo(raw)) return { ok: true, message: raw };
      return { ok: false, error: "Invalid server_info message" };
    case "chat_start":
      if (isChatStart(raw)) return { ok: true, message: raw };
      return { ok: false, error: "Invalid chat_start message" };
    case "chat_chunk":
      if (isChatChunk(raw)) return { ok: true, message: raw };
      return { ok: false, error: "Invalid chat_chunk message" };
    case "chat_end":
      if (isChatEnd(raw)) return { ok: true, message: raw };
      return { ok: false, error: "Invalid chat_end message" };
    case "abort":
      if (isAbort(raw)) return { ok: true, message: raw };
      return { ok: false, error: "Invalid abort message" };
    case "error":
      if (isError(raw)) return { ok: true, message: raw };
      return { ok: false, error: "Invalid error message" };
    default:
      return { ok: false, error: `Unknown message type: ${raw.type}` };
  }
}
