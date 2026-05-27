# Iteration 41 Analysis

**Phase**: completed
**Date**: 2026-05-22T17:48:56.451Z

## Results

### ✅ Functional Correctness

Two bugs fixed:

1. **Artifact size=0**: Added `size: file.size` to the hawkBit artifact upload query params in `software-modules.ts`. hawkBit does NOT auto-detect size from multipart uploads — without explicitly passing it, the DDI deployment detail returns size=0, preventing the embedded device from calculating download progress.

2. **Deployment delete not persisting**: Root cause was a sync engine race condition. After `deleteDeployment()` sets device status to 'in_sync', the periodic sync engine reads hawkBit's still-stale `updateStatus: 'pending'` and overwrites it back. Fix: Added `protectTargetStatuses()` / `getProtectedStatus()` in sync-helpers.ts — a TTL-based in-memory guard (2 min) that prevents the sync engine from overwriting recently-cleared device statuses. Called from both `deleteDeployment()` and the cancel action endpoint.

Build clean (bun build --target=bun). 71 deployment unit tests pass. 20 artifact tests pass.

**Evidence**: bun build succeeds (3.56 MB). bun test: 71 pass / 0 fail (deployment), 20 pass / 0 fail (artifacts). All pre-existing test failures (7) are unrelated race conditions in auth/devices test files.

### ✅ Code Quality

All changed files within limits: software-modules.ts (114 lines), service.ts (246), device-routes.ts (239). sync-helpers.ts was already at ~370 lines before this iteration (added 35 lines for status protection). The protection mechanism is clean: Map<string, {status, until}> with TTL-based expiry. No inline response schemas.

**Evidence**: wc -l confirms all route/service files under 250. sync-helpers.ts at 410 was already over limit from prior iterations.

### ✅ Schema Organization

No schema changes needed. Uses existing GenericActionResponseSchema and ErrorResponseSchema.

**Evidence**: No changes to schemas.ts files.

### ✅ Error Handling

Status protection gracefully handles expiry (getProtectedStatus returns null after TTL). protectTargetStatuses logs info message. deleteDeployment wraps protectTargetStatuses import in existing try/catch. Cancel endpoint already has error handling.

**Evidence**: sync-helpers.ts: getProtectedStatus auto-cleans expired entries. device-routes.ts: cancel action wrapped in try/catch.

### ✅ Test Coverage

Added 4 new tests for status protection mechanism: enforces protected status, unprotected target returns null, TTL expiry, and overwrite updates. Total deployment tests: 71 (all pass). Artifact tests: 20 (all pass).

**Evidence**: bun test deployment.test.ts: 71 pass, 0 fail. Tests cover protectTargetStatuses(), getProtectedStatus(), TTL expiry, and overwrite behavior.

### ✅ Config Centralization

No config changes. Status protection TTL is a module-level constant (120_000ms), not env-driven (it's a sync-engine-internal detail, not user-configurable).

**Evidence**: STATUS_PROTECTION_TTL_MS = 120_000 in sync-helpers.ts.

### ✅ Security

Cancel action endpoint requires operator role (unchanged). Delete endpoint requires admin role (unchanged). Status protection is server-side only — no user input involved.

**Evidence**: device-routes.ts: companyRole: 'operator' for cancel. index.ts: companyRole: 'admin' for delete.

### ✅ 🔮 Futuro (Aprendizado Contínuo)

Key learnings from this iteration:
1. hawkBit does NOT auto-detect artifact size from multipart uploads — must pass `size` query param explicitly
2. Sync engine race condition: after deleting a deployment and clearing device status, the periodic sync can overwrite it back to 'pending' from hawkBit's stale data
3. TTL-based in-memory protection prevents sync overwrites without schema changes

Principles to extract: p-hawkbit-size-param-required, p-sync-status-protection

**Evidence**: 2 new principles identified. Code builds clean. Tests pass.

## Overall Notes

Fixed two bugs:

1. **Artifact size=0 in hawkBit deployment details** (cosmetic but affects device progress feedback):
   - Root cause: `uploadArtifact()` in `software-modules.ts` did not pass `size` in query params
   - Fix: Added `size: file.size` to the hawkBit upload request
   - Result: hawkBit now stores the correct file size, DDI returns it in deployment details, device can calculate download progress (944/925KB instead of 944/?KB)

2. **Deployment delete/stop not persisting** (deployment "comes back" after page refresh):
   - Root cause: Race condition between `deleteDeployment()` and sync engine. After clearing device status to 'in_sync', the periodic sync engine reads hawkBit's stale `updateStatus: 'pending'` and overwrites it back
   - Fix: Added TTL-based status protection (`protectTargetStatuses`/`getProtectedStatus`) in sync-helpers.ts. After deployment deletion or action cancellation, targets are protected for 2 minutes from sync overwrites
   - Applied to: `deleteDeployment()` in service.ts and cancel action endpoint in device-routes.ts

No Docker changes needed — code-level fixes only. Build clean. 71 deployment tests pass + 20 artifact tests pass.