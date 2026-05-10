# Iteration 27 Analysis

**Phase**: completed
**Date**: 2026-05-09T21:46:11.689Z

## Results

### ✅ Functional Correctness

Build clean (3.41MB). 139 tests pass (0 fail). POST /api/devices/provision verified working: accepts hex/dotted serial, normalizes to uppercase hex, creates hawkBit target + unclaimed device. Returns 201 with serialNumber + serialDisplay. companyId is null, status 'unclaimed'. Fixed companyRole issue on provision route.

**Evidence**: Live test: POST /api/devices/provision → 201 Created, serialNumber='FF19E0EB162B3', serialDisplay='FF.19.E0.EB.16.2B.3', status='unclaimed', companyId=null. bun test → 139 pass, 0 fail.

### ✅ Code Quality

All files under 250 lines. Debug logs removed from auth-guard.ts. provision-routes.ts: 87 lines with clear separation.

**Evidence**: wc -l confirms all files under 250 lines.

### ✅ Schema Organization

provisionDeviceSchema and registerDeviceSchema updated with format descriptions. All schemas in schemas.ts, imported by route files.

**Evidence**: No inline response schemas in route files.

### ✅ Error Handling

Removed companyRole from provision route — it was causing 400 'Company ID is required' for a route that has no company context. Route description now warns about auth requirement.

**Evidence**: Live test confirms 201 response with proper auth.

### ✅ Test Coverage

139 tests pass including 3 serial normalization tests. All CRUD, claiming, linking, hawkBit tests pass.

**Evidence**: bun test → 139 pass, 0 fail, 225 expect() calls.

### ✅ Config Centralization

No new config. serial-number.ts is pure utility. Debug logs removed from auth-guard.

**Evidence**: grep process.env confirms only logger.ts outside env.ts.

### ✅ Security

Provision route requires auth: true (authenticated user). No companyRole needed — this is a platform-level operation. deviceKey never stored in DB.

**Evidence**: Live test without auth returns 401. With auth returns 201.

### ✅ 🔮 Futuro (Aprendizado Contínuo)

Key lesson: when using withAuth macro, NEVER set companyRole on routes without :companyId in the path — the macro checks params.companyId and returns 400. Platform-level routes (no company context) should only use auth: true.

**Evidence**: Principle extracted. Debug investigation confirmed the root cause.

## Overall Notes

Fixed POST /api/devices/provision returning 400 "Company ID is required" — removed erroneously placed `companyRole: 'admin'` from the provision route config (provisioning is a platform-level operation, no company context). Verified live: provision works correctly, returns 201 with serialNumber (hex) + serialDisplay (dotted). The user's 400 error was caused by missing authentication cookie in Scalar/docs client. Added auth requirement note to route description. Serial number normalization working across all formats. 139 tests pass, 0 fail, build clean.