/**
 * System-wide limits and guardrails per spec.md §11
 */
export const LIMITS = {
  /** Maximum number of connected clients (spec: 5) */
  MAX_CLIENTS: 5,

  /** Client timeout in milliseconds without response (spec: 30 seconds) */
  CLIENT_TIMEOUT_MS: 30_000,

  /** Maximum prompt size in bytes (spec: 8 KB) */
  MAX_PROMPT_SIZE: 8192,
} as const;
