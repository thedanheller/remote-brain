## Technical Decisions

### Package Structure
- Location: `packages/protocol/`
- Language: TypeScript (strict mode)
- Build: `tsc` to ESM
- Test: `vitest`
- No runtime dependencies — Node.js built-ins only

### Module Layout

```
packages/protocol/
├── src/
│   ├── index.ts          # Public API re-exports
│   ├── types.ts          # Message type definitions
│   ├── errors.ts         # Error code enum + helpers
│   ├── ndjson.ts         # Encoder/decoder (Transform streams)
│   └── validate.ts       # Runtime message validation
├── test/
│   ├── ndjson.test.ts
│   ├── validate.test.ts
│   └── lifecycle.test.ts
├── package.json
└── tsconfig.json
```

### Key Decisions

1. **NDJSON codec uses Node Transform streams** — composable with Hyperswarm duplex streams on both Host and Client
2. **Runtime validation via type guards** — no schema library (zod/ajv) to keep zero dependencies
3. **Error codes as const enum** — tree-shakeable, no runtime overhead
4. **request_id generation** — `crypto.randomUUID()` exposed as helper
5. **ESM output** — both Host (Node) and Client (Bare) support ESM
