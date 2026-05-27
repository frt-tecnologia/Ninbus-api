# Analysis: Two Critical Bugs

## Problem 1: Device connection status not reflected in API

### Root Cause Analysis
**Hypothesis 1 (CONFIDENCE: 95%): GET /devices list endpoint returns ONLY local DB data — no hawkBit enrichment**

Evidence:
- `getCompanyDevices()` in service.ts returns raw `db.select().from(devices)` — no hawkBit data
- The list route at `index.ts` line ~54 just calls `service.getCompanyDevices(params.companyId)` and returns it directly
- hawkBit connection data (pollStatus, updateStatus, ipAddress, lastRequestAt) is NEVER fetched for the list view
- Only `GET /:deviceId` (detail view) calls `syncDeviceStatusFromHawkbit()` — but this is only for a single device
- `DeviceSyncEngine.syncAcceptedStatus()` only updates `lastSeenAt` in the local DB — it doesn't store connection status, update status, firmware info, or IP address
- The `syncCompany()` is ONLY called from `deployments/service.ts` when creating a deployment — NOT during device listing

**Hypothesis 2 (CONFIDENCE: 80%): The local DB doesn't have columns for hawkBit connection data**

Evidence:
- The `devices` table has: `status` (enum: unclaimed/pending/accepted/rejected/preauthorized/decommissioned), `lastSeenAt`
- NO columns for: `connectionStatus`, `updateStatus`, `ipAddress`, `installedAt`, `currentFirmware`, `pollStatus`
- Even if we synced from hawkBit, there's nowhere to persist the data

### Fix Plan for Problem 1:
1. Add columns to devices table: `connectionStatus`, `updateStatus`, `ipAddress`, `lastPollAt`
2. Modify `syncAcceptedStatus()` to store ALL relevant hawkBit data locally
3. Enrich `GET /devices` list response with hawkBit connection data
4. Call sync before device list fetch

## Problem 2: Artifact upload 409 + Flutter type mismatch

### Root Cause Analysis
**Hypothesis 1 (CONFIDENCE: 99%): Software Module name+version must be unique in hawkBit — re-uploading same name throws 409**

Evidence:
- Error: `EntityAlreadyExistsException` on POST /rest/v1/softwaremodules
- hawkBit enforces uniqueness on (name, version, type) combination for Software Modules
- The upload code in `uploadArtifact()` always creates a new SM — never checks if one exists
- If user uploads with same name "express-teste" version "1.0" type "configuration-nfx" again → 409

**Hypothesis 2 (CONFIDENCE: 95%): Flutter client casts hawkBit timestamp numbers as Strings**

Evidence:
- hawkBit returns `createdAt: 1778505428971` (epoch millis as number)
- API schema `SoftwareModuleSchema` defines `createdAt: t.Optional(t.Number())` — returns number
- Flutter error: `type 'int' is not a subtype of type 'String' in type cast`
- The Flutter model likely defines `createdAt` as `String` expecting ISO date
- The API should convert hawkBit epoch timestamps to ISO date strings for consistency

### Fix Plan for Problem 2:
1. Handle 409 in artifact upload: check if SM already exists, return proper error with suggestion
2. Convert hawkBit epoch timestamps (numbers) to ISO date strings in the API response
3. Add proper error handling for HawkbitApiError in artifact routes (catch 409 → 409 to client)
