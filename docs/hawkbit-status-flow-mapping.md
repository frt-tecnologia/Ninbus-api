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

## 5b. Firmware-Ninbus Self-Update Lifecycle (STM32F407 — has REBOOT)

Unlike NFX/controller, updating the Ninbus's own firmware reboots the device so
the bootloader can flash `0x08008000`. The sequence adds a **`rebooting`** phase
between `installing` and `installed`. The UI must treat the R9→R10 gap
(~15–40 s) as "reiniciando / aplicando", never as a stall.

```
assigned → pending → downloading → downloaded → installing → rebooting ──► REBOOT ──► installed | error
```

| # | execution | result.finished | ?exec= | hawkBit type | message                                  | API phase  |
|---|-----------|----------------|--------|--------------|------------------------------------------|------------|
| R3 | proceeding | none | 0 | running  | "deployment started"                       | installing |
| R4 | download   | none | 0 | download | "downloading artifact"                     | downloading|
| R5a-d | proceeding | none | 0 | running | "downloading 25%"/50%/75%/100%         | downloading|
| R6 | downloaded | none | 0 | downloaded | "download complete"                       | downloaded |
| R7 | proceeding | none | 1 | running  | "processing artifact"                      | installing |
| R8 | proceeding | none | 1 | running  | "staging firmware to NAND"                 | installing |
| R9 | proceeding | none | 1 | running  | "firmware staged, rebooting to apply"      | **rebooting** |
| —  | REBOOT     | —    | — | —        | (reset → bootloader → flash → boot)        | rebooting  |
| R10a | closed   | success | 1 | finished | "firmware installed successfully"      | installed  |
| R10b | closed   | failure | 1 | error    | "firmware was not applied by bootloader"| error      |

### Reboot gap (R9 → R10)

During reboot the device sends no feedback, so the **last entry stays R9** for
~15–40 s (reset + boot + WiFi reconnect). The sync engine keeps emitting
`device.action.status` with `phase: 'rebooting'` and `progress: null`; the
device simply reappears with `finished` (success) or `error` (failure). The
backend does NOT time this out as a failure — it waits for the post-reboot poll.

### Why `closed+success` is trustworthy (R10a)

`finished` only arrives after the bootloader verified the new application's
CRC16 at offset 1047 and jumped to it. So `phase: 'installed'` for a
firmware-ninbus deployment **guarantees** the firmware is truly running. If the
bootloader rejected the image, the device boots the OLD app and reports
`closed+failure` (`phase: 'error'`, "firmware was not applied by bootloader").

### Firmware-ninbus failure messages (all closed+failure → `error`)

- "download failed"
- "artifact processing failed"
- "firmware CRC invalid"
- "firmware staging failed"
- "firmware was not applied by bootloader"
- "unknown artifact type"

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
| `rebooting` | Firmware staged; device rebooting so the bootloader can flash (firmware-ninbus only) | Reiniciando |
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

## 10. Type Registration & Packaging (how the backend differentiates deployments)

The three artifact types are **fully independent** at every layer. There is no
shared DS type; each type has its own Software Module Type AND Distribution Set
Type, so a firmware-ninbus DS can only ever contain firmware-ninbus modules.

| header-info `type` (case-sensitive) | SM type key | DS type key | destination |
|--------------------------------------|-------------|-------------|-------------|
| `firmware-ninbus` | `firmware-ninbus` | `ninbus-firmware-ninbus` | STM32 flash via bootloader |
| `firmware-controller` | `firmware-controller` | `ninbus-firmware-controller` | LightDot via CAN |
| `configuration-nfx` | `configuration-nfx` | `ninbus-configuration-nfx` | LightDot NAND via CAN (gzip) |

- On `POST /artifacts`, `getOrCreateSoftwareModuleType(type)` creates the SM
  type (key = the type string) if missing, then the SM is created with that type.
- On `POST /deployments`, `getOrCreateDistributionSetType(type)` creates the DS
  type (`ninbus-<type>`) if missing and assigns the matching SM type as
  **mandatory**, then the DS is created with `type: dsTypeKey`.
- The device does **not** read the DS/SM type from hawkBit. It identifies the
  update path solely from `header-info/featureidentity.json` `{"type":"..."}`
  inside the `.tar`, and branches in its install switch-case. The backend's
  `tar-packager.ts` writes that file with the exact case-sensitive string.

### Tar packaging (identical for all three types)

```
artifact.tar          ← PLAIN tar (NOT .tar.gz — device gunzip is a stub)
├── header-info/featureidentity.json   → {"type":"firmware-ninbus"}
└── data/payload.bin                   → the raw firmware bytes (delivered verbatim via CloudFront)
```

### ⚠️ firmware-ninbus payload = post-CalcCRC `wifi3.fir`

The backend is NOT in the device download path. It uploads the tar to hawkBit
ONCE via the Management API; hawkBit's S3 extension stores it in the
`ninbus-artifacts` bucket, and the device later downloads it from CloudFront.
Nothing in that chain (upload → hawkBit → S3 → CloudFront → device) runs
`CalcCRC.exe` or modifies a single byte. So the `.fir` placed in `payload.bin`
MUST already be the post-CalcCRC image with the bootloader CRC16 at offset 1047
(read by the STM32 as `*(U16*)(0x08008000 + 1047)`). Uploading a raw pre-CRC
`.fir`, `.hex`, or `.axf` makes the bootloader reject the image and silently
keep the old firmware. The upload endpoint logs a warning when a firmware-ninbus
payload is < 1048 bytes (too small to carry the CRC), but cannot validate the
CRC value itself.

### Delivery via CloudFront — IDENTICAL to NFX (no new CDN config)

firmware-ninbus reuses the exact same CDN path as configuration-nfx and
firmware-controller. There is **no per-type CDN configuration**: the
`CdnArtifactUrlResolver` (a hawkBit-side Java extension) builds the download
URL from `tenant + "/" + sha1`, which is type-agnostic. As soon as a
firmware-ninbus tar is uploaded, it lands in the same S3 bucket
(`ninbus-artifacts`) and is served by the same CloudFront distribution.

```
Device download flow (same for all 3 types):
  STM32 → hawkBit DDI (poll) → deploymentBase w/ URL
        http://dxxx.cloudfront.net/DEFAULT/{sha1}?Signature=...&Key-Pair-Id=...
  STM32 → CloudFront (HTTP :80) → S3 (HTTPS via OAC) → tar bytes
  STM32 → hawkBit DDI (feedback)
```

Each uploaded firmware gets a unique SHA1, so CloudFront caches it under a new
key with no collision or invalidation needed. The device follows the
CloudFront URL transparently — it does not know or care that the bytes are
firmware-ninbus vs NFX.
