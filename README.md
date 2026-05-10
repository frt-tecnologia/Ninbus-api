# Ninbus API

Backend da plataforma IoT Ninbus — gerenciamento de dispositivos, deployments OTA e orquestração de frotas.

Construído com **Bun** + **Elysia** + **Better Auth** + **Drizzle ORM** + **Eclipse hawkBit**.

---

## Visão Geral

```
Frontend ──▶ Ninbus API ──▶ Eclipse hawkBit (1.0.3)
   │             │                    │
   │             │              ┌─────┴─────┐
   │             │              │ Management API
   │             │              │ Targets, Distribution Sets,
   │             │              │ Software Modules, Artifacts
   │             │              └───────────┘
   │             │
   │        PostgreSQL (Neon)
   │     (dispositivos, empresas,
   │      categorias, sessões)
   │
   └── Dispositivos IoT (Ninbus WiFi v3)
       firmware-ninbus | firmware-controller | configuration-nfx
```

O Ninbus API é a camada de negócio entre o frontend e o hawkBit. Ele gerencia:

- **Multi-tenancy** — empresas, membros, RBAC (owner/admin/operator/viewer)
- **Provisioning** — pré-registro de dispositivos na fábrica/depósito (hawkBit target + DB local)
- **Dispositivos** — registro, claim por empresa, categorização, atributos hawkBit
- **Deployments OTA** — criação de Distribution Sets, atribuição a targets, monitoramento
- **Artefatos** — upload de firmware raw (.fir/.frz/.bin) via Software Modules hawkBit
- **Sincronização** — sync bidirecional hawkBit ↔ DB local

---

## Quick Start

### Pré-requisitos

- [Bun](https://bun.sh) >= 1.3
- [PostgreSQL](https://www.postgresql.org/) >= 16
- [Docker](https://www.docker.com/) (opcional, para hawkBit + MinIO)

### Instalação

```bash
git clone https://github.com/ninbus/ninbus-api.git
cd ninbus-api

bun install

cp .env.example .env
# Edite o .env com seus valores

bun run db:migrate
bun run dev
```

O servidor inicia em `http://localhost:8081` (porta configurável via `PORT`).

### Usando Docker (hawkBit + MinIO + API)

```bash
docker compose up -d
docker compose logs -f api
```

---

## Documentação da API

Após iniciar o servidor, acesse a documentação interativa Scalar:

```
http://localhost:8081/docs
```

Documentação OpenAPI 3.0 gerada automaticamente a partir dos schemas TypeBox.

### Health Check

```bash
curl http://localhost:8081/health
```

---

## Configuração

Todas as variáveis são validadas no startup via TypeBox. Copie `.env.example` para `.env`.

### Variáveis Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | Connection string PostgreSQL | `postgresql://postgres:postgres@localhost:5432/ninbus_db` |
| `BETTER_AUTH_SECRET` | Secret para sessões (mín 32 chars) | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | URL base da API (para callbacks) | `http://localhost:8081` |
| `EMAIL_FROM` | Email sender address | `noreply@example.com` |

### Variáveis Opcionais

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `LOG_LEVEL` | `info` | `fatal` / `error` / `warn` / `info` / `debug` / `trace` |
| `CORS_ORIGIN` | — | Origins separados por vírgula |
| `ENABLE_AUTH` | `true` | Desabilita autenticação |
| `ENABLE_RATE_LIMITER` | `true` | Rate limiting global |

### Eclipse hawkBit

| Variável | Default | Descrição |
|----------|---------|-----------|
| `HAWKBIT_ENABLED` | `false` | Habilita integração hawkBit |
| `HAWKBIT_URL` | — | URL base do hawkBit Management API |
| `HAWKBIT_USERNAME` | — | Basic Auth username |
| `HAWKBIT_PASSWORD` | — | Basic Auth password |
| `HAWKBIT_TIMEOUT_MS` | `30000` | Timeout das requisições |
| `HAWKBIT_SKIP_TLS` | `false` | Ignora certificado TLS (dev) |

> **Nota**: hawkBit usa HTTP Basic Auth (não PAT como Mender).

---

## Estrutura do Projeto

```
src/
├── index.ts                      # Entrypoint — migrations + server + graceful shutdown
├── app.ts                        # Composition root — middleware + módulos + Swagger tags
│
├── common/
│   ├── config/
│   │   ├── env.ts                # Fonte única da verdade — TypeBox validated
│   │   ├── hawkbit.ts            # Thin accessor tipado sobre env (zero process.env)
│   │   ├── auth.ts               # Better Auth config (session, email, cookies)
│   │   ├── auth-client.ts        # Better Auth client
│   │   └── email.ts              # Resend email helper
│   ├── db/
│   │   ├── index.ts              # Drizzle client (pool max 10)
│   │   └── schema/               # Drizzle table definitions
│   │       ├── auth.ts           # Better Auth tables (user, session, account, verification)
│   │       ├── companies.ts      # companies + company_members (RBAC: owner/admin/operator/viewer)
│   │       ├── categories.ts     # categories (bus_line, garage, yard, region, custom)
│   │       ├── devices.ts        # devices + device_category_assignments (N:N)
│   │       ├── posts.ts          # Posts (reference)
│   │       └── index.ts          # Barrel exports
│   ├── hawkbit/
│   │   ├── client.ts             # Barrel re-export + utility functions
│   │   ├── http.ts               # HTTP client — Basic Auth, timeout, TLS
│   │   ├── targets.ts            # Target CRUD, attributes, actions, DS assignment
│   │   ├── distribution-sets.ts  # Distribution Set CRUD, target assignment, statistics
│   │   ├── software-modules.ts   # Software Module CRUD, artifact upload/download
│   │   ├── constants.ts          # Ninbus artifact types (firmware-ninbus, firmware-controller, configuration-nfx)
│   │   └── types.ts              # hawkBit API DTO interfaces
│   ├── middleware/
│   │   ├── auth-guard.ts         # withAuth() — deriva user/session + macros auth + companyRole
│   │   ├── company-check.ts      # checkMembership() — shared helper (legacy, prefer companyRole macro)
│   │   ├── company-guard.ts      # hasCompanyRole() — standalone role middleware (legacy)
│   │   ├── rate-limiter.ts       # Rate limiting global + auth
│   │   └── request-logger.ts     # Structured request logging
│   ├── logger/index.ts           # Pino logger (silent em testes, JSON em produção)
│   └── schemas/index.ts          # ErrorResponseSchema + GenericActionResponseSchema
│
├── modules/
│   ├── auth/                     # Better Auth routes (sign-up, sign-in, session, password reset)
│   │   ├── schemas.ts
│   │   └── index.ts
│   ├── companies/                # Multi-tenancy CRUD + members
│   │   ├── schemas.ts
│   │   ├── service.ts
│   │   ├── index.ts              # Company CRUD (viewer: GET, admin: PUT, owner: DELETE)
│   │   └── member-routes.ts      # Member management (viewer: list, admin: add/role/remove)
│   ├── categories/               # Device grouping
│   │   ├── schemas.ts
│   │   ├── service.ts
│   │   └── index.ts              # Category CRUD (viewer: GET, operator: POST/PUT, admin: DELETE)
│   ├── devices/                  # Device registry + hawkBit integration
│   │   ├── schemas.ts
│   │   ├── service.ts            # CRUD + hawkBit sync + link
│   │   ├── provisioning.ts       # Factory provisioning logic
│   │   ├── sync.ts               # hawkBit ↔ Ninbus sync engine
│   │   ├── auth.ts               # loadDevice + requireHawkbitLink helpers
│   │   ├── index.ts              # Device CRUD + claim (viewer: GET, operator: POST/PUT, admin: DELETE)
│   │   ├── provision-routes.ts   # Factory provisioning (POST /provision, GET /unclaimed)
│   │   ├── hawkbit-routes.ts     # hawkBit operations (viewer: GET attrs/actions, operator: cancel)
│   │   └── category-routes.ts    # Category assignment (viewer: GET, operator: PUT)
│   ├── deployments/              # OTA deployments via hawkBit Distribution Sets
│   │   ├── schemas.ts
│   │   ├── service.ts            # Create DS → assign targets → monitor
│   │   ├── index.ts              # Deployment CRUD (viewer: GET, operator: POST, admin: DELETE)
│   │   └── device-routes.ts      # Statistics, targets, action status/cancel
│   ├── artifacts/                # Firmware management via hawkBit Software Modules
│   │   ├── schemas.ts
│   │   ├── service.ts            # Upload + enrichment + validation
│   │   ├── index.ts              # Upload (operator) + artifact types (viewer)
│   │   └── manage-routes.ts      # List/get/update/delete/download
│   ├── health/                   # GET /health
│   └── posts/                    # Reference CRUD module
│
└── scripts/
    ├── migrate.ts                # Drizzle migrations runner
    └── seed.ts                   # Database seeder

tests/                            # 136 testes Bun
```

---

## Rotas da API

### RBAC — Role Hierarchy

```
owner (4) > admin (3) > operator (2) > viewer (1)
```

| Role | List/Get | Create | Update | Delete | Members |
|------|----------|--------|--------|--------|---------|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| operator | ✅ | ✅ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

### Autenticação (`/api/auth/*`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/auth/sign-up/email` | ❌ | Registrar |
| POST | `/api/auth/sign-in/email` | ❌ | Login |
| POST | `/api/auth/sign-out` | ✅ | Encerrar sessão |
| GET | `/api/auth/get-session` | ✅ | Sessão atual |
| POST | `/api/auth/request-password-reset` | ❌ | Solicitar reset |
| POST | `/api/auth/reset-password` | ❌ | Resetar com token |

### Provisioning (`/api/devices/*`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/devices/provision` | ✅ | Pré-registrar dispositivo na fábrica (cria hawkBit target) |
| GET | `/api/devices/unclaimed` | ✅ | Listar dispositivos sem empresa |

### Empresas (`/api/companies/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/companies` | auth | Listar empresas do usuário |
| POST | `/api/companies` | auth | Criar empresa (user vira owner) |
| GET | `/api/companies/:id` | viewer | Detalhes |
| PUT | `/api/companies/:id` | admin | Atualizar |
| DELETE | `/api/companies/:id` | owner | Remover |
| GET | `/api/companies/:id/members` | viewer | Listar membros |
| POST | `/api/companies/:id/members` | admin | Adicionar membro |
| PUT | `/api/companies/:id/members/:userId` | admin | Alterar role |
| DELETE | `/api/companies/:id/members/:userId` | admin | Remover membro |

### Dispositivos (`/api/companies/:companyId/devices/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/` | viewer | Listar dispositivos |
| POST | `/` | operator | Registrar/claim dispositivo |
| GET | `/:deviceId` | viewer | Detalhes (com hawkBit sync) |
| PUT | `/:deviceId` | operator | Atualizar |
| DELETE | `/:deviceId` | admin | Remover |
| PUT | `/:deviceId/link` | operator | Vincular ao hawkBit |
| GET | `/:deviceId/categories` | viewer | Categorias do dispositivo |
| PUT | `/:deviceId/categories` | operator | Atribuir categorias |
| GET | `/:deviceId/attributes` | viewer | Atributos hawkBit do target |
| GET | `/:deviceId/actions` | viewer | Ações de deployment hawkBit |
| DELETE | `/:deviceId/actions/:actionId` | operator | Cancelar ação de deployment |

### Categorias (`/api/companies/:companyId/categories/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/` | viewer | Listar categorias |
| POST | `/` | operator | Criar categoria |
| GET | `/:categoryId` | viewer | Detalhes |
| PUT | `/:categoryId` | operator | Atualizar |
| DELETE | `/:categoryId` | admin | Remover |

### Deployments (`/api/companies/:companyId/deployments/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/artifact-types` | viewer | Tipos de artefato Ninbus |
| POST | `/` | operator | Criar deployment OTA |
| GET | `/` | viewer | Listar deployments |
| GET | `/:deploymentId` | viewer | Detalhes |
| DELETE | `/:deploymentId` | admin | Remover |
| GET | `/:deploymentId/statistics` | viewer | Estatísticas hawkBit |
| GET | `/:deploymentId/targets` | viewer | Targets no deployment |
| GET | `/…/status` | viewer | Histórico de status da ação |
| DELETE | `/…/actions/:actionId` | operator | Cancelar ação |
| GET | `/devices/:deviceId/actions` | viewer | Ações do dispositivo |

### Artefatos (`/api/companies/:companyId/artifacts/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| POST | `/` | operator | Upload firmware (.fir/.frz/.bin) |
| GET | `/types` | viewer | Tipos de artefato |
| GET | `/` | viewer | Listar artefatos |
| GET | `/:artifactId` | viewer | Detalhes |
| GET | `/:artifactId/download` | viewer | Download info |
| PUT | `/:artifactId` | operator | Atualizar descrição |
| DELETE | `/:artifactId` | admin | Remover |

---

## Tipos de Artefato

| Tipo | Destino | Risco | Reboot |
|------|---------|-------|--------|
| `firmware-ninbus` | NAND → Bootloader → STM32F407 | 🔴 HIGH | ✅ |
| `firmware-controller` | CAN Bus → LightDot | 🟡 MEDIUM | ❌ |
| `configuration-nfx` | NAND NFX → CAN → LightDot | 🟢 LOW | ❌ |

---

## hawkBit Integration

### Conceitos hawkBit ↔ Ninbus

| hawkBit | Ninbus API | Descrição |
|---------|-----------|-----------|
| Target (controllerId) | Device | Dispositivo IoT com status de conexão |
| Software Module | Artifact container | Container tipado (firmware-ninbus, etc.) |
| Artifact | Binary file | Arquivo binário (.fir/.frz/.bin) |
| Distribution Set | Deployment | Agrupa SMs e é atribuído a targets |
| Target Attributes | Device inventory | Hardware/software info do device |
| Action | Deployment status | Status por target (running/finished/error) |

### Fluxo de Upload

```
POST /artifacts → cria Software Module → upload binary como Artifact
```

### Fluxo de Deployment

```
POST /deployments → resolve targets → cria Software Module →
cria Distribution Set → assigna targets → hawkBit envia firmware via polling
```

### Fluxo de Provisioning

```
POST /devices/provision → cria hawkBit Target (securityToken=deviceKey) →
cria Device local (status=unclaimed) → device começa polling hawkBit
```

### API hawkBit Usada

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/rest/v1/targets` | GET/POST | Listar/criar targets |
| `/rest/v1/targets/{id}` | GET/PUT/DELETE | CRUD de target |
| `/rest/v1/targets/{id}/attributes` | GET | Atributos do device |
| `/rest/v1/targets/{id}/actions` | GET/DELETE | Ações de deployment |
| `/rest/v1/targets/{id}/actions/{aid}/status` | GET | Histórico de status |
| `/rest/v1/softwaremodules` | GET/POST | CRUD de SM |
| `/rest/v1/softwaremodules/{id}/artifacts` | POST (multipart) | Upload de binário |
| `/rest/v1/distributionsets` | GET/POST/DELETE | CRUD de DS |
| `/rest/v1/distributionsets/{id}/assignedTargets` | GET/POST | Atribuir targets |
| `/rest/v1/distributionsets/{id}/statistics` | GET | Estatísticas |
| `/rest/v1/softwaremoduletypes` | GET/POST | Tipos de SM |
| `/rest/v1/distributionsettypes` | GET/POST | Tipos de DS |

---

## Testes

```bash
# Suba o PostgreSQL local
docker run -d --name ninbus-test-pg \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ninbus_db -p 5432:5432 postgres:16-alpine

# Rode as migrations
bun --env-file=.env.test run src/scripts/migrate.ts

# Rode os testes
bun test --env-file=.env.test
```

**136 testes** cobrindo: auth, CRUD de empresas/dispositivos/categorias, deployments, artefatos, health, RBAC, validação, autorização.

---

## Scripts

| Script | Descrição |
|--------|-----------|
| `bun run dev` | Servidor com hot reload |
| `bun run build` | Build de produção (single bundle) |
| `bun run start` | Iniciar build de produção |
| `bun test --env-file=.env.test` | Rodar testes |
| `bun run lint` | Lint com Biome |
| `bun run db:migrate` | Rodar migrations |
| `bun run db:push` | Push schema direto (dev) |
| `bun run db:studio` | Drizzle Studio |

---

## Stack

| Tecnologia | Uso |
|------------|-----|
| [Bun](https://bun.sh) | Runtime + bundler + test runner |
| [Elysia.js](https://elysiajs.com) | Web framework (plugins, macros, OpenAPI) |
| [Better Auth](https://better-auth.com) | Autenticação (email/password, sessões, cookies) |
| [Drizzle ORM](https://orm.drizzle.team) | ORM PostgreSQL |
| [TypeBox](https://github.com/sinclairtypebox/typebox) | Runtime type validation |
| [Biome](https://biomejs.dev) | Linter + formatter |
| [Scalar](https://scalar.com) | Documentação OpenAPI interativa |
| [Eclipse hawkBit](https://eclipse.org/hawkbit/) | OTA deployment server |

---

## Licença

Projeto proprietário — Ninbus Tecnologia.
