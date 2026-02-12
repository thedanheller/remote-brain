# Host

## Purpose
Defines the macOS menu bar host application: Ollama adapter, server lifecycle, concurrency, and UX.

## Requirements

### Requirement: Menu Bar Application
The Host SHALL be a headless macOS menu bar application.

#### Scenario: Application launch
- **WHEN** the Host application starts
- **THEN** it appears as a menu bar icon with no main window

---

### Requirement: Server Lifecycle
The Host SHALL support Start Server and Stop Server actions from the menu bar.

#### Scenario: Start server
- **WHEN** the user clicks Start Server
- **THEN** the Hyperswarm server starts, generates a topic, and transitions to Ready state

#### Scenario: Stop server
- **WHEN** the user clicks Stop Server
- **THEN** all client connections are closed and the server transitions to Stopped state

---

### Requirement: Host States
The Host SHALL display one of three states: Stopped, Ready, or Busy.

#### Scenario: State transitions
- **WHEN** the server is not running → state is **Stopped**
- **WHEN** the server is running and idle → state is **Ready**
- **WHEN** inference is in progress → state is **Busy**

---

### Requirement: Menu Bar Items
The Host menu SHALL include: Start Server, Stop Server, Model selection, Copy Server ID, Show QR Code, Clients Connected count, Toggle Debug Logs, and Quit.

#### Scenario: Menu interaction
- **WHEN** the user opens the menu bar dropdown
- **THEN** all menu items are displayed with current state

---

### Requirement: Ollama Adapter
The Host SHALL communicate with the local Ollama API to perform inference. It SHALL support streaming responses.

#### Scenario: Ollama available
- **WHEN** the Host starts and Ollama is running with the selected model
- **THEN** the adapter is ready to accept inference requests

#### Scenario: Ollama not found
- **WHEN** the Host starts and Ollama is not running
- **THEN** the Host reports error `OLLAMA_NOT_FOUND`

#### Scenario: Model not available
- **WHEN** the selected model is not available in Ollama
- **THEN** the Host reports error `OLLAMA_MODEL_NOT_AVAILABLE`

---

### Requirement: Model Selection
The Host SHALL allow the user to select which Ollama model to use for inference via the menu bar.

#### Scenario: User selects model
- **WHEN** the user selects a model from the menu
- **THEN** subsequent inference requests use the selected model
- **AND** the model name is included in `server_info` sent to clients

---

### Requirement: Global Concurrency Gate
The Host SHALL allow only one active inference globally. Additional requests while busy SHALL be rejected with `MODEL_BUSY`.

#### Scenario: Single inference
- **WHEN** an inference request arrives and no inference is active
- **THEN** the Host begins inference

#### Scenario: Concurrent request rejected
- **WHEN** an inference request arrives while another is active
- **THEN** the Host responds with error code `MODEL_BUSY`

---

### Requirement: Streaming Relay
The Host SHALL relay Ollama streaming tokens to the requesting Client via the protocol's `chat_chunk` messages.

#### Scenario: Token relay
- **WHEN** Ollama produces a token during inference
- **THEN** the Host sends a `chat_chunk` to the requesting Client with the token text

---

### Requirement: Identity
The Host SHALL expose an editable Display Name included in `server_info`. No uniqueness constraints apply.

#### Scenario: Display name sent
- **WHEN** a Client connects
- **THEN** the `server_info` payload includes the Host's display name as `host_name`

---

### Requirement: Debug Logging
The Host SHALL support local debug logs with toggle visibility from the menu bar.

#### Scenario: Toggle logs
- **WHEN** the user toggles Debug Logs
- **THEN** logging output is shown or hidden accordingly
