# Comprehensive Debug Prompt: Persistent BareKit Unhandled-Rejection Crash on iOS Simulator

You are debugging a persistent iOS Simulator crash in a React Native + Expo app that uses `react-native-bare-kit` worklets and `hyperswarm`.

## Project and Environment
- Repo: `/Users/danilo/dev/remote-brain-codex`
- App package: `apps/client`
- iOS bundle id: `com.anonymous.client`
- Platform: macOS 15.7.3 (Apple Silicon), iOS Simulator runtime 26.2
- App version in crash report: `1.0.0 (1)`

## Problem Summary
The app launches and UI works, but after entering/pasting a connection code and attempting to connect, the app crashes hard.

Crash characteristics:
- `EXC_CRASH (SIGABRT)` / `Abort trap: 6`
- Triggered on a BareKit worklet thread
- Stack consistently includes:
  - `bare_runtime__on_unhandled_rejection`
  - `bare_runtime__abort`
  - `js_callback_s::on_call`
  - `v8::Function::Call`

Interpretation: an unhandled Promise rejection still escapes inside the Bare runtime.

## Reproduction
1. Start Metro for dev client.
2. Launch iOS app in simulator.
3. Paste valid-ish server ID / connection code.
4. Tap connect.
5. App eventually aborts with the signature above.

## Current Runtime Path
The app currently uses `WorkletBridge` directly from `App.tsx` (not `ProtocolClient` runtime path):
- `apps/client/App.tsx`
- `apps/client/src/services/workletBridge.ts`
- Worklet source string:
  - `apps/client/src/worklet/swarmWorkletSource.ts`

## Changes Already Implemented
### 1) Worklet hardening and async guards
In `apps/client/src/worklet/swarmWorkletSource.ts`:
- Added `emit(...)` safe wrapper.
- Added `toErrorMessage(...)` utility.
- Added `guarded(...)` for callbacks.
- Added `handleThenable(...)` and `suppressRejection(...)` to ensure thenables are observed.
- Added `writeSocketMessage(...)` to capture sync/async write failures.
- Added socket destroy guards and cleanup hardening.
- Added server info timeout + request timeout safety logic.
- Added protocol parse guards and buffer limit disconnect logic.
- Added lazy loading of hyperswarm factory.

### 2) Unhandled rejection hooks
Also in `swarmWorkletSource.ts`:
- Added `installUnhandledHooks()`.
- Hooks currently set on:
  - `globalThis.onunhandledrejection`
  - `globalThis.onerror`
  - `process.on('unhandledRejection')`
  - `process.on('uncaughtException')`
  - `Bare.on('unhandledRejection')` / `Bare.on('uncaughtException')` when available
- All hooks emit structured IPC `onError` events.

### 3) Hyperswarm-specific defensive patching
Also in `swarmWorkletSource.ts`:
- Added `attachDiscoveryErrorHandler(...)` that patches discovery internal `_onerror` to emit `onError` IPC instead of relying on default `safety-catch` behavior.
- Added `SafeHyperswarm` wrapper via `getSafeHyperswarmFactory(...)`:
  - overrides internal async `_handleNetworkUpdate` and `_handleNetworkChange`
  - catches and emits errors rather than letting async rejections escape.

### 4) Tests
- Added tests in `apps/client/src/worklet/swarmWorkletSource.test.ts` to lock in presence of runtime safety hooks and guards.
- Current `npm test --prefix apps/client` passes.

## Important Evidence
Most recent crash report still shows:
- `BareKit 1.15.0`
- faulting thread stack with:
  - `bare_runtime__on_unhandled_rejection`
  - `js_call_function`
  - `bare_worklet__on_thread`
- This means a Promise rejection is still unhandled at Bare runtime level despite current hooks.

## Suspected Remaining Gaps
1. Hooks may not be attached to the exact runtime event source that triggers `bare_runtime__on_unhandled_rejection`.
2. Rejection may occur before `installUnhandledHooks()` executes.
3. A Promise path in hyperswarm/hyperdht or dependencies may bypass patched handlers.
4. A callback invoked by bare internals may throw synchronously from within a microtask callback.

## Requested Task
Find and fix the true root cause so connect failures never hard-abort the process.

### Acceptance Criteria
- App no longer crashes on connect attempts.
- All failures (invalid topic, offline host, handshake timeout, internal runtime exceptions) are surfaced as app-level `onError`/`onDisconnect` events.
- No `bare_runtime__on_unhandled_rejection` process aborts.
- Existing tests pass; add/update tests where meaningful.

## High-Value Next Steps
1. Add earliest-possible instrumentation at top of worklet source to log startup and hook-install sequencing.
2. Add a temporary Promise rejection tracker in the worklet (wrapping `Promise.prototype.then/catch` carefully) to emit origin markers for first unhandled candidate.
3. Add explicit guards around all event callbacks registered with third-party libs (`swarm`, `socket`, discovery/session objects, and any DHT objects accessible).
4. Validate whether `Bare.on('unhandledRejection')` requires a different API/event name/version-specific call pattern in BareKit 1.15.0.
5. If needed, temporarily reduce worklet connect flow to a minimal no-network skeleton, then incrementally re-enable hyperswarm steps to isolate the first rejection source.
6. If hyperswarm internals remain unstable in worklet runtime, consider isolating connect logic behind a simpler explicit peer connection path or deferring hyperswarm interaction to native side as a fallback.

## Commands Used for Verification
- Tests:
  - `npm test --prefix apps/client`
- Typical run commands:
  - `npm run start --prefix apps/client -- --clear`
  - `npm run ios --prefix apps/client -- --no-build-cache --no-bundler`

## Files to Inspect First
- `apps/client/src/worklet/swarmWorkletSource.ts`
- `apps/client/src/services/workletBridge.ts`
- `apps/client/App.tsx`
- `apps/client/src/services/protocolClient.ts` (not active runtime path but useful for protocol assumptions)
- `apps/client/src/services/bareSwarmTransport.ts` (legacy/parallel transport path)
