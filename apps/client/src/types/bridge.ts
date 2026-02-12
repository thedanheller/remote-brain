export type BridgeCommand =
  | { type: "connect"; topic: number[] }
  | { type: "disconnect" }
  | { type: "sendPrompt"; prompt: string }
  | { type: "abort" };

export type WorkletEvent =
  | {
      type: "onServerInfo";
      hostName: string;
      model: string;
      status: "ready" | "busy";
    }
  | {
      type: "onChunk";
      requestId: string;
      text: string;
    }
  | {
      type: "onChatEnd";
      requestId: string;
      finishReason: "stop" | "abort" | "error";
    }
  | {
      type: "onError";
      code: string;
      message: string;
      requestId?: string;
    }
  | {
      type: "onDisconnect";
      code: string;
      message: string;
    }
  | {
      type: "onRawMessage";
      direction: "in" | "out";
      text: string;
    };

export type WorkletEventHandler = (event: WorkletEvent) => void;
