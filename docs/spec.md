# LocalLLM over Holepunch – Specification (v1)

## 1. Overview

**Product Name (working):** LocalLLM  

**Concept:**  
A peer-to-peer system enabling a user running a local Ollama LLM to share inference capabilities with remote clients using Holepunch (Hyperswarm).

**Core Idea:**  
- Host runs Ollama locally  
- Host starts a Holepunch P2P server  
- Clients connect via Server ID or QR  
- Clients send prompts  
- Host performs inference  
- Responses stream back in real time  

**Design Priorities (v1):**  
- Fully P2P (no backend servers)  
- Minimal security/auth complexity  
- Deterministic behaviour  
- Demo-grade reliability  
- Impressive UX (streaming chat)  

---

## 2. Platform Targets

### Host
- macOS  
- Headless menu bar application  

### Client
- iPhone (v1 focus)  
- Expo React Native application  
- Embedded Bare runtime  

---

## 3. Architecture

### Host (macOS)
- Menu Bar UI  
- Ollama Adapter  
- Hyperswarm Server  
- Global Concurrency Gate  
- Local Logging  

### Client (iPhone)
- React Native UI  
- Bare Worklet (Networking + Protocol)  
- UI ↔ Worklet Bridge  
- Local Session State  

### Shared
- Protocol definitions  
- Core utilities  
- Networking helpers  

---

## 4. Networking Model

**Transport:** Holepunch Hyperswarm  
**Discovery:** Topic-based  
**Encryption:** Provided by Hyperswarm  

### Pairing Mechanism

**Host:**
1. Generate random 32-byte topic  
2. Encode topic → base58  
3. Server ID = base58(topic)  

**Distribution:**
- Copy/paste  
- QR Code  

**Client:**
1. Decode base58 → topic  
2. Join Hyperswarm topic  
3. Connect to host peer  

---

## 5. Connection Model

- Direct connect only  
- No global discovery  
- No presence system  
- No usernames  

---

## 6. Identity Model

- Host exposes editable **Display Name**  
- Included in `server_info`  
- No uniqueness constraints  

---

## 7. Inference Model

- Host-only inference  
- Stateless prompts  
- No conversation memory  
- Single active generation globally  

---

## 8. Concurrency Rules

- Host allows only **one active inference globally**  
- Additional requests rejected  

Returned error:
- `MODEL_BUSY`  

---

## 9. Protocol

### 9.1 Framing Format

**NDJSON (newline-delimited JSON)**  

Rules:
- Each message = one JSON object  
- Messages separated by newline (`\n`)  

---

### 9.2 Message Envelope

```json
{
  "type": "string",
  "request_id": "string (optional)",
  "payload": {}
}
```

**Fields:**
- `type` → message discriminator  
- `request_id` → identifies request lifecycle  
- `payload` → message-specific data  

---

### 9.3 Message Types

#### `server_info`
**Direction:** Host → Client  

```json
{
  "type": "server_info",
  "payload": {
    "host_name": "Dan’s MacBook",
    "model": "llama3.2",
    "status": "ready"
  }
}
```

**Purpose:**
- Confirm connection  
- Inform selected model  

---

#### `chat_start`
**Direction:** Client → Host  

```json
{
  "type": "chat_start",
  "request_id": "req-123",
  "payload": {
    "prompt": "Explain quantum computing simply"
  }
}
```

**Purpose:**
- Initiate inference  

---

#### `chat_chunk`
**Direction:** Host → Client  

```json
{
  "type": "chat_chunk",
  "request_id": "req-123",
  "payload": {
    "text": "Quantum computing uses qubits..."
  }
}
```

**Purpose:**
- Stream partial tokens  

---

#### `chat_end`
**Direction:** Host → Client  

```json
{
  "type": "chat_end",
  "request_id": "req-123",
  "payload": {
    "finish_reason": "stop"
  }
}
```

**Purpose:**
- Close response stream  

---

#### `abort`
**Direction:** Client → Host  

```json
{
  "type": "abort",
  "request_id": "req-123"
}
```

**Purpose:**
- Stop generation  

---

#### `error`
**Direction:** Either direction  

```json
{
  "type": "error",
  "request_id": "req-123",
  "payload": {
    "code": "MODEL_BUSY",
    "message": "Host is processing another request"
  }
}
```

**Purpose:**
- Failure handling  

---

## 10. Error Codes

### Connection
- INVALID_SERVER_ID  
- CONNECT_FAILED  
- HOST_OFFLINE  
- HOST_DISCONNECTED  

### Host / Ollama
- OLLAMA_NOT_FOUND  
- OLLAMA_MODEL_NOT_AVAILABLE  
- MODEL_BUSY  
- GENERATION_FAILED  
- GENERATION_ABORTED  

### Protocol
- BAD_MESSAGE  
- UNSUPPORTED_VERSION  
- TIMEOUT_NO_RESPONSE  

---

## 11. Limits / Guardrails

- Max prompt size: **8 KB**  
- Max connected clients: **5**  
- Client timeout: **30 seconds** without response  
- Single inference globally  

---

## 12. Performance Targets (v1)

- Connect latency: < 5s typical  
- First token latency: < 3s typical  
- Streaming: near real-time  

---

## 13. Host UX

**Application Type:** Menu Bar (Headless)

**States:**
- Stopped  
- Ready  
- Busy  

**Menu Items:**
- Start Server  
- Stop Server  
- Model selection  
- Copy Server ID  
- Show QR Code  
- Clients Connected: N  
- Toggle Debug Logs  
- Quit  

---

## 14. Client UX

### Connect Screen
- Paste Server ID  
- Scan QR  
- Connect button  
- Status/errors  

### Chat Screen
- Host name + model header  
- Transcript area  
- Prompt input  
- Send  
- Stop (during generation)  
- Clear  

---

## 15. Logging

**Host:**
- Local debug logs  
- Toggle visibility  

**Client:**
- Optional hidden debug screen  

---

## 16. Privacy / Security (v1)

- Encrypted Hyperswarm transport  
- No authentication  
- No passwords  
- Host sees prompts  

---

## 17. Monorepo Structure

```text
apps/
  host/
  client/

packages/
  protocol/
  core/

docs/
  spec.md
```

---

## 18. Dependencies

**Networking:**
- hyperswarm  

**Runtime:**
- Bare  
- react-native-bare-kit  

**Client UI:**
- Expo React Native  

**Inference:**
- Ollama local API  

---

## 19. Non-Goals (v1)

- Authentication / accounts  
- Discovery network  
- Conversation memory  
- Request queues  
- Multi-model switching  
- Cloud inference  

---

## 20. Future Extensions

- Authentication / permissions  
- Conversation memory  
- Multi-client scheduling  
- Persistent host list  
- Android client  
- Context/file uploads  
- Usage metrics  

---

## 21. Definition of Done (v1)

### Host
- Start/Stop server  
- Model selection  
- Server ID + QR  
- Accept clients  
- Stream responses  

### Client
- Connect via ID/QR  
- Display host/model  
- Send prompt  
- Receive streaming tokens  
- Abort generation  

### System
- Stable P2P connections
- Deterministic error handling
- Demo-grade UX polish