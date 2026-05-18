# Ninbus API

Backend IoT — gerenciamento de dispositivos, deployments OTA e orquestração de frotas.

**Stack:** Bun + Elysia + Better Auth + Drizzle ORM + Eclipse hawkBit 1.0.3

---

## Arquitetura

```
Flutter App ──▶ Ninbus API (:8081) ──▶ hawkBit (:8080)
                     │                       │
                     │                       ├── Management API (Basic Auth)
                     │                       │   Targets · Distribution Sets · Artifacts
                     │                       │
                     │                       └── DDI API (TargetToken Auth)
                     │                           Device polling · Deployments
                     │
                     └── PostgreSQL (Neon)
                         Devices · Companies · Sessions

Dispositivos IoT (ESP32)
  GET /DEFAULT/controller/v1/{controllerId}
  Authorization: TargetToken {key}
```

**O que a API faz:**
- Multi-tenancy com RBAC (owner > admin > operator > viewer)
- Provisioning na fábrica (deviceKey → hawkBit target)
- Upload de firmware (.fir/.frz/.bin/.nfx) → hawkBit Software Modules
- Deployments OTA → hawkBit Distribution Sets
- Background sync hawkBit → DB local (50k+ dispositivos, zero hawkBit calls em GET)

---

## Quick Start

```bash
bun install
cp .env.example .env        # editar com seus valores
bun run db:migrate
bun run dev                  # http://localhost:8081
```

### Docker (hawkBit + API)

```bash
docker compose build api --no-cache
docker compose up -d api
docker compose logs -f api
```

### Testes

```bash
bun test --env-file=.env.test              # todos
bun test --env-file=.env.test tests/auth   # módulo específico
```

---

## Rotas da API

> Docs interativos: `http://localhost:8081/docs`

### RBAC

```
owner (4) > admin (3) > operator (2) > viewer (1)
```

| Role | Ler | Criar | Editar | Deletar |
|------|------|-------|--------|---------|
| owner | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ |
| operator | ✅ | ✅ | ✅ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ |

### Auth (`/api/auth/*`)

| Rota | Descrição |
|------|-----------|
| `POST /sign-up/email` | Registrar |
| `POST /sign-in/email` | Login (cookie session) |
| `POST /sign-out` | Logout |
| `GET /get-session` | Sessão atual |

### Provisioning (`/api/devices/*`) — Platform, auth only

| Rota | Descrição |
|------|-----------|
| `POST /provision` | Pré-registrar + criar hawkBit target |
| `GET /unclaimed` | Dispositivos sem empresa |
| `POST /sync` | Descobrir auto-provisionados (super admin) |
| `GET /search?serialNumber=` | Buscar por serial (super admin) |
| `DELETE /deprovision/:sn` | Remover permanentemente (super admin) |

### Empresas (`/api/companies/*`)

| Rota | Role | Descrição |
|------|------|-----------|
| `GET /` | auth | Listar do usuário |
| `POST /` | auth | Criar (user vira owner) |
| `GET /:id` | viewer | Detalhes |
| `PUT /:id` | admin | Atualizar |
| `DELETE /:id` | owner | Remover |
| `GET /:id/members` | viewer | Membros |
| `POST /:id/members` | admin | Adicionar membro |
| `PUT /:id/members/:uid` | admin | Alterar role |
| `DELETE /:id/members/:uid` | admin | Remover membro |

### Dispositivos (`/api/companies/:companyId/devices/*`)

| Rota | Role | Descrição |
|------|------|-----------|
| `GET /` | viewer | Listar (DB local, zero hawkBit) |
| `POST /` | operator | Claim dispositivo |
| `GET /:id` | viewer | Detalhes (stale-while-revalidate 60s) |
| `PUT /:id` | operator | Atualizar |
| `DELETE /:id` | admin | Unclaim (hawkBit preservado) |
| `PUT /:id/link` | operator | Vincular ao hawkBit |
| `GET|PUT /:id/categories` | viewer\|operator | Categorias |
| `GET /:id/attributes` | viewer | Atributos hawkBit |
| `GET /:id/actions` | viewer | Ações de deployment |
| `DELETE /:id/actions/:aid` | operator | Cancelar ação |

### Deployments (`/api/companies/:companyId/deployments/*`)

| Rota | Role | Descrição |
|------|------|-----------|
| `GET /artifact-types` | viewer | Tipos de artefato |
| `POST /` | operator | Criar deployment OTA |
| `GET /` | viewer | Listar (com status real) |
| `GET /:id` | viewer | Detalhes (com status real) |
| `DELETE /:id` | admin | Remover (cancela ações ativas) |
| `GET /:id/statistics` | viewer | Estatísticas hawkBit |
| `GET /:id/targets` | viewer | Targets do deployment |
| **`GET /:id/target-statuses`** | **viewer** | **Targets com fase + progresso enriquecidos** |
| **`GET /:id/targets/:t/status-trail`** | **viewer** | **Timeline completa de status do device** |
| `GET /:id/targets/:t/actions/:a/status` | viewer | Histórico raw da ação |
| `DELETE /:id/targets/:t/actions/:a` | operator | Cancelar ação por device |
| `GET /devices/:id/actions` | viewer | Histórico de ações do device |

### Artefatos (`/api/companies/:companyId/artifacts/*`)

| Rota | Role | Descrição |
|------|------|-----------|
| `POST /` | operator | Upload firmware (409 se duplicado) |
| `GET /types` | viewer | Tipos de artefato |
| `GET /` | viewer | Listar (com size + hashes) |
| `GET /:id` | viewer | Detalhes |
| `GET /:id/download` | viewer | Download info |
| `PUT /:id` | operator | Atualizar descrição |
| `DELETE /:id` | admin | Remover |

---

## Tipos de Artefato

| Tipo | Destino | Risco | Reboot | Extensões |
|------|---------|-------|--------|-----------|
| `firmware-ninbus` | NAND → STM32F407 | 🔴 HIGH | ✅ | `.fir` `.bin` |
| `firmware-controller` | CAN → LightDot | 🟡 MED | ❌ | `.fir` `.bin` |
| `configuration-nfx` | NAND NFX → CAN | 🟢 LOW | ❌ | `.frz` `.nfx` |

---

## hawkBit — Conceitos

| hawkBit | Ninbus | Descrição |
|---------|--------|-----------|
| Target | Device | controllerId = serialNumber hex |
| Software Module | Artifact | Container tipado (firmware-ninbus, etc.) |
| Distribution Set | Deployment | Agrupa SMs, atribuído a targets |
| Action | Deployment status | Status por target (running→retrieved→finished) |
| DDI | Device polling | `GET /{tenant}/controller/v1/{controllerId}` |

### Fluxo de Deployment

```
1. POST /artifacts       → Upload firmware → hawkBit Software Module
2. POST /deployments     → Cria DS + atribui targets
3. Device DDI poll       → hawkBit oferece deploymentBase
4. Device download       → Baixa binário → instala → envia feedback
```

### Cancel Flow (Two-Step)

hawkBit requer duas etapas para cancelar:
1. `DELETE /actions/{id}` → status = "canceling"
2. `DELETE /actions/{id}?force=true` → status = "canceled" (só funciona após step 1)

### Deployment Status (computado das estatísticas hawkBit)

| Status | Significado |
|--------|-------------|
| `pending` | Atribuído, dispositivo não consultou |
| `in_progress` | Dispositivo baixando/instalando |
| `completed` | Todos finalizaram com sucesso |
| `failed` | Pelo menos um erro |
| `canceled` | Todos cancelados |
| `no_targets` | Sem dispositivos |

### Status Trail — Fase Semântica por Device

O device embarcado envia feedbacks via DDI que o hawkBit armazena como histórico.
As rotas `target-statuses` e `status-trail` enriquecem esse histórico com fases
semânticas e progresso de download.

**Ciclo completo (10 passos):**

```
 assigned    → Assignment initiated by admin      (servidor)
 retrieved   → Target retrieved update action      (DDI poll)
 installing  → deployment started                 (device)
 downloading → downloading artifact                (0%)
 downloading → downloading 25%                     (progress=25)
 downloading → downloading 50%                     (progress=50)
 downloading → downloading 75%                     (progress=75)
 downloaded  → download complete                   (progress=100)
 installing  → installing NFX to controller        (device)
 rebooting   → installed successfully, rebooting   (fim)
```

**`GET /:id/target-statuses`** — Resumo por device (phase + progress + message)

**`GET /:id/targets/:t/status-trail`** — Timeline cronológica completa (oldest→newest)

**Fases:** `assigned` · `retrieved` · `downloading` · `downloaded` · `installing` · `rebooting` · `success` · `error` · `canceled` · `unknown`

---

## Configuração

Copie `.env.example` para `.env`. Todas validadas no startup via TypeBox (`src/common/config/env.ts`).

### Obrigatórias

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Secret sessões (mín 32 chars) |
| `BETTER_AUTH_URL` | URL base da API |

### hawkBit

| Variável | Default | Descrição |
|----------|---------|-----------|
| `HAWKBIT_ENABLED` | false | Habilita integração |
| `HAWKBIT_URL` | — | Management API URL |
| `HAWKBIT_USERNAME` | — | Basic Auth |
| `HAWKBIT_PASSWORD` | — | Basic Auth |
| `HAWKBIT_AUTOPROVISIONING` | false | Auto-cria target no DDI poll |
| `HAWKBIT_SYNC_INTERVAL_SEC` | 10 | Intervalo do sync worker |
| `HAWKBIT_SYNC_STALE_SEC` | 300 | Dados stale sem revalidação |

### SSE (Server-Sent Events)

| Variável | Default | Descrição |
|----------|---------|-----------|
| `SSE_ENABLED` | true | Habilita SSE |
| `SSE_HEARTBEAT_SEC` | 30 | Intervalo heartbeat |
| `SSE_MAX_CONNECTIONS_PER_COMPANY` | 50 | Limite por empresa |

### Opcionais

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | 3000 | Porta |
| `LOG_LEVEL` | info | fatal/error/warn/info/debug |
| `CORS_ORIGIN` | — | Origins (vírgula) |
| `SUPER_ADMIN_EMAILS` | — | Platform admins (vírgula) |

---

## Estrutura do Projeto

```
src/
├── index.ts                    # Entry + graceful shutdown
├── app.ts                      # Composition root + hawkBit error handler
├── common/
│   ├── config/                 # env.ts (fonte única), hawkbit.ts, auth.ts
│   ├── db/schema/              # Drizzle tables (auth, companies, devices, categories)
│   ├── hawkbit/                # Client: targets, distribution-sets, software-modules
│   ├── middleware/             # Auth guard, RBAC, rate limiter, logger
│   ├── schemas/                # ErrorResponse, GenericActionResponse
│   ├── sse/                    # SSE emitter (W3C, company-scoped, heartbeat)
│   ├── types/                  # Deployment status types + enrichment helpers
│   └── utils/                  # Serial number normalization
├── modules/
│   ├── auth/                   # Better Auth routes
│   ├── companies/              # Multi-tenancy + members
│   ├── categories/             # Device grouping
│   ├── devices/                # Registry + provisioning + hawkBit sync
│   ├── deployments/            # OTA: actions, enrichment, service, trail
│   ├── artifacts/              # Firmware upload + tar packaging + management
│   ├── health/                 # Health + sync state
│   └── posts/                  # Reference CRUD
tests/                          # 160 testes Bun
```

---

## Scripts

| Comando | Descrição |
|---------|-----------|
| `bun run dev` | Dev com hot reload |
| `bun run build` | Build produção (single bundle) |
| `bun run start` | Iniciar produção |
| `bun test` | Testes |
| `bun run db:migrate` | Migrations |
| `bun run db:studio` | Drizzle Studio |

---

## Stack

[Bun](https://bun.sh) · [Elysia](https://elysiajs.com) · [Better Auth](https://better-auth.com) · [Drizzle](https://orm.drizzle.team) · [TypeBox](https://github.com/sinclairtypebox) · [hawkBit](https://eclipse.org/hawkbit/) · [Scalar](https://scalar.com)

## Licença

Proprietário — Ninbus Tecnologia.
