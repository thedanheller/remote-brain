# Execution Plan -- LocalLLM (v1)

## Track A --- Shared Core

### Scope

-   protocol package
-   NDJSON framing
-   message types
-   error codes
-   type validation
-   test harness

### Tasks

-   Define TypeScript types for all protocol messages
-   Implement NDJSON encoder/decoder
-   Implement message envelope validator
-   Implement error code enum + helpers
-   Create minimal protocol test harness (node-based)
-   Write integration test for streaming lifecycle (start → chunk → end)

### Definition of Done

-   Protocol package builds independently
-   All message types validated at runtime
-   Streaming lifecycle tested
-   No host/client-specific dependencies
-   Usable by both host and client without modification

------------------------------------------------------------------------

## Track B --- Host App

### Scope

-   Menu bar shell
-   Ollama adapter
-   Hyperswarm server
-   Global concurrency gate
-   Streaming pipeline

### Tasks

-   Scaffold macOS menu bar application
-   Implement Hyperswarm topic generation + base58 encoding
-   Implement server start/stop lifecycle
-   Implement Ollama adapter (streaming)
-   Implement single global inference lock
-   Implement request routing via request_id
-   Implement streaming relay (Ollama → protocol → peer)
-   Implement error handling mapping
-   Implement connected client counter
-   Implement QR generation

### Definition of Done

-   Server starts/stops reliably
-   Clients can connect via Server ID
-   Streaming works end-to-end
-   Concurrency rule enforced (MODEL_BUSY returned)
-   Menu bar reflects states (Stopped / Ready / Busy)

------------------------------------------------------------------------

## Track C --- Client App

### Scope

-   Expo shell
-   Bare worklet networking
-   Protocol bridge
-   Streaming UI
-   Abort handling

### Tasks

-   Scaffold Expo React Native project
-   Integrate Bare runtime
-   Implement topic decoding + connection flow
-   Implement protocol client wrapper
-   Implement streaming UI state machine
-   Implement abort handling
-   Implement connection state errors
-   Implement 30-second timeout guard
-   Implement basic transcript view

### Definition of Done

-   Connect via Server ID or QR
-   Receive server_info on connect
-   Send chat_start
-   Stream chat_chunk in real time
-   Handle chat_end correctly
-   Abort stops generation
-   Errors surfaced properly
