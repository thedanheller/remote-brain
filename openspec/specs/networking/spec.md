# Networking

## Purpose
Defines the P2P transport, discovery, and connection model using Holepunch Hyperswarm.

## Requirements

### Requirement: Hyperswarm Transport
All peer-to-peer communication SHALL use Holepunch Hyperswarm as the transport layer. Encryption is provided by Hyperswarm.

#### Scenario: Peers communicate
- **WHEN** a Host and Client are connected
- **THEN** all data is transmitted over an encrypted Hyperswarm connection

---

### Requirement: Topic Generation
The Host SHALL generate a random 32-byte topic and encode it as base58 to produce the Server ID.

#### Scenario: Host generates Server ID
- **WHEN** the Host starts the server
- **THEN** a random 32-byte topic is generated and encoded as base58 to produce the Server ID

---

### Requirement: Server ID Distribution
The Server ID SHALL be distributable via copy/paste or QR code.

#### Scenario: Copy Server ID
- **WHEN** the Host copies the Server ID
- **THEN** the base58-encoded topic is placed on the clipboard

#### Scenario: QR Code display
- **WHEN** the Host displays the QR code
- **THEN** the QR encodes the base58 Server ID

---

### Requirement: Client Connection
The Client SHALL decode a base58 Server ID into a topic, join the Hyperswarm topic, and connect to the Host peer.

#### Scenario: Connect via Server ID
- **WHEN** the Client enters or scans a valid Server ID
- **THEN** it decodes base58 to a topic, joins Hyperswarm, and connects to the Host

#### Scenario: Invalid Server ID
- **WHEN** the Client enters an invalid Server ID
- **THEN** connection fails with error code `INVALID_SERVER_ID`

---

### Requirement: Direct Connect Only
The system SHALL use direct peer connections only. There SHALL be no global discovery, presence system, or usernames.

#### Scenario: No discovery
- **WHEN** a Client is not given a Server ID
- **THEN** it cannot discover any Hosts

---

### Requirement: Connection Limits
The Host SHALL accept a maximum of 5 connected clients simultaneously.

#### Scenario: Sixth client connects
- **WHEN** a sixth Client attempts to connect while 5 are connected
- **THEN** the connection is rejected
