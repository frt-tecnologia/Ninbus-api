# Performance Optimization — Final Results

## Architecture: Background Sync Worker

### Before (Problem):
- `GET /devices` → `syncCompany()` → fetch ALL hawkBit targets → update ALL devices → return
- **Cost at 50k devices**: ~50 paginated API calls + 50k DB UPDATEs = **100+ seconds per request**
- Every user request blocked by sync

### After (Solution):
- Background worker syncs hawkBit → local DB every 30s (configurable)
- `GET /devices` → just `SELECT * FROM devices WHERE company_id=?` → instant
- **Cost at 50k devices**: ~100 API calls every 30s in background = 3.3 calls/sec average
- API requests: **0 hawkBit calls**, ~5ms DB query

### Key Components:

1. **Background Sync Worker** (`sync.ts`):
   - `startBackgroundSync()` — starts periodic timer
   - `runFullSync()` — paginated hawkBit fetch + batch DB update
   - `stopBackgroundSync()` — graceful shutdown
   - Uses `fetchAllHawkBitTargets()` with pagination (500 per page)
   - Auto-discovers new targets, links pending devices

2. **Stale-While-Revalidate** for single device:
   - `syncSingleDevice()` only calls hawkBit if data is >60s old
   - Otherwise returns cached local data

3. **Configuration** (env vars):
   - `HAWKBIT_SYNC_INTERVAL_SEC=30` — sync frequency
   - `HAWKBIT_SYNC_STALE_SEC=60` — stale threshold for on-demand

4. **Health Check** includes sync state:
   ```json
   {"sync":{"lastSyncAt":"...","isRunning":false,"devicesSynced":1,"lastDurationMs":1362,"errors":0}}
   ```

### Measured Performance (3 hawkBit targets):
- Full sync: **1.3s** per cycle
- API device list: **0 hawkBit calls** (instant DB read)
- Memory: negligible (processes in chunks of 100)

### Projected Performance at 50k devices:
- Full sync: ~100 paginated hawkBit calls (~10s) + 50k DB updates in 500 batches (~30s)
- Total per cycle: ~40s, running every 30s → slight overlap, self-throttles with `isRunning` guard
- API requests: still **0 hawkBit calls**, ~10ms DB query with index
- **Recommendation**: increase `HAWKBIT_SYNC_INTERVAL_SEC` to 60-120s for 50k+ fleets

## Files Changed
| File | Change |
|------|--------|
| `src/modules/devices/sync.ts` | Complete rewrite — background worker + batch ops |
| `src/modules/devices/index.ts` | Removed on-request sync, reads from local DB only |
| `src/modules/health/index.ts` | Added sync state to health check |
| `src/common/config/env.ts` | Added HAWKBIT_SYNC_INTERVAL_SEC, HAWKBIT_SYNC_STALE_SEC |
| `src/common/config/hawkbit.ts` | Added syncIntervalSec, syncStaleSec accessors |
| `src/app.ts` | Start background sync on startup |
| `src/index.ts` | Stop background sync on shutdown |
| `.env.example` | Added sync config vars |
| `.env.docker` | Added sync config vars |
