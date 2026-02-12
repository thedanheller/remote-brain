import type {
  ChatEndMessage,
  ErrorMessage,
  ProtocolMessage,
  ServerInfoMessage,
} from "@localllm/protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ConnectionStatus {
  state: ConnectionState;
  message?: string;
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export type ProtocolEvent =
  | { type: "server_info"; message: ServerInfoMessage }
  | { type: "chat_chunk"; requestId: string; text: string }
  | { type: "chat_end"; message: ChatEndMessage }
  | { type: "error"; message: ErrorMessage }
  | { type: "bad_message"; error: string }
  | { type: "timeout"; requestId: string }
  | { type: "unknown"; message: ProtocolMessage };

export interface ProtocolSendResult {
  ok: true;
  requestId: string;
}
