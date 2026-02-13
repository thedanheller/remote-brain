import { SWARM_WORKLET_SOURCE } from "./swarmWorkletSource";

describe("SWARM_WORKLET_SOURCE runtime guards", () => {
  test("installs Bare runtime unhandled rejection hooks", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('unhandledRejection'");
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('uncaughtException'");
  });

  test("patches discovery internal onerror handler to avoid safety-catch aborts", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("target._onerror = (error) => {");
    expect(SWARM_WORKLET_SOURCE).toContain("emitError('CONNECT_FAILED', 'Discovery error: ' + toErrorMessage(error))");
  });

  test("uses a safe hyperswarm wrapper for internal async refresh errors", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("class SafeHyperswarm extends factory");
    expect(SWARM_WORKLET_SOURCE).toContain("Swarm network update failed");
    expect(SWARM_WORKLET_SOURCE).toContain("Swarm network change failed");
  });

  test("guards thenable-returning socket writes", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("const writeResult = targetSocket.write(message)");
    expect(SWARM_WORKLET_SOURCE).toContain("handleThenable(writeResult, (error) => {");
  });
});
