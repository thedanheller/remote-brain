# iOS BareKit Crash Handoff (Updated 2026-02-13)

## Purpose
This handoff captures the investigation and resolution of the persistent iOS simulator crash in the BareKit worklet path.

## Current Status: WORKLET BUNDLING MIGRATION COMPLETE
- **Previous fix**: Bug in `hyperdht@6.29.0` fixed via `patch-package` (persisted in `patches/hyperdht+6.29.0.patch`)
- **New issue**: Worklet fails with `MODULE_NOT_FOUND` when trying to `require('hyperswarm')` — inline worklets have no module resolution
- **Solution**: Migrated from inline source to bare-pack bundle (commit `1cbbd4a`)
- **Bundle status**: Successfully generated (636 KB with all dependencies)
- **Tests**: 31 passing (5 suites), all checks passing
- **Current state**: Bundle generated, ready for iOS runtime testing
- **Next step**: User to test on iOS simulator to verify worklet loads and connects

## Environment Snapshot
- Repo: `/Users/danilo/dev/remote-brain-codex`
- App: `apps/client`
- Bundle id: `com.anonymous.client`
- Host OS: `macOS 15.7.3 (24G419)`
- Simulator runtime: `iOS 26.2`
- Device model in reports: `Mac14,13`
- App version in report: `1.0.0 (1)`
- BareKit binary in crash reports: `to.holepunch.bare.kit 1.15.0`

## Repro Procedure Used (2026-02-13)
1. `npm run start --prefix apps/client -- --clear`
2. `xcrun simctl uninstall booted com.anonymous.client && npm run ios --prefix apps/client -- --no-build-cache --no-bundler`
3. Paste Server ID in client
4. Press Connect
5. Crash reproduces

## Active Runtime Path
- `apps/client/App.tsx`
- `apps/client/src/services/workletBridge.ts`
- `apps/client/src/worklet/swarmWorkletSource.ts`

## What Was Added On 2026-02-13

### 1) Deterministic breadcrumb instrumentation in worklet
In `apps/client/src/worklet/swarmWorkletSource.ts`:
- Added a ring buffer for async breadcrumbs.
- Added one-time first-failure dump payload with prefix `[worklet-diag]`.
- Breadcrumbs now record:
  - IPC command receipt and command type
  - Promise observation/rejection edges
  - guarded callback entry/rejection/throw
  - discovery/join lifecycle events
  - socket attach/data/error/close events
  - timeout start/fire and cleanup transitions

### 2) A/B connect isolation modes
Added optional connect diagnostic phases:
- `full` (default)
- `decode_only` (stop before `swarm.join`) for Run A
- `join_only` (run join lifecycle and short-circuit network flow) for Run B

Wiring added in:
- `apps/client/src/types/bridge.ts`
- `apps/client/src/services/workletBridge.ts`
- `apps/client/App.tsx` (debug screen selector for connect mode)

### 3) Additional Bare runtime handler attempt after new crash
In `apps/client/src/worklet/swarmWorkletSource.ts`:
- Updated Bare runtime hook callbacks to explicitly return `true`:
  - `bareRuntime.on('unhandledRejection', ...)`
  - `bareRuntime.on('unhandledrejection', ...)`
  - `bareRuntime.on('uncaughtException', ...)`
  - `bareRuntime.on('uncaughtexception', ...)`

Rationale:
- Hypothesis was that Bare might require an explicit handled signal from runtime callback return values at the abort boundary.

### 4) Test and typecheck coverage
Updated tests:
- `apps/client/src/worklet/swarmWorkletSource.test.ts`
- `apps/client/src/services/workletBridge.test.ts`

Validation completed:
- `npm test --prefix apps/client -- --runInBand`
- `npx tsc -p apps/client/tsconfig.json --noEmit`

Both passed.

## New Crash (Latest Confirmed)

### Crash metadata
- Incident: `164F392F-B218-424E-B6E1-0A8F3F63033E`
- Timestamp: `2026-02-13 08:00:21 -0300`
- Exception: `EXC_CRASH (SIGABRT)`
- Termination: `Abort trap: 6`
- Faulting thread: `11`
- Crash file: `~/Library/Logs/DiagnosticReports/LocalLLM-2026-02-13-080021.ips`

### Key stack signature (faulting thread)
- `bare_runtime__abort`
- `js_callback_s::on_call`
- `bare_runtime__on_unhandled_rejection`
- `js_env_s::run_microtasks`
- `bare_worklet__on_thread`

## Comparison With Previous Crashes
- Same failure class as prior incidents (`C76E6845-F168-4C5C-84B1-D5EA62BA8DBF` and `B57C4D27-6290-4A4F-8F31-16CE151A8D6A`).
- Thread index changed across incidents, but the abort path signature is unchanged.

## Current Interpretation
- Bare's native `bare_runtime__on_unhandled_rejection` calls `bare_runtime__abort` unconditionally — JS handlers cannot prevent the abort.
- The ONLY way to prevent the crash is to prevent unhandled rejections from reaching V8's tracking.
- The first Promise safety net (`.then()` patch only) was insufficient because it only catches chained promises.
- The second attempt (SafePromise constructor + `.reject()` patch + prototype wrapping) still crashed because:
  1. SafePromise registered the handler AFTER the executor ran (V8 fires `PromiseRejectWithNoHandler` during synchronous `reject()` BEFORE the handler is added)
  2. `async` function return values use V8's internal Promise constructor (not `globalThis.Promise`), so fire-and-forget async EventEmitter handlers and timer callbacks bypass all patches

## What Was Added On 2026-02-13 (Session 2)

### 5) Fixed SafePromise timing: handler before executor
- SafePromise now extracts `resolve`/`reject` from the OriginalPromise constructor, registers `markHandled(p)` FIRST, then calls the user's executor with the extracted functions.
- This ensures V8 never sees `PromiseRejectWithNoHandler` for any `new Promise()` call.

### 6) Async safety net: EventEmitter + timer wrapping
New `installAsyncSafetyNet()` function wraps:
- `EventEmitter.prototype.on`, `.once`, `.addListener`, `.removeListener`, `.off` — uses WeakMap to preserve listener identity for removal
- `globalThis.setTimeout`, `setInterval`, `queueMicrotask`, `setImmediate`
All wrappers call `markPromiseHandled(result)` on the return value, covering fire-and-forget async callbacks that bypass `globalThis.Promise`.

### 7) New crash after session 2 first attempt
- Incident: `EDFA377D-2FA8-459C-83D7-57AB7AF443F0`
- Same signature: `bare_runtime__abort` via `bare_runtime__on_unhandled_rejection` during `js_env_s::run_microtasks`
- Crash at +14.4s after launch (consistent with network/DHT timeout)

## Root Cause (Found 2026-02-13, Session 3)

### The Bug
In `hyperdht@6.29.0`, file `lib/connect.js`, line 729, the `abort()` function calls:
```javascript
await updateHolepunch(peerAddress, relayAddress, { ... })
```

But the function signature is:
```javascript
async function updateHolepunch(c, peerAddress, relayAddr, payload)
```

The first parameter `c` (the connection context) is **missing**. This means `peerAddress` is passed as `c`, causing `c.dht._router.peerHolepunch(...)` to throw a runtime error. The `abort()` function is `async` and called via `await` in other async functions, creating an **unhandled promise rejection chain** that reaches V8's rejection tracking and triggers Bare's unconditional `bare_runtime__abort`.

### The Fix
One-line change — add the missing `c` parameter:
```diff
-    await updateHolepunch(peerAddress, relayAddress, {
+    await updateHolepunch(c, peerAddress, relayAddress, {
```

Applied via `patch-package` and persisted in `patches/hyperdht+6.29.0.patch`.

### Why JS-Level Patches Failed
Three rounds of increasingly aggressive JS patches all failed because:
1. Bare's native `bare_runtime__on_unhandled_rejection` calls `bare_runtime__abort` **unconditionally** — no JS handler return value can prevent it
2. V8's internal `%Promise%` intrinsic (used by `async` function returns) bypasses `globalThis.Promise` replacement
3. The only real fix was eliminating the source of the unhandled rejection

## What Was Cleaned Up (Session 3)

### Removed (invasive patches that didn't help)
- `SafePromise` constructor replacement
- `Promise.reject()` patch
- `markPromiseHandled()` function
- `installAsyncSafetyNet()` (EventEmitter wrapping, timer wrapping)
- Hyperswarm prototype method wrapping
- Related module-level variables (`originalThenRef`, `hyperswarmProtoWrapped`, `asyncSafetyNetInstalled`)

### Retained (lightweight defense-in-depth)
- `installPromiseSafetyNet()` — patches `Promise.prototype.then` to add no-op `.catch()` on derived promises
- `installUnhandledHooks()` — Bare runtime event hooks with retry logic
- `guarded()` wrappers, `SafeHyperswarm` class, breadcrumb system, diagnostic modes

## Files Changed (Final State)

| File | Change |
|------|--------|
| `patches/hyperdht+6.29.0.patch` | **Created** — persistent one-line fix for the missing parameter |
| `package.json` | Added `patch-package` devDep + `postinstall` script |
| `node_modules/hyperdht/lib/connect.js` | Direct fix applied (line 729) |
| `apps/client/src/worklet/swarmWorkletSource.ts` | Cleaned up invasive patches, kept lightweight defenses |
| `apps/client/src/worklet/swarmWorkletSource.test.ts` | Simplified to 23 tests matching cleaned-up code |

## Verification Commands
```bash
npm test --prefix apps/client -- --runInBand
npx tsc -p apps/client/tsconfig.json --noEmit
npm run start --prefix apps/client -- --clear
xcrun simctl uninstall booted com.anonymous.client && npm run ios --prefix apps/client -- --no-build-cache --no-bundler
```

## Definition of Done
- Connect no longer triggers `bare_runtime__on_unhandled_rejection` abort
- Failures propagate as app-level `onError` and `onDisconnect` events
- Worklet stays stable across invalid topic, offline peer, timeout, and callback error paths
- Tests pass and cover the runtime guards

## What Was Added On 2026-02-13 (Session 4)

### Worklet Bundling Migration

**Problem**: Inline worklet cannot `require('hyperswarm')` because Bare's runtime is isolated and has no module resolution.

**Solution**: Pre-bundle worklet with all dependencies using `bare-pack`.

#### Implementation (Commit 1cbbd4a)

**Three-step build process** (`npm run bundle:worklet`):

1. **Codegen** (`backend/generateWorklet.mjs`):
   - Reads template from `swarmWorkletSource.ts`
   - Inlines protocol constants: `MAX_PROMPT_SIZE = 8192`, `ErrorCode.*` values
   - Outputs `backend/swarm-client.mjs` (24 KB, gitignored)
   - Fixed: Replace `${ErrorCode.X}` with just the value (not `'value'`) to avoid double-quotes

2. **Bundle** (`scripts/bundleWorklet.mjs`):
   - Runs `bare-pack --target darwin-arm64 --linked`
   - Resolves all `require()` dependencies (hyperswarm, hyperdht, etc.)
   - Outputs `app/swarm-client.bundle.mjs` (636 KB, committed)

3. **Extract** (`scripts/extractBundle.mjs`):
   - Extracts bundle string from `.mjs` file (Metro cannot import .mjs at runtime on iOS)
   - Generates `src/worklet/swarmWorkletBundle.generated.ts` (636 KB, gitignored)
   - TypeScript wrapper that Metro can import

**Runtime changes**:
- `workletBridge.ts`: Now imports `SWARM_WORKLET_BUNDLE` instead of `SWARM_WORKLET_SOURCE`
- `worklet.start()`: Changed from `/swarm-client.js` to `/swarm-client.bundle`

**Files created**:
- `apps/client/backend/generateWorklet.mjs` — codegen script
- `apps/client/scripts/bundleWorklet.mjs` — bundle orchestrator
- `apps/client/scripts/extractBundle.mjs` — mjs→ts converter
- `apps/client/app/swarm-client.bundle.mjs` — bare-pack output (committed)
- `apps/client/src/worklet/swarmWorkletBundle.ts` — bundle loader
- `apps/client/src/worklet/swarmWorkletBundle.test.ts` — 8 integration tests

**Files modified**:
- `apps/client/package.json` — added `bundle:worklet` script, `bare-pack` devDep
- `apps/client/.gitignore` — ignores generated files
- `apps/client/src/services/workletBridge.ts` — uses bundle
- `apps/client/src/services/workletBridge.test.ts` — mocks bundle import

**Tests**: 31 passing (5 suites)
- Bundle integrity: loads as string, contains BareKit refs, constants inlined, no templates
- WorkletBridge: updated mocks for bundle import

#### Key Issues Resolved

1. **Syntax error** (first attempt): Double-quotes `''CONNECT_FAILED''`
   - Fix: Don't add quotes when replacing `${ErrorCode.X}` (already inside string literals)

2. **Metro import failure** (second attempt): Cannot import `.mjs` at runtime on iOS
   - Fix: Extract bundle to `.generated.ts` file that Metro can handle

#### Current State (2026-02-13, End of Session 4)

- ✅ Bundle generated successfully (636 KB)
- ✅ All tests passing (31 tests, 5 suites)
- ✅ Constants properly inlined (no double-quotes, no unresolved templates)
- ✅ Metro-compatible TypeScript wrapper created
- ⏳ **Awaiting iOS simulator runtime test** — user to verify worklet loads and connects
- 📝 Feature branch: `feature/bare-pack-worklet-bundle`
- 📝 Commit: `1cbbd4a` (committed but not pushed)

#### Commands for Next Session

**Regenerate bundle** (if worklet source changes):
```bash
cd apps/client
npm run bundle:worklet
```

**Run tests**:
```bash
cd apps/client
npm test
```

**iOS simulator test**:
```bash
npm run start --prefix apps/client -- --clear
xcrun simctl uninstall booted com.anonymous.client && npm run ios --prefix apps/client -- --no-build-cache --no-bundler
```

## Future Consideration
- Consider upstreaming the hyperdht fix (`npx patch-package hyperdht --create-issue`)
- Bundle staleness detection (optional CI check to warn if source changed but bundle not regenerated)
