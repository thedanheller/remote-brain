## 1. Monorepo Setup
- [ ] 1.1 Create root `package.json` with npm workspaces (`packages/*`, `apps/*`)
- [ ] 1.2 Create root `tsconfig.json` base config

## 2. Package Scaffold
- [ ] 2.1 Create `packages/protocol/package.json` (ESM, TypeScript)
- [ ] 2.2 Create `packages/protocol/tsconfig.json`
- [ ] 2.3 Install dev dependencies (typescript, vitest)

## 3. Type Definitions
- [ ] 3.1 Define message envelope type (`type`, `request_id?`, `payload`)
- [ ] 3.2 Define all message types (`server_info`, `chat_start`, `chat_chunk`, `chat_end`, `abort`, `error`)
- [ ] 3.3 Define error code enum with all codes (connection, host, protocol)

## 4. NDJSON Codec
- [ ] 4.1 Implement NDJSON encoder (object → JSON line)
- [ ] 4.2 Implement NDJSON decoder (stream → parsed objects)
- [ ] 4.3 Handle partial chunks and buffer splitting

## 5. Runtime Validation
- [ ] 5.1 Implement type guard for message envelope
- [ ] 5.2 Implement type guards for each message type
- [ ] 5.3 Implement `request_id` generator helper

## 6. Public API
- [ ] 6.1 Create `src/index.ts` re-exporting all public types, validators, codec, errors

## 7. Tests
- [ ] 7.1 NDJSON encoder/decoder tests (single, multiple, partial chunks)
- [ ] 7.2 Validation tests (valid + invalid messages for each type)
- [ ] 7.3 Streaming lifecycle integration test (chat_start → chat_chunk × N → chat_end)
- [ ] 7.4 All tests pass, package builds cleanly
