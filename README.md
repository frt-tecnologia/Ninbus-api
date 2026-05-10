# Ninbus API

Backend da plataforma IoT Ninbus — gerenciamento de dispositivos, deployments OTA e orquestração de frotas.

Construído com **Bun** + **Elysia** + **Better Auth** + **Drizzle ORM** + **Eclipse hawkBit 1.0.3**.

---

## Visão Geral

```
Frontend ──▶ Ninbus API ──▶ Eclipse hawkBit (1.0.3)
   │             │                    │
   │             │              ┌─────┴─────┐
   │             │              │ Management API (Basic Auth)
   │             │              │ Targets, Distribution Sets,
   │             │              │ Software Modules, Artifacts
   │             │              ├───────────┤
   │             │              │ DDI API (TargetToken Auth)
   │             │              │ Device polling, deployments
   │             │              └───────────┘
   │             │
   │        PostgreSQL (Neon)
   │     (dispositivos, empresas,
   │      categorias, sessões)
   │
   └── Dispositivos IoT (Ninbus WiFi v3)
       GET /DEFAULT/controller/v1/{controllerId}
       Authorization: TargetToken {securityToken}
       ────────────────────────────────────────
       firmware-ninbus | firmware-controller | configuration-nfx
```

O Ninbus API é a camada de negócio entre o frontend e o hawkBit. Ele gerencia:

- **Multi-tenancy** — empresas, membros, RBAC (owner/admin/operator/viewer)
- **Provisioning** — pré-registro na fábrica com deviceKey → hawkBit target
- **Dispositivos** — registro, claim por empresa, categorização, atributos hawkBit
- **Deployments OTA** — criação de Distribution Sets, atribuição a targets, monitoramento
- **Artefatos** — upload de firmware raw (.fir/.frz/.bin) via Software Modules hawkBit
- **Sincronização** — sync bidirecional hawkBit ↔ DB local
- **DDI** — dispositivos fazem polling com TargetToken auth

---

## Quick Start

### Pré-requisitos

- [Bun](https://bun.sh) >= 1.3
- [PostgreSQL](https://www.postgresql.org/) >= 16
- [Docker](https://www.docker.com/) (para hawkBit + MinIO)

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
| `SUPER_ADMIN_EMAILS` | — | Emails com acesso global (comma-separated) |

### Eclipse hawkBit

| Variável | Default | Descrição |
|----------|---------|-----------|
| `HAWKBIT_ENABLED` | `false` | Habilita integração hawkBit |
| `HAWKBIT_URL` | — | URL base do hawkBit Management API |
| `HAWKBIT_USERNAME` | — | Basic Auth username |
| `HAWKBIT_PASSWORD` | — | Basic Auth password |
| `HAWKBIT_TIMEOUT_MS` | `30000` | Timeout das requisições |
| `HAWKBIT_SKIP_TLS` | `false` | Ignora certificado TLS (dev) |
| `HAWKBIT_AUTOPROVISIONING` | `true` | Auto-cria target no primeiro DDI poll |
| `HAWKBIT_DDI_TARGET_TOKEN_AUTH` | `true` | **Obrigatório** — habilita TargetToken auth no DDI |

> **⚠️ CRÍTICO**: `HAWKBIT_DDI_TARGET_TOKEN_AUTH=true` é obrigatório. Sem isso, TODOS os
> polls DDI retornam 401. hawkBit 1.0.3 vem com TargetToken auth **desabilitado** por padrão.

---

## Estrutura do Projeto

```
src/
├── index.ts                      # Entrypoint — migrations + server + graceful shutdown
├── app.ts                        # Composition root — middleware + módulos + Swagger
│
├── common/
│   ├── config/
│   │   ├── env.ts                # Fonte única da verdade — TypeBox validated
│   │   ├── hawkbit.ts            # Thin accessor tipado sobre env (zero process.env)
│   │   ├── auth.ts               # Better Auth config
│   │   ├── auth-client.ts        # Better Auth client
│   │   └── email.ts              # Resend email helper
│   ├── db/
│   │   ├── index.ts              # Drizzle client (pool max 10)
│   │   └── schema/               # Drizzle table definitions
│   │       ├── auth.ts           # Better Auth tables
│   │       ├── companies.ts      # companies + company_members
│   │       ├── categories.ts     # categories (bus_line, garage, yard, region, custom)
│   │       ├── devices.ts        # devices (serial_number + serial_display) + N:N
│   │       ├── posts.ts          # Posts (reference)
│   │       └── index.ts          # Barrel exports
│   ├── hawkbit/
│   │   ├── client.ts             # Barrel re-export (<100 lines)
│   │   ├── http.ts               # HTTP client — Basic Auth, timeout, TLS
│   │   ├── targets.ts            # Target CRUD, attributes, actions, DS assignment
│   │   ├── distribution-sets.ts  # Distribution Set CRUD, target assignment, stats
│   │   ├── software-modules.ts   # Software Module CRUD, artifact upload/download
│   │   ├── constants.ts          # Ninbus artifact types
│   │   └── types.ts              # hawkBit API DTO interfaces
│   ├── middleware/
│   │   ├── auth-guard.ts         # withAuth() — macros auth + companyRole
│   │   ├── company-check.ts      # checkMembership() shared helper
│   │   ├── company-guard.ts      # hasCompanyRole() standalone middleware
│   │   ├── rate-limiter.ts       # Rate limiting global + auth
│   │   └── request-logger.ts     # Structured request logging
│   ├── logger/index.ts           # Pino logger (JSON em produção)
│   ├── schemas/index.ts          # ErrorResponseSchema + GenericActionResponseSchema
│   └── utils/
│       └── serial-number.ts      # Serial number normalization (hex ↔ dotted)
│
├── modules/
│   ├── auth/                     # Better Auth routes
│   ├── companies/                # Multi-tenancy CRUD + members
│   ├── categories/               # Device grouping
│   ├── devices/                  # Device registry + hawkBit integration
│   │   ├── index.ts              # CRUD + claim
│   │   ├── schemas.ts            # Validation schemas
│   │   ├── service.ts            # CRUD + hawkBit sync
│   │   ├── provisioning.ts       # Factory provisioning (provision + claim + link)
│   │   ├── provision-routes.ts   # Platform routes (POST /provision, GET /unclaimed)
│   │   ├── hawkbit-routes.ts     # hawkBit operations (attributes, actions)
│   │   ├── category-routes.ts    # Category N:N assignment
│   │   ├── auth.ts               # loadDevice + requireHawkbitLink helpers
│   │   └── sync.ts               # hawkBit ↔ Ninbus sync engine
│   ├── deployments/              # OTA deployments via Distribution Sets
│   ├── artifacts/                # Firmware management via Software Modules
│   ├── health/                   # GET /health
│   └── posts/                    # Reference CRUD module
│
└── scripts/
    ├── migrate.ts                # Drizzle migrations runner
    └── seed.ts                   # Database seeder

tests/                            # 139 testes Bun
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

### Provisioning (`/api/devices/*`) — Platform Routes

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/devices/provision` | ✅ | Pré-registrar dispositivo (cria hawkBit target) |
| GET | `/api/devices/unclaimed` | ✅ | Listar dispositivos sem empresa |

> Estas rotas são **platform-level** — usam `auth: true` apenas, sem `companyRole`.

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
| DELETE | `/:deviceId/actions/:actionId` | operator | Cancelar ação |

### Categorias (`/api/companies/:companyId/categories/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/` | viewer | Listar |
| POST | `/` | operator | Criar |
| GET | `/:categoryId` | viewer | Detalhes |
| PUT | `/:categoryId` | operator | Atualizar |
| DELETE | `/:categoryId` | admin | Remover |

### Deployments (`/api/companies/:companyId/deployments/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/artifact-types` | viewer | Tipos de artefato Ninbus |
| POST | `/` | operator | Criar deployment OTA |
| GET | `/` | viewer | Listar |
| GET | `/:deploymentId` | viewer | Detalhes |
| DELETE | `/:deploymentId` | admin | Remover |
| GET | `/:deploymentId/statistics` | viewer | Estatísticas hawkBit |
| GET | `/:deploymentId/targets` | viewer | Targets no deployment |

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

> Retorna 503 se hawkBit offline, 400 se hawkBit disabled.

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
| Artifact | Binary file | Arquivo raw (.fir/.frz/.bin) |
| Distribution Set | Deployment | Agrupa SMs e é atribuído a targets |
| Target Attributes | Device inventory | Hardware/software info |
| Action | Deployment status | Status por target |
| DDI | Device polling | `GET /{tenant}/controller/v1/{controllerId}` |

### Fluxo de Provisioning

```
POST /devices/provision {serialNumber, deviceKey}
  → normalizeSerial() → hex + display
  → hawkbitTargets.create({controllerId: hex, securityToken: deviceKey})
  → db.insert({serialNumber: hex, serialDisplay: display, status: "unclaimed"})
```

### Fluxo de Deployment

```
POST /deployments {artifactType, targets}
  → cria Software Module → upload binary
  → cria Distribution Set → assigna targets
  → hawkBit envia firmware via DDI polling
```

### Fluxo DDI (Dispositivo)

```
Device poll: GET /DEFAULT/controller/v1/{controllerId}
             Authorization: TargetToken {securityToken}
  → 200 OK (config + polling interval)
  → hawkBit envia deployment action quando disponível
  → device download binary → instala → reporta status
```

### API hawkBit Usada

| Endpoint | Método | Uso |
|----------|--------|-----|
| `/rest/v1/targets` | GET/POST | Listar/criar targets |
| `/rest/v1/targets/{id}` | GET/PUT/DELETE | CRUD de target |
| `/rest/v1/targets/{id}/attributes` | GET | Atributos do device |
| `/rest/v1/targets/{id}/actions` | GET/DELETE | Ações de deployment |
| `/rest/v1/softwaremodules` | GET/POST | CRUD de SM |
| `/rest/v1/softwaremodules/{id}/artifacts` | POST (multipart) | Upload de binário |
| `/rest/v1/distributionsets` | GET/POST/DELETE | CRUD de DS |
| `/rest/v1/distributionsets/{id}/assignedTargets` | GET/POST | Atribuir targets |
| `/rest/v1/distributionsets/{id}/statistics` | GET | Estatísticas |
| `/rest/v1/system/configs` | GET/PUT | Config do hawkBit (TargetToken auth) |

---

## Testes

```bash
# Rode os testes (usa .env.test automaticamente)
bun test

# Com env override (CI)
DATABASE_URL="..." HAWKBIT_ENABLED=false bun test

# Módulo específico
bun test tests/devices.test.ts
```

**139 testes** cobrindo: auth, CRUD de empresas/dispositivos/categorias, deployments, artefatos, health, RBAC, validação, autorização, hawkBit error guards.

---

## Scripts

| Script | Descrição |
|--------|-----------|
| `bun run dev` | Servidor com hot reload |
| `bun run build` | Build de produção (single bundle) |
| `bun run start` | Iniciar build de produção |
| `bun test` | Rodar testes |
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
| [Eclipse hawkBit](https://eclipse.org/hawkbit/) | OTA deployment server (Management + DDI) |

---

## Licença

Projeto proprietário — Ninbus Tecnologia.
