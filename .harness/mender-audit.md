# Mender Integration Audit — Discrepancies Found
# E:/develop/mender-server (READ-ONLY) vs E:/develop/Ninbus-api

## CRITICAL ISSUES

### 1. Per-Device Deployment Abort — WRONG HTTP Method and Path
- **Ninbus backend**: PUT /api/management/v1/deployments/deployments/{id}/devices/{deviceId}/status body={status:"aborted"}
- **Mender reality**: DELETE /api/management/v1/deployments/deployments/devices/{id}
  - Routing: `mgmtV1.DELETE(ApiUrlManagementDeploymentsDeviceId, controller.AbortDeviceDeployments)`
  - ApiUrlManagementDeploymentsDeviceId = "/deployments/devices/:id"
  - No body required — just DELETE the device deployment
- **Status**: 200/204 on success (device deployments aborted)
- NOTE: This aborts ALL deployments for a device, not one specific deployment

### 2. Artifact Upload — Missing Pre-signed URL Flow
- **Ninbus backend**: Direct multipart upload via POST /api/management/v1/deployments/artifacts
- **Mender reality**: TWO upload modes:
  a) **Direct multipart** (legacy): POST /artifacts with multipart/form-data — works but proxies file through API
  b) **Pre-signed URL** (recommended): POST /artifacts/directupload → returns {id, upload_url, ...} → PUT to S3 URL → POST /artifacts/directupload/{id}/complete
- **The direct upload works** but is less efficient for large files
- **Config flag**: `EnableDirectUpload` controls whether pre-signed flow is available
- **Recommendation**: Keep direct upload for now, add pre-signed later for files >100MB

### 3. Device Preauthorize — Wrong request body field names
- **Ninbus backend**: `{identity_data: {...}, pubkey: "..."}` 
- **Mender reality**: Correct! PreAuthSet has `identity_data` and `pubkey` — MATCHES
- **Status**: ✅ OK

## NON-CRITICAL ISSUES

### 4. Releases v2 API path
- **Ninbus backend**: GET /api/management/v2/deployments/deployments/releases
- **Mender routing**: `mgmtV2.GET(ApiUrlManagementV2Releases, controller.ListReleasesV2)`
- ApiUrlManagementV2Releases = "/deployments/releases"
- **Status**: ✅ CORRECT

### 5. Releases v2 set tags path
- **Ninbus backend**: PUT /api/management/v2/deployments/deployments/releases/{name}/tags
- **Mender routing**: `mgmtV2.PUT(ApiUrlManagementV2ReleaseTags, controller.PutReleaseTags)`
- ApiUrlManagementV2ReleaseTags = "/deployments/releases/:name/tags"
- **Status**: ✅ CORRECT

### 6. Deployment creation — device list format
- **Ninbus backend**: POST body `{name, artifact_name, devices: ["id1","id2"]}`
- **Mender routing**: POST /deployments body has `devices` array of device IDs
- **Status**: ✅ CORRECT

### 7. Deployment statistics
- **Ninbus backend**: GET /deployments/{id}/statistics
- **Mender routing**: `mgmtV1.GET(ApiUrlManagementDeploymentsStatistics, controller.GetDeploymentStats)`
- **Status**: ✅ CORRECT

### 8. Device decommission
- **Ninbus backend**: DELETE /api/management/v2/devauth/devices/{id}
- **Mender routing**: `mgmtAPIV2.DELETE(v2uriDevice, d.DecommissionDeviceHandler)`
- v2uriDevice = "/devices/:id"
- **Status**: ✅ CORRECT

### 9. Device Auth Set Status (approve/reject)
- **Ninbus backend**: PUT /api/management/v2/devauth/devices/{id}/auth/{aid}/status body={status:"accepted"}
- **Mender routing**: `mgmtAPIV2.PUT(v2uriDeviceAuthSetStatus, d.UpdateDeviceStatusHandler)`
- **Valid transitions**: pending→accepted, pending→rejected, rejected→accepted, accepted→rejected
- **Response**: 204 No Content (NOT 200)
- **Status**: ✅ CORRECT (but Ninbus should expect 204 not 200)

### 10. Device Connect check-update
- **Ninbus backend**: POST /api/management/v1/deviceconnect/devices/{id}/check-update
- **Mender routing**: `publicAPI.POST(APIURLManagementDeviceCheckUpdate, management.CheckUpdate)`
- APIURLManagementDeviceCheckUpdate = "/api/management/v1/deviceconnect/devices/:deviceId/check-update"
- Returns 202 Accepted (NOT 200)
- **Status**: ✅ Path correct, but response code is 202

### 11. Device Connect get device (connection state)
- **Ninbus backend**: GET /api/management/v1/deviceconnect/devices/{id}
- **Mender routing**: `publicAPI.GET(APIURLManagementDevice, management.GetDevice)`
- APIURLManagementDevice = "/api/management/v1/deviceconnect/devices/:deviceId"
- Returns device model with status field
- **Status**: ✅ CORRECT

### 12. Inventory — list devices
- **Ninbus backend**: GET /api/management/v1/inventory/devices
- **Mender routing**: `mgmtAPIV1.GET(uriDevices, mgmtHandler.GetDevicesHandler)`
- uriDevices = "/devices"
- **Status**: ✅ CORRECT

### 13. Inventory — get device
- **Ninbus backend**: GET /api/management/v1/inventory/devices/{id}
- **Mender routing**: `mgmtAPIV1.GET(uriDevice, mgmtHandler.GetDeviceHandler)`
- uriDevice = "/devices/:id"
- **Status**: ✅ CORRECT

### 14. Inventory — set device group
- **Ninbus backend**: PUT /api/management/v1/inventory/devices/{id}/group body={group:"name"}
- **Mender routing**: `mgmtAPIV1.PUT(uriDeviceGroups, mgmtHandler.AddDeviceToGroupHandler)`
- uriDeviceGroups = "/devices/:id/group"
- **Status**: ✅ CORRECT

### 15. Inventory — set device tags
- **Ninbus backend**: PUT /api/management/v1/inventory/devices/{id}/tags body=[{name,value}]
- **Mender routing**: `mgmtAPIV1.PUT(uriDeviceTags, mgmtHandler.UpdateDeviceTagsHandler)`
- uriDeviceTags = "/devices/:id/tags"
- **Body format**: Mender expects `{"attributes":[{"name":"tag_name","value":"tag_value"}]}` (object with attributes array)
  OR an array directly — need to verify
- **Status**: ⚠️ Needs body format verification
