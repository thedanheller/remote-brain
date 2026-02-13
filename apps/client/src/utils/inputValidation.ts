import bs58 from "bs58";
import { MAX_PROMPT_SIZE } from "@localllm/protocol";

type ChatConnectionState = "disconnected" | "connecting" | "connected";

export function parseServerId(raw: string): string | null {
  const candidate = raw.trim();
  if (!candidate) {
    return null;
  }

  try {
    const decoded = bs58.decode(candidate);
    return decoded.length === 32 ? candidate : null;
  } catch {
    return null;
  }
}

export function isSendDisabled(input: {
  connectionState: ChatConnectionState;
  isGenerating: boolean;
  prompt: string;
}): boolean {
  const promptLength = new TextEncoder().encode(input.prompt.trim()).byteLength;
  return (
    input.isGenerating ||
    promptLength > MAX_PROMPT_SIZE ||
    promptLength === 0 ||
    input.connectionState !== "connected"
  );
}
