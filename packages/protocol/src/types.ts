export type MessageType =
  | "server_info"
  | "chat_start"
  | "chat_chunk"
  | "chat_end"
  | "abort"
  | "error";

export interface MessageEnvelope {
  type: MessageType;
  request_id?: string;
  payload?: unknown;
}

// --- Payloads ---

export interface ServerInfoPayload {
  host_name: string;
  model: string;
  status: "ready" | "busy";
}

export interface ChatStartPayload {
  prompt: string;
}

export interface ChatChunkPayload {
  text: string;
}

export interface ChatEndPayload {
  finish_reason: "stop" | "abort" | "error";
}

export interface AbortPayload {}

export interface ErrorPayload {
  code: string;
  message: string;
}

// --- Typed messages ---

export interface ServerInfoMessage {
  type: "server_info";
  payload: ServerInfoPayload;
}

export interface ChatStartMessage {
  type: "chat_start";
  request_id: string;
  payload: ChatStartPayload;
}

export interface ChatChunkMessage {
  type: "chat_chunk";
  request_id: string;
  payload: ChatChunkPayload;
}

export interface ChatEndMessage {
  type: "chat_end";
  request_id: string;
  payload: ChatEndPayload;
}

export interface AbortMessage {
  type: "abort";
  request_id: string;
  payload?: AbortPayload;
}

export interface ErrorMessage {
  type: "error";
  request_id?: string;
  payload: ErrorPayload;
}

export type ProtocolMessage =
  | ServerInfoMessage
  | ChatStartMessage
  | ChatChunkMessage
  | ChatEndMessage
  | AbortMessage
  | ErrorMessage;
