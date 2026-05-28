---
name: ninbus-api-standards
description: >
  Padrões para o Ninbus API (Bun + Elysia + Drizzle + Better Auth + hawkBit 1.0.3).
---

# Ninbus API — Padrões

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Bun ≥1.3 |
| Framework | Elysia.js |
| ORM | Drizzle ORM + postgres.js |
| Auth | Better Auth (cookie sessions) |
| OTA | Eclipse hawkBit 1.0.3 |
| Validação | TypeBox (via Elysia) |
| Logging | Pino (JSON em prod) |

## Arquitetura

```
Frontend → Ninbus API → hawkBit Management (Basic Auth)
               │              │
               │              └── DDI (TargetToken, device polling)
               │
               └── PostgreSQL (Neon)
```

**Módulos:** Auth · Companies · Categories · Devices · Deployments · Artifacts · Health

### Estrutura de Diretórios

```
src/
├── index.ts              # Entry + graceful shutdown
├── app.ts                # Composition root
├── common/
│   ├── config/           # env.ts (fonte única), hawkbit.ts, auth.ts
│   ├── db/schema/        # auth, companies, categories, devices, posts
│   ├── hawkbit/          # client.ts, http.ts, targets.ts, distribution-sets.ts, software-modules.ts
│   ├── middleware/        # auth-guard, company-guard, rate-limiter, logger, request-logger
│   ├── schemas/          # ErrorResponse, GenericActionResponse
│   ├── utils/            # serial-number normalization
│   └── swagger-config.ts  # OpenAPI/Scalar configuration (extracted from app.ts)
├── modules/
│   ├── auth/             # Better Auth routes
│   ├── companies/        # Multi-tenancy + RBAC + members
│   ├── categories/       # Device grouping
│   ├── devices/          # Registry + provisioning + hawkBit sync
│   │   ├── sync.ts          # Engine orchestrator (<150 lines)
│   │   ├── sync-core.ts     # Types, status protection, single-device sync
│   │   ├── sync-fetch.ts    # hawkBit paginated target queries
│   │   ├── sync-helpers.ts  # Batch DB ops, on-demand sync, re-exports
│   │   └── sync-strategies.ts # Periodic/hybrid strategies, SSE helpers
│   ├── deployments/      # OTA: index.ts, device-routes.ts, service.ts, actions.ts, enrichment.ts, schemas.ts
│   ├── artifacts/        # Firmware: index.ts, manage-routes.ts, service.ts, schemas.ts
│   ├── health/           # GET /health (sync state)
│   └── posts/            # CRUD reference
```

---

## Autorização — 3 Camadas

1. **`auth: true`** — qualquer usuário logado
2. **`superAdmin: true`** — emails em `SUPER_ADMIN_EMAILS` env var (não DB)
3. **`companyRole: 'viewer'`** — RBAC: owner > admin > operator > viewer

---

## Device Lifecycle

| Ação | Quem | hawkBit | DB Local |
|------|------|---------|----------|
| Provision | Any auth | Cria target | Cria device (unclaimed) |
| Claim | Company member | Nada | companyId set, status=accepted |
| Unclaim (DELETE from company) | Admin | **PRESERVADO** | companyId=null |
| Deprovision | Super admin | **DELETADO** | **DELETADO** |

---

## hawkBit Integration

### Conceitos

| hawkBit | Ninbus | Descrição |
|---------|--------|-----------|
| Target | Device | controllerId = serialNumber hex |
| Software Module | Artifact | Container tipado |
| Distribution Set | Deployment | Agrupa SMs, atribuído a targets |
| Action | Status por target | running→retrieved→download→downloaded→finished |
| DDI | Device polling | TargetToken auth |

### Deployment Status (computado de action statistics)

`RUNNING/SCHEDULED` → pending · `RETRIEVED/DOWNLOAD/DOWNLOADED` → in_progress · `FINISHED` → completed · `ERROR/WARNING` → failed · `CANCELED/CANCELING` → canceled

### createDeployment — Fluxo de 5 Etapas

1. **forceCloseActiveActions(ALL)** — cancela ações pré-existentes
2. **assignTargets** — atribui novo DS (cria update action). hawkBit body usa `type: 'forced'` (não `forceType`)
3. **forceCloseCancelActions(cancel-only)** — força close de ações cancel que ficaram em canceling
4. **verifyActiveUpdateAction** — verifica que cada target tem ação ativa. Para falhas, roda DDI diagnostic
5. **checkDDiReadiness** (se falhas) — diagnostica por que DDI não oferece deploymentBase

hawkBit PRIORIZA cancelAction sobre deploymentBase no DDI. Sem a etapa 3, o dispositivo NÃO vê o novo deployment.

### DDI Diagnostic Endpoint

`GET /api/companies/:companyId/deployments/:deploymentId/ddi-check/:targetId`
`GET /api/companies/:companyId/devices/:deviceId/ddi-check`

Verifica se o dispositivo receberia deploymentBase via DDI. Checa:
1. Target existe com securityToken correto
2. Ação update ativa existe
3. Ações cancel bloqueantes
4. DS completo (módulos com artefatos)
5. Status de conexão do target

Retorna `{ deploymentBaseOffered, cancelActionOffered, activeActions, updateStatus, issues[] }`

### Cancel Flow (Two-Step)

1. `DELETE /actions/{id}` (sem force) → type muda de "update" para "cancel", status = "canceling"
2. `DELETE /actions/{id}?force=true` → action inativa, status = "canceled" (só funciona após step 1)

**IMPORTANTE**: hawkBit muda o TYPE da mesma ação (não cria ação separada). Step 1 FALHA em ações type=cancel. Quando force=true, sempre executar step 2 independente do resultado de step 1. Para ações cancel-type, usar `forceQuitAction()` (pula step 1).

Se force=true ANTES do step 1 → hawkBit retorna 405 "not canceled yet".

### DDI Artifact Download

hawkBit DDI serve artefatos do storage backend (S3 ou filesystem).

- URL: `GET /{tenant}/controller/v1/{controllerId}/softwaremodules/{smId}/artifacts/{filename}`
- Auth: `Authorization: TargetToken {securityToken}`
- Só funciona com deployment ativo (action active=true). Após action completar/errar, DDI retorna 404.
- S3: hawkBit baixa do S3 e faz proxy para o device.
- Arquivo é armazenado como .tar (empacotado pela API antes do upload).

### Artifact Tar Packaging

O firmware embarcado (Ninbus v3) exige que o artefato seja um .tar com estrutura específica.
A API empacota automaticamente o arquivo raw (.frz, .fir, .bin) antes de enviar ao hawkBit.

**Fluxo:** `Frontend upload (.frz)` → `API empacota em .tar` → `hawkBit armazena .tar` → `DDI serve .tar` → `Device faz TarParser`

**Estrutura do .tar:**
```
header-info/
header-info/featureidentity.json     ← {"type": "configuration-nfx"}
data/
data/payload.bin                     ← arquivo raw original (.frz, .fir, .bin)
```

**Regras:**
- .tar plano (NÃO .tar.gz — decompressor é stub no device)
- Nomes de diretório EXATOS: `header-info` e `data`
- Nome do payload EXATO: `payload.bin`
- Tipos: `configuration-nfx`, `firmware-ninbus`, `firmware-controller`

**Código:** `src/modules/artifacts/tar-packager.ts` — usa `tar-stream` para gerar o .tar.

**API Response:** `size` = tamanho do .tar, `payloadSize` = tamanho do arquivo original.

### Artifact Naming — UUID-based

Software Module names are UUID-based (`sm-{uuid}`), NOT the user-provided filename.

**Why:** hawkBit enforces UNIQUE(name, version, type) constraint **including soft-deleted rows**.
This means:
1. After delete, hawkBit soft-deletes (deleted=true) but keeps the row
2. Re-uploading with same name fails with 409 "entity already exists"
3. Multiple companies uploading the same filename would conflict

**Solution:** Each upload gets `sm-{uuid}` as SM name. The user-visible name is stored in
the SM description as `artifactName: X | originalFile: Y | payloadBytes: N`.
`enrichSoftwareModule()` extracts and returns the display name via `extractDisplayName()`.

**Deployments:** Accept either numeric SM ID (recommended) or artifactName for backward compatibility.
`findSoftwareModule()` checks if input is numeric → uses directly, else searches by name.

**Delete:** `deleteArtifact()` verifies deletion by calling `get()` after delete. Handles hawkBit
soft-delete gracefully — logs warning if SM still active, returns success for 404 (already deleted).

### Deployment Lifecycle

1. **CREATE**: POST /deployments → cria DS + assigna targets → ação update criada
2. **DDI POLL**: Device polls GET /controller/v1/{id} → recebe deploymentBase
3. **DOWNLOAD**: Device baixa artefato via DDI artifact URL
4. **FEEDBACK**: Device envia feedback (retrieved → download → downloaded → finished/error)
5. **CANCEL**: DELETE /deployments/:id → force-close all actions → delete DS

Per-target phase mapping (DDI feedback → API phase → UI):
- `assigned` — DS assigned, target hasn't polled
- `pending` — Target retrieved, no feedback yet
- `downloading` — Download in progress (with progress %)
- `downloaded` — Download complete
- `installing` — Install in progress
- `installed` — Success (closed+success)
- `error` — Failure (closed+failure)
- `canceled` — Deployment canceled

See docs/hawkbit-status-flow-mapping.md for full DDI feedback table.

Status mapping: `running/scheduled` → pending · `retrieved/download/downloaded` → in_progress · `finished` → completed · `error/warning` → failed · `canceled/canceling` → canceled · `deleted DS` → canceled · `no actions` → no_targets · `stats fetch failed` → unknown · `total>0 no status keys` → pending (fallback)

### Background Sync

Worker sincroniza hawkBit → DB local a cada 30s. GET /devices faz ZERO chamadas hawkBit.

### SSE Events

**Endpoints:**
- `GET /api/companies/:companyId/sse` — Company-scoped SSE (auth + membership)
- `GET /api/sse/global` — Global SSE (auth only, receives ALL events, for admin)
- `POST /api/sse/test/:companyId` — Send test event to company SSE connections
- `POST /api/sse/simulate/:companyId` — Simulate SSE events for testing (body: {eventCount, intervalMs, eventType})
- `GET /api/sse/debug/connections` — Debug: list active SSE connections

**W3C SSE Format:**
```
id: 1
event: device.status
data: {"deviceId":"...","connectionStatus":"online"}

```

Eventos SSE emitidos para Flutter em tempo real:

| Evento | Dados | Quando |
|--------|-------|--------|
| `connected` | companyId, timestamp | Conexão SSE aberta |
| `heartbeat` | timestamp | A cada 30s |
| `device.status` | deviceId, connectionStatus, hawkbitUpdateStatus, lastPollAt, ipAddress | Sync cycle |
| `device.deployment` | deviceId, controllerId, status, message, timestamp | Sync: target pending |
| `device.claimed` | deviceId, action="claimed" | POST /devices/:id/register |
| `device.unclaimed` | deviceId, action="unclaimed" | DELETE /companies/:id/devices/:id |
| `deployment.created` | deploymentId, name, artifactType | POST /deployments |
| `deployment.deleted` | deploymentId | DELETE /deployments |
| `devices.batch` | count | Sync cycle |
| `test` | message, companyId, triggeredBy, timestamp | POST /api/sse/test/:companyId |

**Flutter SSE Parser — Critical Implementation Notes:**

1. **Line buffering is MANDATORY.** TCP chunks don't align with SSE event boundaries.
   The parser MUST buffer partial lines across chunks. Without buffering, events are
   silently dropped when a chunk boundary falls in the middle of an SSE line.
   ```dart
   // WRONG — splits each chunk independently, loses partial lines:
   for (final line in text.split('\n')) { ... }

   // CORRECT — buffer partial lines across chunks:
   final combined = lineBuffer + text;
   final lines = combined.split('\n');
   lineBuffer = lines.last;  // Keep partial line for next chunk
   for (int i = 0; i < lines.length - 1; i++) { ... }
   ```

2. **receiveTimeout MUST be Duration.zero for SSE.** Dio's default 30s timeout kills
   the long-lived SSE stream. Always override in Options:
   ```dart
   options: Options(
     responseType: ResponseType.stream,
     receiveTimeout: Duration.zero,  // Disable timeout for SSE
   )
   ```

3. **Strip \\r from lines.** Some HTTP transports/proxies normalize line endings to \\r\\n.

**Dio-based Flutter connection:**
```dart
final dio = await getDio(); // Cookie-managed Dio instance
final response = await dio.get<ResponseBody>(
  '/api/companies/$companyId/sse',
  options: Options(
    responseType: ResponseType.stream,
    receiveTimeout: Duration.zero,
    headers: {'Accept': 'text/event-stream'},
  ),
);
response.data!.stream.listen((chunk) {
  // Parse with line buffering (see above)
});
```

---

## Convenções de Código

- **Files < 250 linhas** — split em sub-arquivos quando necessário. Sync engine: sync-core + sync-fetch + sync-helpers + sync-strategies + sync
- **Response schemas** em `schemas.ts`, nunca inline em rotas. hawkBit proxy schemas: RawTargetListResponseSchema, RawDiagnosticResponseSchema, RawActionListResponseSchema
- ** hawkBit guard:** checar `hawkbitConfig.enabled` antes de qualquer chamada
- **Config:** TUDO por `env.ts`, nunca `process.env` direto (incluindo logger)
- ** hawkBit bulk POST:** body em array `[data]`, response é array → `arr[0]`
- ** hawkBit assign body:** campo `type` (NÃO `forceType`) para force type
- **Artifact upload:** `FormData` + `formData.append('file', file)`
- **DS names:** UUID-based (`ds-{uuid}`), nunca nomes legíveis. Display name extraído da descrição.
- **Logger:** `%s/%d/%j` format strings em hot-path. Template literals OK em startup logs.

---

## Tipos de Artefato

| Tipo | Destino | Risco | Reboot |
|------|---------|-------|--------|
| `firmware-ninbus` | STM32F407 | HIGH | ✅ |
| `firmware-controller` | LightDot | MED | ❌ |
| `configuration-nfx` | NAND NFX | LOW | ❌ |

---

## Testes

- **Separate test DB** via `.env.test`
- **`afterAll(() => cleanAll())`** em cada suite
- **HAWKBIT_ENABLED=false** nos testes
- **174 testes**, 11 arquivos (174 `it()` blocos, 272 `expect()` assertions)
- **Test runner issue:** Bun 1.3.12 on Windows has ENOENT bug with tsconfig path aliases. Tests are structurally valid but cannot execute locally. Verify via `bun build` and Docker.

```bash
bun test --env-file=.env.test
```

---

## Rotas

Ver README.md para tabela completa de rotas.

---

## Environment Variables

Ver `.env.example` para lista completa. Variáveis-chave:

| Var | Obrigatória | Descrição |
|-----|------------|-----------|
| `DATABASE_URL` | ✅ | PostgreSQL |
| `BETTER_AUTH_SECRET` | ✅ | Sessões (mín 32 chars) |
| `BETTER_AUTH_URL` | ✅ | URL base |
| `HAWKBIT_ENABLED` | ❌ | Habilita hawkBit (default: false) |
| `HAWKBIT_URL` | ❌ | hawkBit Management API |
| `SUPER_ADMIN_EMAILS` | ❌ | Platform admins (vírgula) |
