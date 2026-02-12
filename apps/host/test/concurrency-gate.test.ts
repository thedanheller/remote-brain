import { describe, it, expect, beforeEach } from "vitest";
import { ConcurrencyGate } from "../src/concurrency/gate.js";

describe("ConcurrencyGate", () => {
  let gate: ConcurrencyGate;

  beforeEach(() => {
    gate = new ConcurrencyGate();
  });

  it("should start in idle state", () => {
    expect(gate.isBusy()).toBe(false);
    expect(gate.getActiveRequest()).toBeNull();
  });

  it("should acquire gate for first request", () => {
    const result = gate.acquire("req-1");
    expect(result).toBe(true);
    expect(gate.isBusy()).toBe(true);
    expect(gate.getActiveRequest()).toBe("req-1");
  });

  it("should reject second request when busy", () => {
    gate.acquire("req-1");
    const result = gate.acquire("req-2");
    expect(result).toBe(false);
    expect(gate.getActiveRequest()).toBe("req-1");
  });

  it("should allow new request after release", () => {
    gate.acquire("req-1");
    gate.release("req-1");

    expect(gate.isBusy()).toBe(false);
    expect(gate.getActiveRequest()).toBeNull();

    const result = gate.acquire("req-2");
    expect(result).toBe(true);
    expect(gate.getActiveRequest()).toBe("req-2");
  });

  it("should not release if request ID doesn't match", () => {
    gate.acquire("req-1");
    gate.release("req-2");

    expect(gate.isBusy()).toBe(true);
    expect(gate.getActiveRequest()).toBe("req-1");
  });

  it("should force release regardless of request ID", () => {
    gate.acquire("req-1");
    gate.forceRelease();

    expect(gate.isBusy()).toBe(false);
    expect(gate.getActiveRequest()).toBeNull();
  });

  it("should handle multiple acquire attempts", () => {
    expect(gate.acquire("req-1")).toBe(true);
    expect(gate.acquire("req-2")).toBe(false);
    expect(gate.acquire("req-3")).toBe(false);
    expect(gate.getActiveRequest()).toBe("req-1");
  });

  it("should handle release of non-existent request", () => {
    gate.release("req-1");
    expect(gate.isBusy()).toBe(false);
  });
});
