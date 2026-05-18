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
│   ├── middleware/        # auth-guard, company-guard, rate-limiter, logger
│   ├── schemas/          # ErrorResponse, GenericActionResponse
│   └── utils/            # serial-number normalization
├── modules/
│   ├── auth/             # Better Auth routes
│   ├── companies/        # Multi-tenancy + RBAC + members
│   ├── categories/       # Device grouping
│   ├── devices/          # Registry + provisioning + hawkBit sync
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
| Action | Status por target | running→retrieved→download→finished |
| DDI | Device polling | TargetToken auth |

### Deployment Status (computado de action statistics)

`RUNNING/SCHEDULED` → pending · `RETRIEVED/DOWNLOAD/DOWNLOADED` → in_progress · `FINISHED` → completed · `ERROR/WARNING` → failed · `CANCELED/CANCELING` → canceled

### createDeployment — Fluxo de 4 Etapas

1. **forceCloseActiveActions(ALL)** — cancela ações pré-existentes
2. **assignTargets** — atribui novo DS (cria update action)
3. **forceCloseCancelActions(cancel-only)** — força close de ações cancel que ficaram em canceling
4. **verifyActiveUpdateAction** — verifica que cada target tem ação ativa, loga erro se não

hawkBit PRIORIZA cancelAction sobre deploymentBase no DDI. Sem a etapa 3, o dispositivo NÃO vê o novo deployment.

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

Status mapping: `running/scheduled` → pending · `retrieved/download/downloaded` → in_progress · `finished` → completed · `error/warning` → failed · `canceled/canceling` → canceled · `deleted DS` → canceled · `no actions` → no_targets

### Background Sync

Worker sincroniza hawkBit → DB local a cada 30s. GET /devices faz ZERO chamadas hawkBit.

---

## Convenções de Código

- **Files < 250 linhas** — split em sub-arquivos quando necessário
- **Response schemas** em `schemas.ts`, nunca inline em rotas
- ** hawkBit guard:** checar `hawkbitConfig.enabled` antes de qualquer chamada
- **Config:** TUDO por `env.ts`, nunca `process.env` direto
- ** hawkBit bulk POST:** body em array `[data]`, response é array → `arr[0]`
- **Artifact upload:** `FormData` + `formData.append('file', file)`
- **DS names:** UUID-based (`ds-{uuid}`), nunca nomes legíveis
- **Logger:** `%s` format strings, nunca unknown como arg posicional

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
- **160 testes**, 9 arquivos

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
