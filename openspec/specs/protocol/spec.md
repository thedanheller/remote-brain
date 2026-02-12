# Protocol

## Purpose
Defines the wire protocol for communication between Host and Client over Hyperswarm.

## Requirements

### Requirement: NDJSON Framing
All messages SHALL use newline-delimited JSON (NDJSON) framing. Each message is one JSON object separated by a newline (`\n`).

#### Scenario: Single message encoding
- **WHEN** a message object is encoded
- **THEN** it is serialized as a single-line JSON string followed by `\n`

#### Scenario: Multiple message decoding
- **WHEN** a stream contains multiple JSON objects separated by `\n`
- **THEN** each object is parsed independently as a complete message

---

### Requirement: Message Envelope
Every protocol message SHALL include a `type` field (string) and a `payload` object. Messages MAY include a `request_id` field to track request lifecycles.

#### Scenario: Valid envelope
- **WHEN** a message contains `type`, `payload`, and optionally `request_id`
- **THEN** it is accepted as a valid envelope

#### Scenario: Missing type field
- **WHEN** a message is missing the `type` field
- **THEN** it is rejected with error code `BAD_MESSAGE`

---

### Requirement: server_info Message
The Host SHALL send a `server_info` message to the Client upon connection. The payload SHALL include `host_name` (string), `model` (string), and `status` (string).

#### Scenario: Client connects
- **WHEN** a Client establishes a connection to the Host
- **THEN** the Host sends a `server_info` message with `host_name`, `model`, and `status: "ready"`

---

### Requirement: chat_start Message
The Client SHALL send a `chat_start` message to initiate inference. The payload SHALL include `prompt` (string). The message SHALL include a `request_id`.

#### Scenario: Client sends prompt
- **WHEN** the Client sends a `chat_start` with a `prompt` and `request_id`
- **THEN** the Host begins inference for that request

#### Scenario: Prompt exceeds max size
- **WHEN** the Client sends a `chat_start` with a prompt exceeding 8 KB
- **THEN** the Host rejects with error code `BAD_MESSAGE`

---

### Requirement: chat_chunk Message
The Host SHALL send `chat_chunk` messages during inference to stream partial tokens. The payload SHALL include `text` (string). The message SHALL include the matching `request_id`.

#### Scenario: Streaming tokens
- **WHEN** inference produces tokens
- **THEN** the Host sends `chat_chunk` messages with partial text, each bearing the originating `request_id`

---

### Requirement: chat_end Message
The Host SHALL send a `chat_end` message when inference completes. The payload SHALL include `finish_reason` (string). The message SHALL include the matching `request_id`.

#### Scenario: Inference completes normally
- **WHEN** inference finishes
- **THEN** the Host sends `chat_end` with `finish_reason: "stop"` and the matching `request_id`

---

### Requirement: abort Message
The Client SHALL be able to send an `abort` message to cancel an in-progress generation. The message SHALL include the `request_id` of the generation to cancel.

#### Scenario: Client aborts generation
- **WHEN** the Client sends `abort` with a `request_id`
- **THEN** the Host stops generation for that request and sends `chat_end` with `finish_reason: "abort"`

---

### Requirement: error Message
Either peer SHALL be able to send an `error` message. The payload SHALL include `code` (string) and `message` (string). The message MAY include a `request_id`.

#### Scenario: Host busy
- **WHEN** a Client sends `chat_start` while inference is active
- **THEN** the Host responds with an `error` message with `code: "MODEL_BUSY"`

---

### Requirement: Error Codes
The protocol SHALL define the following error codes:

**Connection:** `INVALID_SERVER_ID`, `CONNECT_FAILED`, `HOST_OFFLINE`, `HOST_DISCONNECTED`
**Host/Ollama:** `OLLAMA_NOT_FOUND`, `OLLAMA_MODEL_NOT_AVAILABLE`, `MODEL_BUSY`, `GENERATION_FAILED`, `GENERATION_ABORTED`
**Protocol:** `BAD_MESSAGE`, `UNSUPPORTED_VERSION`, `TIMEOUT_NO_RESPONSE`

#### Scenario: Unknown error code received
- **WHEN** a peer receives an error with an unrecognized code
- **THEN** it treats it as a generic error and surfaces the `message` field

---

### Requirement: Streaming Lifecycle
A complete inference lifecycle SHALL follow the sequence: `chat_start` → one or more `chat_chunk` → `chat_end`. All messages in a lifecycle share the same `request_id`.

#### Scenario: Normal streaming lifecycle
- **WHEN** a Client sends `chat_start`
- **THEN** the Host responds with one or more `chat_chunk` messages followed by a `chat_end`, all with the same `request_id`

#### Scenario: Aborted streaming lifecycle
- **WHEN** a Client sends `abort` during streaming
- **THEN** the Host stops sending `chat_chunk` messages and sends `chat_end` with `finish_reason: "abort"`
