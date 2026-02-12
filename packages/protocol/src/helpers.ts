export function generateRequestId(): string {
  return crypto.randomUUID();
}

export const MAX_PROMPT_SIZE = 8192;
