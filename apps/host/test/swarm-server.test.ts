import { describe, it, expect, beforeEach, vi } from "vitest";
import { SwarmServer } from "../src/server/swarm.js";
import type { Duplex } from "stream";

// Mock Hyperswarm
const mockSwarm = {
  join: vi.fn().mockReturnValue({
    flushed: vi.fn().mockResolvedValue(undefined),
  }),
  leave: vi.fn(),
  destroy: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

vi.mock("hyperswarm", () => ({
  default: vi.fn(() => mockSwarm),
}));

describe("SwarmServer", () => {
  let swarmServer: SwarmServer;
  let onConnectionSpy = vi.fn();
  let onDisconnectionSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    swarmServer = new SwarmServer({
      onConnection: onConnectionSpy,
      onDisconnection: onDisconnectionSpy,
    });
  });

  it("should start server and generate server ID", async () => {
    const serverId = await swarmServer.start();

    expect(serverId).toBeTruthy();
    expect(typeof serverId).toBe("string");
    expect(serverId.length).toBeGreaterThan(0);
    expect(swarmServer.isRunning()).toBe(true);
    expect(swarmServer.getServerId()).toBe(serverId);
  });

  it("should not allow starting server twice", async () => {
    await swarmServer.start();

    await expect(swarmServer.start()).rejects.toThrow("Server already running");
  });

  it("should gracefully stop server", async () => {
    await swarmServer.start();
    const serverId = swarmServer.getServerId();

    expect(serverId).toBeTruthy();

    await swarmServer.stop();

    expect(swarmServer.isRunning()).toBe(false);
    expect(swarmServer.getServerId()).toBeNull();
    expect(mockSwarm.leave).toHaveBeenCalled();
    expect(mockSwarm.destroy).toHaveBeenCalled();
  });

  it("should close all connected sockets on stop", async () => {
    await swarmServer.start();

    // Simulate a connection
    const mockSocket = {
      destroy: vi.fn(),
      on: vi.fn(),
    } as unknown as Duplex;

    // Get the connection handler that was registered
    const connectionHandler = mockSwarm.on.mock.calls.find(
      (call) => call[0] === "connection"
    )?.[1];

    if (connectionHandler) {
      connectionHandler(mockSocket);
    }

    expect(swarmServer.getClientCount()).toBe(1);

    await swarmServer.stop();

    expect(mockSocket.destroy).toHaveBeenCalled();
    expect(swarmServer.getClientCount()).toBe(0);
  });

  it("should handle stop when not running", async () => {
    // Should not throw
    await expect(swarmServer.stop()).resolves.not.toThrow();
  });

  it("should track connected clients", async () => {
    await swarmServer.start();

    expect(swarmServer.getClientCount()).toBe(0);

    // Simulate multiple connections
    const mockSocket1 = {
      destroy: vi.fn(),
      on: vi.fn(),
    } as unknown as Duplex;

    const mockSocket2 = {
      destroy: vi.fn(),
      on: vi.fn(),
    } as unknown as Duplex;

    const connectionHandler = mockSwarm.on.mock.calls.find(
      (call) => call[0] === "connection"
    )?.[1];

    if (connectionHandler) {
      connectionHandler(mockSocket1);
      connectionHandler(mockSocket2);
    }

    expect(swarmServer.getClientCount()).toBe(2);
  });
});
