import { SWARM_WORKLET_SOURCE } from "./swarmWorkletSource";

describe("SWARM_WORKLET_SOURCE runtime guards", () => {
  test("installs Bare runtime unhandled rejection hooks", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('unhandledRejection'");
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('unhandledrejection'");
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('uncaughtException'");
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('uncaughtexception'");
    expect(SWARM_WORKLET_SOURCE).toContain("bareRuntime.on('unhandledRejection', (reason) => {");
    expect(SWARM_WORKLET_SOURCE).toContain("reportUnhandledRejection(reason)");
    expect(SWARM_WORKLET_SOURCE).toContain("reportUncaughtException(error)");
    expect(SWARM_WORKLET_SOURCE).toContain("return true");
  });

  test("retries Bare hook setup when runtime is not yet ready", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("const BARE_HOOK_RETRY_MAX_ATTEMPTS = 20");
    expect(SWARM_WORKLET_SOURCE).toContain("scheduleBareHookRetry()");
    expect(SWARM_WORKLET_SOURCE).toContain("bareHookRetryAttempts += 1");
  });

  test("patches discovery internal onerror handler to avoid safety-catch aborts", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("target._onerror = (error) => {");
    expect(SWARM_WORKLET_SOURCE).toContain("emitError('CONNECT_FAILED', 'Discovery error: ' + toErrorMessage(error))");
    expect(SWARM_WORKLET_SOURCE).toContain("onerror: onDiscoveryError");
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

  test("re-checks hook installation when processing commands", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("IPC.on('data', guarded((chunk) => {");
    expect(SWARM_WORKLET_SOURCE).toContain("installUnhandledHooks()");
    expect(SWARM_WORKLET_SOURCE).toContain("installPromiseSafetyNet()");
  });

  test("patches Promise.prototype.then to mark chained promises as observed", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("Promise.prototype.then = function patchedThen");
    expect(SWARM_WORKLET_SOURCE).toContain("hooks.promise.patch");
  });

  test("captures first-failure async breadcrumbs for crash forensics", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("const BREADCRUMB_BUFFER_SIZE = 120");
    expect(SWARM_WORKLET_SOURCE).toContain("function addBreadcrumb(edge, detail)");
    expect(SWARM_WORKLET_SOURCE).toContain("type: 'worklet_failure_breadcrumbs'");
    expect(SWARM_WORKLET_SOURCE).toContain("dumpBreadcrumbsOnce('emitError'");
    expect(SWARM_WORKLET_SOURCE).toContain("DIAGNOSTIC_PREFIX");
  });

  test("supports decode-only and join-only connect isolation modes", () => {
    expect(SWARM_WORKLET_SOURCE).toContain("CONNECT_DIAGNOSTIC_PHASE_DECODE_ONLY");
    expect(SWARM_WORKLET_SOURCE).toContain("CONNECT_DIAGNOSTIC_PHASE_JOIN_ONLY");
    expect(SWARM_WORKLET_SOURCE).toContain("connect.stop.decode_only");
    expect(SWARM_WORKLET_SOURCE).toContain("connect.stop.join_only.connection");
    expect(SWARM_WORKLET_SOURCE).toContain("handleConnect(command.topic, command.diagnosticMode)");
  });
});
