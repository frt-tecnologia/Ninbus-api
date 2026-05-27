# Fix Summary — Final

## Problem 1: Device connection status not reflected in API ✅ FIXED

### Root Cause
GET /devices returned ONLY local DB data — no hawkBit enrichment. The sync engine only updated `lastSeenAt`, missing connection status, update status, IP address, firmware info.

### Changes
1. **New DB columns**: `connectionStatus`, `hawkbitUpdateStatus`, `ipAddress`, `lastPollAt`, `nextExpectedPollAt`
2. **Rewritten `DeviceSyncEngine`** (`sync.ts`): syncs ALL hawkBit target data (pollStatus, updateStatus, IP) to local DB
3. **GET /devices list** now calls `syncCompany()` before listing → hawkBit data always fresh
4. **GET /devices/:id detail** calls `syncSingleDevice()` → re-fetches from DB with updated data
5. **Migration applied** to both Neon databases (dev + Docker)

### How it works for FF32FF51FFF1FFFF:
When the user lists devices, the sync engine:
1. Fetches ALL hawkBit targets in ONE API call
2. Matches `FF32FF51FFF1FFFF` by controllerId = serialNumber
3. Updates: status → `accepted`, connectionStatus → `connected`/`disconnected`, hawkbitUpdateStatus → `registered`, ipAddress → `172.19.0.1`, lastPollAt → timestamp
4. Returns enriched data from local DB (no N+1 calls)

## Problem 2: Artifact upload 409 + Flutter type mismatch ✅ FIXED

### Root Cause
1. hawkBit 409 EntityAlreadyExistsException became unhandled 500 error
2. hawkBit returns epoch millis (number) but Flutter expected ISO date string

### Changes
1. **Pre-upload duplicate check**: queries hawkBit for existing SM with same name+version+type before creating
2. **409 response**: returns `{"error":"Conflict","message":"An artifact named...","code":"ALREADY_EXISTS"}`
3. **Global HawkbitApiError handler** in `app.ts`: 409→409, 404→404, other→502
4. **Timestamp conversion**: `enrichSoftwareModule()` converts epoch millis → ISO date strings
5. **Schema**: `createdAt` and `lastModifiedAt` use `dateTimeString` (t.Date()) instead of t.Number()

### Verified:
- Upload duplicate: `409 Conflict` with clear message ✅
- Upload new: `201 Created` ✅
- List artifacts: timestamps as `"2026-05-11T13:17:08.971Z"` (not `1778505428971`) ✅
- Delete artifact: `200 OK` ✅

## Files Changed
| File | Change |
|------|--------|
| `src/common/db/schema/devices.ts` | +5 hawkBit sync columns + hawkbitUpdateStatusEnum |
| `src/modules/devices/sync.ts` | Complete rewrite — full hawkBit data sync |
| `src/modules/devices/index.ts` | List calls syncCompany, detail calls syncSingleDevice |
| `src/modules/devices/schemas.ts` | lastPollAt/nextExpectedPollAt timestamp overrides |
| `src/modules/artifacts/service.ts` | Pre-upload 409 check + epoch→ISO conversion |
| `src/modules/artifacts/schemas.ts` | dateTimeString for createdAt/lastModifiedAt |
| `src/modules/artifacts/index.ts` | 409 response handling |
| `src/app.ts` | Global HawkbitApiError handler (409, 404, 502) |
| `drizzle/0007_hawkbit_sync_columns.sql` | Migration |

## Migration Applied
- ✅ Dev DB (ep-odd-dust-acapmk9r)
- ✅ Docker DB (ep-dry-voice-acl3s09t)
- ✅ Docker image rebuilt with `--no-cache`
- ✅ Container restarted and verified
