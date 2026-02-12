# Client

## Purpose
Defines the iPhone Expo React Native client application: connection, chat UI, streaming, and error handling.

## Requirements

### Requirement: Expo React Native Application
The Client SHALL be an Expo React Native application targeting iPhone with an embedded Bare runtime for networking.

#### Scenario: Application launch
- **WHEN** the Client app launches
- **THEN** it displays the Connect Screen

---

### Requirement: Connect Screen
The Client SHALL provide a Connect Screen with: paste Server ID, scan QR, connect button, and status/error display.

#### Scenario: Paste Server ID
- **WHEN** the user pastes a Server ID and taps Connect
- **THEN** the Client attempts to connect to the Host

#### Scenario: Scan QR
- **WHEN** the user scans a QR code containing a Server ID
- **THEN** the Server ID field is populated and connection begins

#### Scenario: Connection error
- **WHEN** connection fails
- **THEN** the error is displayed on the Connect Screen with the appropriate error code

---

### Requirement: Chat Screen
The Client SHALL display a Chat Screen after connection with: host name + model header, transcript area, prompt input, send button, stop button (during generation), and clear button.

#### Scenario: Connected to host
- **WHEN** the Client receives `server_info`
- **THEN** it navigates to the Chat Screen showing the host name and model in the header

---

### Requirement: Send Prompt
The Client SHALL send a `chat_start` message when the user submits a prompt.

#### Scenario: User sends prompt
- **WHEN** the user types a prompt and taps Send
- **THEN** a `chat_start` message with a unique `request_id` is sent to the Host

---

### Requirement: Streaming Display
The Client SHALL display streaming `chat_chunk` tokens in real time in the transcript area.

#### Scenario: Tokens arrive
- **WHEN** `chat_chunk` messages arrive
- **THEN** the text is appended to the current response in the transcript in real time

---

### Requirement: Abort Generation
The Client SHALL allow the user to abort an in-progress generation by tapping the Stop button.

#### Scenario: User taps stop
- **WHEN** the user taps Stop during generation
- **THEN** an `abort` message is sent to the Host and generation stops

---

### Requirement: Timeout Guard
The Client SHALL enforce a 30-second timeout if no response is received after sending `chat_start`.

#### Scenario: Timeout triggered
- **WHEN** 30 seconds pass without a `chat_chunk` or `chat_end`
- **THEN** the Client treats it as error `TIMEOUT_NO_RESPONSE` and surfaces it to the user

---

### Requirement: Connection State Errors
The Client SHALL handle connection errors (`HOST_OFFLINE`, `HOST_DISCONNECTED`, `CONNECT_FAILED`) and surface them to the user.

#### Scenario: Host disconnects
- **WHEN** the Host disconnects unexpectedly
- **THEN** the Client displays `HOST_DISCONNECTED` error and returns to the Connect Screen

---

### Requirement: Debug Screen
The Client SHALL include an optional hidden debug screen for viewing logs.

#### Scenario: Access debug screen
- **WHEN** the user triggers the hidden debug gesture
- **THEN** a debug screen with log output is displayed
