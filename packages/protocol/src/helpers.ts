export function generateRequestId(): string {
  return crypto.randomUUID();
}

export const LIMITS = {
  MAX_PROMPT_SIZE: 8192,
  CLIENT_TIMEOUT_MS: 30_000,
} as const;

export const { MAX_PROMPT_SIZE, CLIENT_TIMEOUT_MS } = LIMITS;
