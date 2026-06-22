# Ninbus API

Plataforma OTA para gerenciamento de frotas IoT — provisioning, firmware upload, deployment e monitoramento em tempo real.

**Stack:** Bun · Elysia · Better Auth · Drizzle ORM · Eclipse hawkBit 1.0.3

---

## Arquitetura

```
Internet
  │
  ├── Flutter App ─── Cookie/Bearer Auth ──┐
  │                                         │
  │                    Ninbus API (:8081)    │
  │                     ├── Better Auth     │
  │                     ├── Sync Engine     │
  │                     └── SSE Emitter     │
  │                              │          │
  │                   hawkBit (:8080)       │
  │                     ├── Management API (Basic Auth)
  │                     └── DDI API (TargetToken)
  │                              │          │
  │              ┌───────────────┤          │
  │              │               │          │
  │         PostgreSQL      S3 / R2    IoT Device
  │          (Neon)      (artifacts)   (DDI poll)
```

**Fluxo de dados:**

1. **Flutter** → Ninbus API (cookie ou Bearer) → hawkBit Management API (Basic Auth)
2. **Sync Engine** → hawkBit → DB local (background) → SSE → Flutter (real-time)
3. **Dispositivo** → hawkBit DDI (TargetToken) → download firmware → feedback

---

## Quick Start

```bash
bun install
cp .env.example .env          # preencha valores obrigatórios
bun run db:push               # sincroniza schema Drizzle
bun run dev                    # → http://localhost:8081
```

### Docker (API + hawkBit)

```bash
docker compose build
docker compose up -d
docker compose logs -f api
```

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| `api` | 8081 | Ninbus API |
| `hawkbit` | 8080 | hawkBit 1.0.3 (custom build com S3 extension + CDN) |

> `docker compose` lê `.env` por padrão. Use `--env-file .env.docker` para overrides Docker.

---

## Autenticação

Better Auth com sessões via cookie httpOnly e Bearer token.

**No navegador (/docs):** Faça sign-in → cookie é setado automaticamente → todos os endpoints subsequentes funcionam.

**Para API clients (mobile, curl, etc.):** Use `Authorization: Bearer <token>` onde `<token>` é o campo `token` da resposta de sign-in.

```bash
# Sign-in → captura token
curl -X POST http://localhost:8081/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"password123"}'
# Resposta: { "token": "abc123...", "user": {...} }

# Usa token como Bearer
curl http://localhost:8081/api/companies \
  -H 'Authorization: Bearer abc123...'
```

> **Importante:** Better Auth plugins devem ser array `[bearer()]`, não objeto `{ bearer: bearer() }`.
> Cookie `auth.session_token` precisa ser o valor assinado (HMAC), não o token raw.

---

## Rotas

> Documentação interativa: `http://localhost:8081/docs`

### Auth — `POST /api/auth/*`

| Rota | Descrição |
|------|-----------|
| `/sign-up/email` | Registro → cookie session |
| `/sign-in/email` | Login → cookie session + token no body |
| `/sign-out` | Logout |
| `/get-session` | Sessão atual (null se não autenticado) |
| `/request-password-reset` | Solicitar reset de senha |
| `/reset-password` | Resetar senha com token |

### Provisioning — `/api/devices/*` (super admin only)

| Rota | Descrição |
|------|-----------|
| `POST /provision` | Registrar device + criar hawkBit target |
| `GET /unclaimed` | Devices sem empresa |
| `POST /sync` | Descobrir auto-provisionados |
| `GET /search?serialNumber=` | Buscar por serial |
| `DELETE /deprovision/:serialNumber` | Remover permanentemente |

### Empresas — `/api/companies/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /` | auth | Listar do usuário (resolve designações pendentes) |
| `POST /` | **super admin** | Criar + designar owner por email (modelo fábrica) |
| `GET /:companyId` | viewer | Detalhes |
| `PUT /:companyId` | admin | Atualizar |
| `DELETE /:companyId` | owner | Remover |

> ⚠️ **Apenas a fábrica (super admin) cria empresas.** O body exige `ownerEmail` —
> se o usuário já existe, vira owner imediatamente; senão, fica como designação
> pendente resolvida automaticamente quando ele se cadastra.

### Admin (Fábrica) — `/api/admin/*` (super admin only)

| Rota | Descrição |
|------|-----------|
| `GET /companies` | Todas empresas com counts |
| `GET /companies/:id` | Detalhe de qualquer empresa |
| `GET /companies/:id/members` | Membros de qualquer empresa |
| `GET /companies/:id/devices` | Devices de qualquer empresa |
| `PUT /companies/:id/status` | Suspender / reativar empresa |
| `GET /users` | Todos usuários cadastrados |
| `GET /devices` | Todos dispositivos (multi-tenant) |
| `GET /pending-designations` | Designações pendentes (onboarding) |

### Membros — `/api/companies/:companyId/members/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /` | viewer | Listar membros |
| `POST /` | admin | Adicionar/designar por **email** (granted ou pending) |
| `PUT /:userId` | admin | Alterar role |
| `DELETE /:userId` | admin | Remover (último owner protegido → 409) |

### Designações — `/api/companies/:companyId/designations/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /` | admin | Listar designações pendentes |
| `DELETE /:designationId` | admin | Revogar designação não-claimada |

### Categorias — `/api/companies/:companyId/categories/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /` | viewer | Listar (filtra por `type`: bus_line \| garage \| region) |
| `POST /` | operator | Criar |
| `GET /:categoryId` | viewer | Detalhes |
| `PUT /:categoryId` | operator | Atualizar nome/descrição |
| `DELETE /:categoryId` | admin | Remover (cascade de membros) |

**Membros do grupo** (`/:categoryId/devices`):

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /` | viewer | Listar dispositivos do grupo (com `assignedAt`) |
| `POST /` | operator | Adicionar membros (idempotente, cross-tenant safe) |
| `PUT /` | operator | Substituir todos os membros |
| `DELETE /:deviceId` | operator | Remover um membro |

### Dispositivos — `/api/companies/:companyId/devices/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /` | viewer | Listar (DB local, zero hawkBit calls) |
| `POST /` | operator | Claim device |
| `GET /:deviceId` | viewer | Detalhes (stale-while-revalidate) |
| `PUT /:deviceId` | operator | Atualizar metadados |
| `DELETE /:deviceId` | admin | Unclaim (hawkBit target preservado) |
| `PUT /:deviceId/link` | operator | Vincular ao hawkBit manualmente |
| `GET /:deviceId/ddi-check` | viewer | Diagnóstico DDI do device |
| `GET /:deviceId/attributes` | viewer | Atributos hawkBit do target |
| `GET /:deviceId/actions` | viewer | Ações de deployment do device |
| `DELETE /:deviceId/actions/:actionId` | operator | Cancelar ação |
| `GET /:deviceId/categories` | viewer | Categorias do device |
| `PUT /:deviceId/categories` | operator | Atribuir categorias ao device |

### Deployments — `/api/companies/:companyId/deployments/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `GET /artifact-types` | viewer | Tipos de artefato disponíveis |
| `POST /` | operator | Criar deployment OTA |
| `GET /` | viewer | Listar deployments (Distribution Sets) |
| `GET /:deploymentId` | viewer | Detalhes com status real |
| `DELETE /:deploymentId` | admin | Remover (cancela ações ativas) |
| `GET /:deploymentId/statistics` | viewer | Estatísticas hawkBit |
| `GET /:deploymentId/target-statuses` | viewer | Devices com fase + progresso |
| `GET /:deploymentId/targets` | viewer | Targets brutos do Distribution Set |
| `GET /:deploymentId/targets/:targetId/status-trail` | viewer | Timeline de status do device |
| `DELETE /:deploymentId/targets/:targetId/actions/:actionId` | operator | Cancelar ação por device |
| `GET /:deploymentId/ddi-check/:targetId` | viewer | Diagnóstico DDI |

### Artefatos — `/api/companies/:companyId/artifacts/*`

| Rota | Role min. | Descrição |
|------|-----------|-----------|
| `POST /` | operator | Upload firmware (.fir/.frz/.bin) |
| `GET /types` | viewer | Tipos de artefato |
| `GET /` | viewer | Listar (com size + hashes) |
| `GET /:artifactId` | viewer | Detalhes |
| `GET /:artifactId/download` | viewer | Info de download |
| `PUT /:artifactId` | operator | Atualizar metadados |
| `DELETE /:artifactId` | admin | Remover |

### SSE — `/api/sse/*` e `/api/companies/:companyId/sse`

| Rota | Descrição |
|------|-----------|
| `GET /companies/:companyId/sse` | SSE stream (company-scoped) |
| `GET /sse/global` | SSE stream (all events, super admin) |
| `POST /sse/test/:companyId` | Enviar evento de teste |
| `POST /sse/simulate/:companyId` | Simular stream de eventos |
| `GET /sse/debug/connections` | Debug: conexões ativas |

### Health — `/health`

| Rota | Descrição |
|------|-----------|
| `GET /health` | Health check (DB + sync state) |

---

## Onboarding — Modelo Fábrica

A **fábrica** (super admin) cria empresas e designa o dono por **email**. O
cliente simplesmente se cadastra no app com o email designado para receber
acesso — **sem convites, links ou tokens**.

```
Fábrica: POST /companies { name, ownerEmail }
    ├─ usuário já existe?  → adicionado como owner imediatamente
    └─ não existe?         → designação pendente (tabela `pending_company_members`)

Cliente: POST /auth/sign-up/email { email, password, name }
    └─ hook user.create.after resolve designações pendentes → ganha acesso
```

**Segurança:** usuários comuns NÃO criam empresas (403). O dono de uma empresa
pode convidar membros internos por email (mesmo mecanismo, pending ou granted).
Ver `docs/flutter-factory-onboarding.md` e `docs/flutter-onboarding-task.md`.

**Suspensão:** a fábrica pode suspender uma empresa via
`PUT /admin/companies/:id/status` — write operations são bloqueadas para os
membros (GET permanece).

---

## Tenant Isolation (Multi-tenancy)

Todos os dados sensíveis (devices, artifacts, deployments) são isolados por empresa via banco local.

```
Request: GET /api/companies/{companyId}/artifacts
  1. companyRole macro → verifica se usuário é membro da empresa
  2. Service layer → SELECT * FROM artifacts WHERE company_id = :companyId
  3. hawkBit → busca apenas IDs pertencentes à empresa
  → Retorna SOMENTE artefatos daquela empresa
```

| Recurso | Tabela Local | Campo hawkBit | Isolamento |
|---------|-------------|---------------|------------|
| Devices | `devices` | `hawkbitTargetId` | ✅ `WHERE company_id` |
| Artifacts | `artifacts` | `hawkbitSmId` (UNIQUE) | ✅ `WHERE company_id` |
| Deployments | `deployments` | `hawkbitDsId` (UNIQUE) | ✅ `WHERE company_id` |

**Write-through:** Toda criação no hawkBit grava também no banco local com `companyId`. O hawkBit é global — o banco local é quem garante o isolamento.

## RBAC

```
Super Admin (SUPER_ADMIN_EMAILS) → bypassa membership, vê todas as empresas
  owner (4) → tudo, inclusive deletar empresa
    admin (3) → gerenciar membros, deletar recursos, ver designações
      operator (2) → criar/editar devices, deployments, artefatos, membros de grupo
        viewer (1) → apenas leitura
```

| Role | Ler | Criar | Editar | Deletar |
|------|-----|-------|--------|---------|
| owner | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ |
| operator | ✅ | ✅ | ✅ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ |

**Empresas suspensas** (`status='suspended'`): write operations bloqueadas
para membros (GET permanece). Apenas super admin pode suspender/reativar.

**Proteção de owner:** remover o último owner de uma empresa retorna **409 Conflict**.

---

## hawkBit — Integração

### Conceitos

| hawkBit | Ninbus | Uso |
|---------|--------|-----|
| Target | Device | `controllerId` = serial number hex |
| Software Module | Artifact | Container tipado (firmware, config) |
| Distribution Set | Deployment | Agrupa SMs, atribuído a targets |
| Action | Status por target | running → retrieved → downloading → finished |
| DDI | Device polling | `GET /{tenant}/controller/v1/{controllerId}` |

### Ciclo de Deployment

```
Flutter → POST /deployments → cria DS + assign targets
  Device → DDI poll → recebe deploymentBase (artifact URL)
  Device → GET artifact binary → download firmware (.tar)
  Device → POST feedback (retrieved → download → finished)
  Sync Engine → detecta mudança → SSE → Flutter
```

### Cancel Flow (Two-Step)

hawkBit requer dois passos para cancelar:
1. `DELETE /actions/{id}` → type muda para "cancel", status = "canceling"
2. `DELETE /actions/{id}?force=true` → status = "canceled"

Step 2 só funciona após step 1. Para actions já tipo "cancel", usar force direto.

### Artifact Tar Packaging

O firmware é empacotado em `.tar` antes do upload ao hawkBit:

```
├── header-info/featureidentity.json    {"type": "configuration-nfx"}
└── data/payload.bin                    firmware raw (.frz/.fir/.bin)
```

### Tipos de Artefato

| Tipo | Destino | Risco | Reboot |
|------|---------|-------|--------|
| `firmware-ninbus` | STM32F407 (NAND) | 🔴 HIGH | ✅ |
| `firmware-controller` | LightDot (CAN) | 🟡 MED | ❌ |
| `configuration-nfx` | NFX (NAND→CAN) | 🟢 LOW | ❌ |

---

## Sync Engine

Sincroniza hawkBit → DB local. GET /devices faz ZERO chamadas hawkBit.

| Modo | Background | On-demand | Recomendado para |
|------|-----------|-----------|-----------------|
| `periodic` | ALL targets a cada Ns | — | <1k devices |
| `on_demand` | nenhum | por request (cache 60s) | debug / dev |
| `hybrid` | companies com sessões ativas | single device (cache 60s) | **produção (50k+)** |

### Sync Adaptativo (Deploy Ativo)

Quando o sync engine detecta devices com `hawkbitUpdateStatus='pending'`:
1. **Sync normal (30s) é pausado** — evita contenção
2. **Fast sync (5s) é ativado** — captura progresso em tempo real
3. **Action status polling** — consulta hawkBit action API por device pending
4. **Round-robin** — max 50 devices/ciclo, overflow rotaciona entre ciclos
5. **Cache de action** — skipa poll se `lastModifiedAt` não mudou
6. **Evento final** — emite `device.action.status` terminal quando device sai de pending

Quando todos os deployments terminam, fast sync desativa e sync normal (30s) é retomado.

Arquivos: `sync-progress.ts` + `sync-progress-helpers.ts` no módulo deployments.

---

## SSE — Real-Time Events

| Evento | Dados | Quando |
|--------|-------|--------|
| `connected` | companyId, timestamp | Conexão estabelecida |
| `heartbeat` | timestamp | A cada 30s |
| `device.status` | deviceId, connectionStatus, hawkbitUpdateStatus | Sync atualiza device |
| `device.deployment` | deviceId, controllerId, status, message | Target recebe deployment |
| `device.action.status` | deviceId, controllerId, actionId, **phase**, **progress**, message | Progresso detalhado do deployment por device |
| `deployment.stats` | deploymentId, summary (totalTargets, finished, failed, inProgress, pending), status | Estatísticas agregadas do deployment |
| `device.claimed` | deviceId | POST /devices claim |
| `device.unclaimed` | deviceId | DELETE device (unclaim) |
| `deployment.created` | deploymentId, name, artifactType | POST /deployments |
| `deployment.deleted` | deploymentId | DELETE /deployments |
| `devices.batch` | count | Sync cycle completo |

### device.action.status — Progresso em Tempo Real

Pushado durante deploy ativo via sync engine. O sync muda para modo rápido (5s) quando detecta devices com `hawkbitUpdateStatus='pending'`.

```json
{
  "deviceId": "uuid",
  "controllerId": "255FFFFFFFFFFFF",
  "actionId": 42,
  "latestStatus": "running",
  "phase": "downloading",
  "progress": 50,
  "message": "downloading 50%",
  "timestamp": "2026-06-11T14:30:00.000Z"
}
```

Valores de `phase`: `assigned` → `pending` → `downloading` → `downloaded` → `installing` → `installed` / `error` / `canceled`
`progress`: 0-100 durante download, `null` nas demais phases.

### deployment.stats — Estatísticas Agregadas

```json
{
  "deploymentId": 5,
  "summary": {
    "totalTargets": 10,
    "finished": 7,
    "failed": 0,
    "inProgress": 2,
    "pending": 1,
    "canceled": 0
  },
  "status": "in_progress"
}
```

---

## Device Name → hawkBit Sync

O nome do dispositivo informado pelo usuário no cadastro é **propagado ao hawkBit**
via `PUT /rest/v1/targets/{controllerId} { name }`, garantindo que a lista de
dispositivos e a lista de targets em atualização mostrem o mesmo nome.

- `claim` (cadastro), `update` (rename) e `link` (legacy) chamam o helper
  `src/modules/devices/name-sync.ts`.
- Best-effort: falhas no hawkBit são logadas mas não bloqueiam a mutação local
  (o DB é a fonte canônica).

Ver `docs/device-name-hawkbit-sync.md`.

---

## Deployment History Snapshot (STICKY-FINISHED)

hawkBit **não preserva** o histórico de actions canceladas/substituídas. Para
manter o histórico real visível (mesmo após cancelar deploys concorrentes), o
Ninbus armazena um **snapshot imutável por target** na coluna
`deployments.target_status_snapshot` (JSONB).

**Regra STICKY-FINISHED:** uma vez que um dispositivo reportou `finished`, o
snapshot é congelado como `installed` e **NUNCA sobrescrito** — nem por um
cancelamento. Assim o tracking real é preservado: dispositivos que atualizaram
antes do cancelamento continuam aparecendo como `installed`.

- `GET /deployments/:id/target-statuses` prefere o snapshot quando frozen.
- `GET /deployments` NÃO filtra mais `!deleted` — histórico nunca some.
- O sync engine freeze automaticamente em fases terminais.

Ver `docs/deployment-history-snapshot.md`.

---

## Device Lifecycle

| Ação | Quem | hawkBit Target | DB Record | Name sync |
|------|------|---------------|-----------|-----------|
| Provision | super admin | **criado** | **criado** (unclaimed) | — |
| Claim | company member | preservado | companyId set | ✅ PUT name |
| Unclaim | admin | **preservado** | companyId = null | — |
| Deprovision | super admin | **deletado** | **deletado** | — |
| Rename (PUT) | operator | preservado | name updated | ✅ PUT name |

---

## Configuração

Copie `.env.example` para `.env`. Todas as variáveis validadas no startup via TypeBox (`src/common/config/env.ts`).

### Obrigatórias

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | PostgreSQL (Neon recomendado) |
| `BETTER_AUTH_SECRET` | Secret para sessões (min 32 chars) |
| `BETTER_AUTH_URL` | URL base da API |

### hawkBit

| Variável | Default | Descrição |
|----------|---------|-----------|
| `HAWKBIT_ENABLED` | false | Ativa integração hawkBit |
| `HAWKBIT_URL` | — | Management API URL |
| `HAWKBIT_USERNAME` | — | Basic Auth user |
| `HAWKBIT_PASSWORD` | — | Basic Auth password |
| `HAWKBIT_SYNC_MODE` | hybrid | periodic / on_demand / hybrid |
| `HAWKBIT_SYNC_INTERVAL_SEC` | 30 | Intervalo background sync |
| `HAWKBIT_AUTOPROVISIONING` | false | Auto-criar targets no DDI poll |

### hawkBit S3 / CDN

| Variável | Descrição |
|----------|-----------|
| `HAWKBIT_S3_ENABLED` | Usa S3/R2 para armazenar artefatos |
| `S3_ENDPOINT` | S3 endpoint (vazio = AWS default, R2 = `https://<id>.r2.cloudflarestorage.com`) |
| `S3_REGION` | Região S3 (R2: `auto`) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciais |
| `S3_BUCKET` | Bucket name (default: `ninbus-artifacts`) |
| `HAWKBIT_CDN_BASE_URL` | CDN URL (CloudFront ou R2 custom domain) |
| `HAWKBIT_CDN_KEY_PAIR_ID` | CloudFront Key Pair ID (Mode A — RSA) |
| `HAWKBIT_CDN_PRIVATE_KEY_PATH` | CloudFront RSA private key path |
| `HAWKBIT_CDN_EXPIRY_SEC` | CDN URL expiry (default: 3600) |

### Opcionais

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | 3000 | Porta do servidor |
| `HOST` | 0.0.0.0 | Host bind |
| `NODE_ENV` | development | environment |
| `LOG_LEVEL` | info | fatal/error/warn/info/debug/trace |
| `CORS_ORIGIN` | — | Origins separadas por vírgula |
| `SUPER_ADMIN_EMAILS` | — | Platform admins (vírgula) |
| `ENABLE_AUTH` | true | Habilita autenticação |
| `REQUIRE_EMAIL_VERIFICATION` | false | Exige verificação de email |
| `EMAIL_FROM` | noreply@example.com | Remetente de email |
| `RESEND_API_KEY` | — | Resend API key (email) |
| `ENABLE_RATE_LIMITER` | true | Rate limiting global |

---

## Estrutura do Projeto

```
src/
├── index.ts                         # Entry + graceful shutdown
├── app.ts                           # Composition root
├── common/
│   ├── config/                      # env.ts · hawkbit.ts · auth.ts · email.ts
│   ├── db/schema/                   # Drizzle tables (auth · companies · pending-members · categories · devices · posts · artifacts · deployments)
│   ├── hawkbit/                     # Client split by domain
│   │   ├── client.ts                # Barrel re-export
│   │   ├── http.ts                  # HTTP infrastructure + error class
│   │   ├── targets.ts               # Target CRUD + actions + attributes
│   │   ├── distribution-sets.ts     # DS CRUD + assignment + statistics
│   │   ├── software-modules.ts      # SM CRUD + types + artifact upload
│   │   ├── constants.ts             # Artifact types
│   │   └── types.ts                 # hawkBit API DTOs
│   ├── middleware/                  # auth-guard · rate-limiter · request-logger
│   ├── schemas/                     # ErrorResponse · GenericActionResponse
│   ├── sse/                         # SSE emitter + routes
│   ├── types/                       # deployment-status.ts
│   ├── utils/                       # serial-number.ts
│   ├── logger/                      # Pino (JSON em prod)
│   └── swagger-config.ts           # OpenAPI/Scalar config
├── modules/
│   ├── auth/                        # Better Auth routes
│   ├── companies/                   # Multi-tenancy + RBAC + members + designations
│   │   ├── index.ts                 # CRUD rotas (criação = super admin)
│   │   ├── member-routes.ts         # Membros via email (granted/pending)
│   │   ├── designation.ts           # Lógica de designação + resolução
│   │   ├── designation-routes.ts    # Listar/revogar designações
│   │   ├── service.ts               # Empresas + membros (último owner protegido)
│   │   └── schemas.ts
│   ├── categories/                  # Device grouping + membros do grupo
│   │   ├── index.ts                 # CRUD categorias
│   │   ├── member-routes.ts         # Dispositivos dentro do grupo (adesão/remoção/edição)
│   │   ├── service.ts · schemas.ts
│   ├── devices/                     # Registry + provisioning + sync engine
│   │   ├── index.ts                 # CRUD routes
│   │   ├── hawkbit-routes.ts        # hawkBit ops (attributes · actions · ddi-check)
│   │   ├── category-routes.ts       # Device ↔ category
│   │   ├── provision-routes.ts      # Super admin provisioning
│   │   ├── provisioning.ts          # Factory provisioning + claim + link (com name sync)
│   │   ├── name-sync.ts             # hawkBit target name propagation (claim/update/link)
│   │   ├── service.ts               # Business logic
│   │   ├── sync.ts                  # Engine orchestrator
│   │   └── sync-*.ts               # Sync strategies + fetch + helpers
│   ├── deployments/                 # OTA via hawkBit Distribution Sets
│   │   ├── index.ts                 # Create · list · get · delete
│   │   ├── device-routes.ts         # Statistics · targets · actions · trail (cancel preserva sticky)
│   │   ├── snapshot.ts              # Histórico imutável por target (regra STICKY-FINISHED)
│   │   ├── trail.ts                 # target-statuses (prefere snapshot frozen)
│   │   ├── trail-helpers.ts         # resolveActionStatus extraído
│   │   ├── service.ts · schemas.ts · actions.ts · enrichment.ts
│   │   ├── sync-progress.ts         # Action status polling + SSE + snapshot freeze
│   │   ├── sync-progress-helpers.ts # DS resolution · final events · stats
│   │   └── ddi-diagnostics.ts
│   ├── artifacts/                   # Firmware via hawkBit Software Modules
│   │   ├── index.ts · manage-routes.ts · service.ts · schemas.ts
│   │   └── tar-packager.ts          # .tar archive generator
│   ├── admin/                       # Factory: visão global (companies · users · devices · designations)
│   │   ├── index.ts · service.ts · schemas.ts
│   ├── sse/                         # SSE routes
│   ├── health/                      # GET /health
│   └── posts/                       # CRUD reference
├── scripts/
│   ├── migrate.ts · seed.ts
│   └── sse-test-simulation.ts
└── tests/                           # Integration tests (174 it() · 10 files)
    ├── auth · companies · categories · devices · deployments
    ├── artifacts · provisioning · health · posts · sse
    └── test-helpers.ts
```

---

## Scripts

| Comando | Descrição |
|---------|-----------|
| `bun run dev` | Dev com hot reload |
| `bun run build` | Build produção (single bundle) |
| `bun run start` | Iniciar produção |
| `bun run db:push` | Push schema para o DB |
| `bun run db:migrate` | Migrations |
| `bun run db:studio` | Drizzle Studio |
| `bun run db:seed` | Popular DB com seed data |
| `bun test` | Rodar testes |
| `bun run lint` | Biome linter |
| `bun run lint:fix` | Biome auto-fix |
| `bun run format` | Biome formatter |

---

## Testes

```bash
bun test --env-file=.env.test
```

- **Integration tests** (10 arquivos): auth · companies · categories · devices · deployments · artifacts · provisioning · health · posts · sse
- **Unit tests**: deployment status helpers · snapshot (STICKY-FINISHED) · name-sync · enrichment · email
- `afterAll(() => cleanAll())` em cada suite — limpa todas as tabelas em ordem FK
- `HAWKBIT_ENABLED=false` nos testes — zero chamadas hawkBit
- `SUPER_ADMIN_EMAILS=admin-test@ninbus.com.br` em `.env.test` (factory para setup)

---

## Stack

[Bun](https://bun.sh) · [Elysia](https://elysiajs.com) · [Better Auth](https://better-auth.com) · [Drizzle](https://orm.drizzle.team) · [TypeBox](https://github.com/sinclairtypebox) · [hawkBit](https://eclipse.org/hawkbit/) · [Scalar](https://scalar.com)

## Licença

Proprietário — Ninbus Tecnologia.
