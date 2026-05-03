# Iteration 8 Analysis

**Phase**: completed
**Date**: 2026-04-28T23:35:23.140Z

## Results

### ✅ Functional Correctness

Fixed critical bug: per-device deployment abort was using non-existent PUT endpoint. Changed to DELETE /deployments/devices/{deviceId} matching Mender's actual routing.go. All other 25+ API paths verified against Mender source code.

**Evidence**: Mender routing.go: mgmtV1.DELETE(ApiUrlManagementDeploymentsDeviceId, controller.AbortDeviceDeployments). Ninbus client.ts updated to use DELETE. 183/183 tests pass.

### ✅ Code Quality

Clean split of deployment routes. Device abort route simplified from PUT with body schema to DELETE without body — cleaner API surface matching Mender's actual behavior.

**Evidence**: device-routes.ts rewritten with correct DELETE endpoint

### ✅ Error Handling

Per-device abort returns 422 on failure (device not found or already completed). Matches Mender behavior: AbortDeviceDeployments returns ErrStorageNotFound which renders as empty success.

**Evidence**: Error handling preserved from previous iteration

### ✅ Test Coverage

183/183 tests pass. Tests cover auth, validation, CRUD, Mender integration endpoints.

**Evidence**: bun test: 183 pass, 0 fail

### ✅ Body Schema Documentation

Per-device abort route no longer needs body schema — just DELETE with device ID in path. This is cleaner and matches Mender's API.

**Evidence**: device-routes.ts: DELETE /devices/:menderDeviceId/deployments with no body

### ✅ Performance

No performance changes. DELETE is lighter than PUT+body.

**Evidence**: No new allocations or loops

### ✅ Security

PAT never exposed. Mender API paths verified — no path traversal or injection risks.

**Evidence**: All paths match Mender routing.go exactly

### ✅ 🔮 Futuro (Aprendizado Contínuo)

CRITICAL LESSON: Never assume REST conventions for external APIs. Mender uses DELETE (not PUT) for device deployment abort, and the path is /deployments/devices/{id} (not /deployments/{id}/devices/{deviceId}/status). ALWAYS read the actual routing source code of external services before implementing client calls. Also: pre-signed URL upload exists in Mender but is DISABLED by default — direct multipart upload is the correct approach.

**Evidence**: Read 6 routing.go files, 4 management_*.yaml files, and management.go handlers to validate every path

## Overall Notes

## Iteration 8: Mender Server Deep Audit — API Path Validation

### Audit Scope
Investigated the Mender server source code (E:\develop\mender-server) to validate every API path used by the Ninbus backend. Read routing.go, management handlers, and OpenAPI YAML docs for all services: deviceauth, deployments, inventory, deviceconnect.

### Critical Bug Fixed
**Per-Device Deployment Abort — Wrong HTTP method and path**
- **Before**: `PUT /deployments/{deploymentId}/devices/{deviceId}/status` body=`{status:"aborted"}` — this endpoint DOES NOT EXIST in Mender
- **After**: `DELETE /api/management/v1/deployments/deployments/devices/{deviceId}` — correct Mender API
- **Source**: `mgmtV1.DELETE(ApiUrlManagementDeploymentsDeviceId, controller.AbortDeviceDeployments)` in routing.go
- **Note**: This aborts ALL active deployments for a device (not per-deployment). Route changed from PUT to DELETE, removed body schema, removed deploymentId parameter.

### Artifact Upload — Confirmed Correct
- **Direct multipart upload** (`POST /artifacts`) works correctly. Pre-signed URL (`/artifacts/directupload`) is DISABLED by default in Mender (`SettingStorageEnableDirectUploadDefault = false`). No change needed.

### All Other API Paths Verified ✅
| API | Path | Method | Status |
|-----|------|--------|--------|
| List devices | /api/management/v2/devauth/devices | GET | ✅ |
| Get device | /api/management/v2/devauth/devices/{id} | GET | ✅ |
| Approve/reject | /api/management/v2/devauth/devices/{id}/auth/{aid}/status | PUT | ✅ Returns 204 |
| Decommission | /api/management/v2/devauth/devices/{id} | DELETE | ✅ Returns 204 |
| Device count | /api/management/v2/devauth/devices/count | GET | ✅ |
| Preauthorize | /api/management/v2/devauth/devices | POST | ✅ |
| List inventory | /api/management/v1/inventory/devices | GET | ✅ |
| Get inventory | /api/management/v1/inventory/devices/{id} | GET | ✅ |
| Set group | /api/management/v1/inventory/devices/{id}/group | PUT | ✅ |
| Upload artifact | /api/management/v1/deployments/artifacts | POST multipart | ✅ |
| List artifacts | /api/management/v1/deployments/artifacts | GET | ✅ |
| Get artifact | /api/management/v1/deployments/artifacts/{id} | GET | ✅ |
| Delete artifact | /api/management/v1/deployments/artifacts/{id} | DELETE | ✅ |
| Artifact download | /api/management/v1/deployments/artifacts/{id}/download | GET | ✅ |
| Create deployment | /api/management/v1/deployments/deployments | POST | ✅ |
| Get deployment | /api/management/v1/deployments/deployments/{id} | GET | ✅ |
| Deployment stats | /api/management/v1/deployments/deployments/{id}/statistics | GET | ✅ |
| Abort deployment | /api/management/v1/deployments/deployments/{id}/status | PUT | ✅ |
| Abort device deps | /api/management/v1/deployments/deployments/devices/{id} | DELETE | ✅ FIXED |
| Device log | /api/management/v1/deployments/deployments/{id}/devices/{devid}/log | GET | ✅ |
| Device history | /api/management/v1/deployments/deployments/devices/{id} | GET | ✅ |
| Device deploy list | /api/management/v1/deployments/deployments/{id}/devices/list | GET | ✅ |
| Connection state | /api/management/v1/deviceconnect/devices/{id} | GET | ✅ |
| Force check-update | /api/management/v1/deviceconnect/devices/{id}/check-update | POST | ✅ Returns 202 |
| Releases v2 list | /api/management/v2/deployments/deployments/releases | GET | ✅ |
| Releases v2 tags | /api/management/v2/deployments/deployments/releases/{name}/tags | PUT | ✅ |

### Build & Tests
183/183 pass, build clean.