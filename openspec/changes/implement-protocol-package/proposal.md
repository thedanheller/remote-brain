## Why

Both Host and Client depend on a shared protocol package for message encoding, decoding, validation, and error handling. This package must exist before either app can be built. Without it, Host and Client would duplicate protocol logic and drift out of sync.

## What Changes

- New `packages/protocol` TypeScript package in the monorepo
- NDJSON encoder/decoder for framing messages over Hyperswarm streams
- TypeScript types and runtime validators for all message envelopes (`server_info`, `chat_start`, `chat_chunk`, `chat_end`, `abort`, `error`)
- Error code enum with all connection, host, and protocol error codes
- Streaming lifecycle helpers (request_id generation, lifecycle state tracking)
- Node-based test harness with integration tests for the full streaming lifecycle

## Capabilities

### New Capabilities

_None — this change implements existing spec capabilities, no new requirements._

### Modified Capabilities

_None — all protocol requirements already defined in `openspec/specs/protocol/spec.md`._

## Impact

- **New package:** `packages/protocol/` added to monorepo
- **Dependencies:** No external runtime dependencies beyond Node.js built-ins
- **Dev dependencies:** TypeScript, test runner (vitest or node:test)
- **Consumers:** `apps/host` and `apps/client` will import from this package
- **Monorepo setup:** May require root `package.json` with workspaces configuration
