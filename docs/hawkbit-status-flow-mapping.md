# hawkBit DDI Status Flow Mapping

## 1. Device Feedback via DDI

The device sends feedback to hawkBit via DDI:

```
POST /{tenant}/controller/v1/{controllerId}/deploymentBase/{actionId}/feedback?exec={0|1}
```

**`?exec=` rule:**
- `0` = download phase
- `1` = install/finalization phase

## 2. Feedback Fields

| Field | Values | Description |
|-------|--------|-------------|
| `execution` | `proceeding`, `canceled`, `scheduled`, `rejected`, `closed`, `downloaded` | Current execution state |
| `result.finished` | `none`, `success`, `failure` | Completion result |

## 3. hawkBit Action Status Types

hawkBit stores feedback as action status entries with these types:

`retrieved` | `running` | `download` | `downloaded` | `finished` | `error` | `warning` | `canceled` | `canceling` | `cancel_rejected` | `scheduled` | `wait_for_confirmation`

## 4. Complete Mapping Table (DDI → API → Frontend)

| execution | result.finished | ?exec= | hawkBit type | API phase | Status UI |
|-----------|----------------|--------|--------------|-----------|-----------|
| `proceeding` | `none` | 0 | running | downloading | Downloading |
| `download` | `none` | 0 | download | downloading | Downloading (regex `downloading (\d+)%`) |
| `downloaded` | `none` | 0 | downloaded | downloaded | Downloaded |
| `proceeding` | `none` | 1 | running | installing | Installing |
| `closed` | `success` | 1 | finished | installed | Installed |
| `closed` | `failure` | 1 | error | error | Error |
| (no feedback) | -- | -- | retrieved | pending | Pending |
| (server-side) | -- | -- | running | assigned | Assigned |

## 5. Lifecycle Timeline (Typical Happy Path)

```
assigned → pending → downloading → downloaded → installing → installed
```

With progress details during download:

```
assigned
  └─ running "Assignment initiated by admin"
pending
  └─ retrieved "Target retrieved update action"
downloading
  ├─ download "downloading artifact"
  ├─ running "downloading 25%"
  ├─ running "downloading 50%"
  ├─ running "downloading 75%"
  └─ (or download with regex: downloading (\d+)%)
downloaded
  └─ downloaded "download complete"
installing
  ├─ running "deployment started"
  ├─ running "processing artifact"
  └─ running "installing NFX to controller"
installed
  └─ finished "installed successfully"
```

## 6. Error Paths

| Scenario | hawkBit type | API phase | UI Status |
|----------|-------------|-----------|-----------|
| Download failed | error | error | Error |
| Install failed | error | error | Error |
| Cancel requested | canceling | canceled | Canceling |
| Cancel confirmed | canceled | canceled | Canceled |
| Cancel rejected | cancel_rejected | error | Error |

## 7. API Phase Values

The API returns a `phase` field in deployment status responses. Valid values:

| Phase | Meaning | UI Label |
|-------|---------|----------|
| `assigned` | DS assigned, target hasn't polled yet | Assigned |
| `pending` | Target polled (retrieved), device hasn't sent feedback | Pending |
| `downloading` | Device is downloading artifact | Downloading |
| `downloaded` | Download complete, waiting to install | Downloaded |
| `installing` | Device is installing artifact | Installing |
| `installed` | Installation completed successfully | Installed |
| `error` | Installation or download failed | Error |
| `canceled` | Deployment was canceled | Canceled |
| `unknown` | Status could not be determined | Unknown |

## 8. Deployment-Level Status (Aggregated)

Computed from hawkBit action statistics (counts per status type):

| Condition | Status |
|-----------|--------|
| All targets `finished` | `completed` |
| Any `error` or `warning` | `failed` |
| Any `retrieved`, `download`, `downloaded` | `in_progress` |
| All `running` or `scheduled` | `pending` |
| All `canceled` or `canceling` | `canceled` |
| No targets assigned | `no_targets` |

## 9. Relevant API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/companies/:companyId/deployments/:id/target-statuses` | All targets with phase + progress |
| `GET /api/companies/:companyId/deployments/:id/targets/:targetId/status-trail` | Full timeline per target |
| `GET /api/companies/:companyId/deployments/:id/statistics` | Aggregated statistics |
| `GET /api/companies/:companyId/deployments/:id/targets/:targetId/actions/:actionId/status` | Raw hawkBit action status history |
