# Ninbus API

Backend da plataforma IoT Ninbus — gerenciamento de dispositivos, deployments OTA e orquestração de frotas.

Construído com **Bun** + **Elysia** + **Better Auth** + **Drizzle ORM** + **Mender Gateway**.

---

## Visão Geral

```
Frontend ──▶ Ninbus API ──▶ Mender Gateway (Traefik)
   │             │                    │
   │             │              ┌─────┴─────┐
   │             │              │ Microserviços Mender
   │             │              │ deviceauth, deployments,
   │             │              │ inventory, deviceconnect
   │             │              └───────────┘
   │             │
   │        PostgreSQL
   │     (dispositivos, empresas,
   │      categorias, sessões)
   │
   └── Dispositivos IoT (Ninbus WiFi v3)
       firmware-ninbus | firmware-controller | configuration-nfx
```

O Ninbus API é a camada de negócio entre o frontend e o Mender. Ele gerencia:

- **Multi-tenancy** — empresas, membros, roles (owner/admin/operator/viewer)
- **Dispositivos** — registro, vinculação com Mender, categorização (linhas, garagens, pátios)
- **Deployments OTA** — criação, monitoramento, abort por dispositivo
- **Artefatos** — upload `.mender`, listagem, releases, metadados por tipo
- **Sincronização** — auto-aceite de dispositivos pendentes via serial number

---

## Quick Start

### Pré-requisitos

- [Bun](https://bun.sh) >= 1.1
- [PostgreSQL](https://www.postgresql.org/) >= 16
- [Docker](https://www.docker.com/) (opcional, para Mender Gateway)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/ninbus/ninbus-api.git
cd ninbus-api

# Instale as dependências
bun install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com seus valores (veja seção Configuração abaixo)

# Rode as migrations
bun run db:migrate

# Inicie o servidor em modo desenvolvimento
bun run dev
```

O servidor inicia em `http://localhost:3000` (ou a porta configurada em `PORT`).

### Usando Docker

```bash
# Build e suba os containers
bun run docker:build
bun run docker:up

# Veja os logs
bun run docker:logs
```

---

## Documentação da API

Após iniciar o servidor, acesse a documentação interativa:

```
http://localhost:3000/docs
```

A documentação é gerada automaticamente via **Scalar** + **OpenAPI 3.0**. Todas as rotas, body schemas, response schemas e exemplos estão documentados lá.

### Health Check

```bash
curl http://localhost:3000/health
```

---

## Configuração

Todas as variáveis são validadas no startup via TypeBox. Copie `.env.example` para `.env`:

```bash
cp .env.example .env
```

### Variáveis Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | Connection string PostgreSQL | `postgresql://postgres:postgres@localhost:5432/ninbus_db` |
| `BETTER_AUTH_SECRET` | Secret para sessões (mín 32 chars) | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | URL base da API (para redirects) | `http://localhost:3000` |
| `REQUIRE_EMAIL_VERIFICATION` | Exigir verificação de email | `false` |
| `RESEND_API_KEY` | API key do Resend (opcional) | — |
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
| `RATE_LIMIT_WINDOW_MS` | `60000` | Janela de tempo (ms) rate limit global |
| `RATE_LIMIT_MAX` | `100` | Max requisições global por IP |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `60000` | Janela de tempo (ms) rate limit auth |
| `AUTH_RATE_LIMIT_MAX` | `10` | Max requisições auth por IP |

### Mender Gateway

| Variável | Default | Descrição |
|----------|---------|-----------|
| `MENDER_ENABLED` | `false` | Habilita integração com Mender |
| `MENDER_GATEWAY_URL` | — | URL do Traefik Gateway do Mender |
| `MENDER_PAT` | — | Personal Access Token do Mender |
| `MENDER_TIMEOUT_MS` | `30000` | Timeout das requisições |
| `MENDER_HOST_OVERRIDE` | — | Override do header Host (para Docker) |
| `MENDER_SKIP_TLS` | `false` | Ignora certificado TLS (dev) |
| `MENDER_TENANT_TOKEN` | — | Token para Mender multi-tenant |

> **Nota**: O PAT é obtido via `POST /api/management/v1/useradm/settings/tokens` no Mender.

---

## Estrutura do Projeto

```
src/
├── index.ts                      # Entrypoint — migrations + server + graceful shutdown
├── app.ts                        # Composition root — middleware + módulos
│
├── common/
│   ├── config/
│   │   ├── env.ts                # Fonte única da verdade — 24 vars validadas por TypeBox
│   │   ├── mender.ts             # Thin accessor tipado sobre env (zero process.env)
│   │   ├── auth.ts               # Better Auth config (session, email, cookies)
│   │   ├── auth-client.ts        # Better Auth client (email OTP plugin)
│   │   └── email.ts              # Resend email helper
│   ├── db/
│   │   ├── index.ts              # Drizzle client (pool max 10)
│   │   └── schema/               # Drizzle table definitions
│   │       ├── auth.ts           # Better Auth tables (user, session, account, verification)
│   │       ├── companies.ts      # companies + company_members
│   │       ├── categories.ts     # categories (bus_line, garage, yard, region, custom)
│   │       ├── devices.ts        # devices + device_category_assignments
│   │       ├── posts.ts          # Posts (reference)
│   │       └── index.ts          # Barrel exports
│   ├── mender/
│   │   ├── artifact-generator.ts # Pure TS .mender v3 generator (tar+gzip)
│   │   ├── client.ts             # API functions (deviceauth, deployments, inventory, connect)
│   │   ├── http.ts               # HTTP client — PAT injection, Host override, TLS skip
│   │   └── types.ts              # Mender DTO interfaces
│   ├── middleware/
│   │   ├── auth-guard.ts         # withAuth() — deriva user/session + macro auth
│   │   ├── company-check.ts      # checkMembership() — shared authorization helper
│   │   ├── company-guard.ts      # hasCompanyRole() — role-based middleware
│   │   ├── rate-limiter.ts       # Rate limiting global + auth
│   │   └── request-logger.ts     # Structured request logging
│   ├── logger/
│   │   └── index.ts              # Pino logger (silent em testes)
│   └── schemas/
│       └── index.ts              # ErrorResponseSchema + GenericActionResponseSchema
│
├── modules/
│   ├── artifacts/                # Upload, generate, list, delete, releases
│   │   ├── schemas.ts            # Body + response schemas + constants
│   │   ├── service.ts            # Validation, Mender proxy, artifact generation
│   │   ├── index.ts              # POST /upload + POST /generate + GET /types
│   │   └── manage-routes.ts      # GET / list, get, delete, download, releases
│   ├── auth/                     # Better Auth routes
│   │   ├── schemas.ts            # Auth body + response schemas
│   │   └── index.ts              # sign-up, sign-in, sign-out, session, password reset
│   ├── categories/               # Device grouping (bus_line, garage, yard, region)
│   │   ├── schemas.ts            # Category schemas
│   │   ├── service.ts            # Category CRUD logic
│   │   └── index.ts              # Category routes
│   ├── companies/                # Multi-tenancy CRUD + members
│   │   ├── schemas.ts            # Company + member schemas
│   │   ├── service.ts            # Company + member CRUD logic
│   │   ├── index.ts              # Company CRUD routes
│   │   └── member-routes.ts      # Member management routes
│   ├── deployments/              # OTA deployment creation + monitoring
│   │   ├── schemas.ts            # Schemas + param schemas
│   │   ├── service.ts            # Mender deployment logic
│   │   ├── index.ts              # POST create + GET artifact-types + GET deployment
│   │   └── device-routes.ts      # Abort, statistics, device list, logs, history
│   ├── devices/                  # Ninbus device registry
│   │   ├── schemas.ts            # Body + response schemas
│   │   ├── service.ts            # CRUD + Mender integration + sync trigger
│   │   ├── sync.ts               # Mender ↔ Ninbus sync engine
│   │   ├── auth.ts               # checkMembership + loadDevice + requireMenderLink
│   │   ├── index.ts              # CRUD routes
│   │   └── mender-routes.ts      # Approve, reject, decommission, check-update, inventory, connection
│   ├── health/                   # GET /health
│   └── posts/                    # Reference CRUD module
│       ├── schemas.ts
│       ├── service.ts
│       └── index.ts
│
└── scripts/
    ├── migrate.ts                # Drizzle migrations runner
    └── seed.ts                   # Database seeder

tests/                            # 184 testes Bun
├── auth.test.ts
├── artifacts.test.ts
├── categories.test.ts
├── companies.test.ts
├── deployments.test.ts
├── devices.test.ts
├── health.test.ts
└── posts.test.ts
```

### Padrão por Módulo

Cada módulo segue a mesma estrutura:

```
module/
├── schemas.ts     ← Body schemas, response schemas, param schemas
├── service.ts     ← Lógica de negócio (DB + Mender calls)
├── index.ts       ← Rotas CRUD principais (importa schemas)
└── *-routes.ts    ← Rotas extras (split por operação quando > 200 linhas)
```

**Regra**: Arquivos de rota NUNCA definem response schemas inline — sempre importam do `schemas.ts`.

---

## Rotas da API

### Autenticação (`/api/auth/*`)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/sign-up/email` | Registrar com email + senha + nome |
| POST | `/api/auth/sign-in/email` | Login com email + senha |
| POST | `/api/auth/sign-out` | Encerrar sessão |
| GET | `/api/auth/get-session` | Sessão atual |
| POST | `/api/auth/request-password-reset` | Solicitar reset de senha |
| POST | `/api/auth/reset-password` | Resetar senha com token |

> Body schemas documentados nas route descriptions (Better Auth lê body internamente).

### Empresas (`/api/companies/*`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/api/companies` | ✅ | Listar empresas do usuário |
| POST | `/api/companies` | ✅ | Criar empresa |
| GET | `/api/companies/:companyId` | ✅ Membro | Detalhes da empresa |
| PUT | `/api/companies/:companyId` | ✅ Membro | Atualizar empresa |
| DELETE | `/api/companies/:companyId` | ✅ Membro | Remover empresa |
| GET | `/api/companies/:companyId/members` | ✅ Membro | Listar membros |
| POST | `/api/companies/:companyId/members` | ✅ Membro | Adicionar membro |

### Dispositivos (`/api/companies/:companyId/devices/*`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Listar dispositivos da empresa |
| POST | `/` | Registrar dispositivo |
| GET | `/:deviceId` | Detalhes (com sync Mender) |
| PUT | `/:deviceId` | Atualizar dispositivo |
| DELETE | `/:deviceId` | Remover dispositivo |
| GET | `/:deviceId/categories` | Categorias do dispositivo |
| PUT | `/:deviceId/categories` | Atribuir categorias |
| POST | `/:deviceId/approve` | Aprovar no Mender |
| POST | `/:deviceId/reject` | Rejeitar no Mender |
| POST | `/:deviceId/decommission` | Descommissionar do Mender |
| POST | `/:deviceId/check-update` | Forçar verificação de update |
| GET | `/:deviceId/inventory` | Inventory do Mender |
| GET | `/:deviceId/connection` | Estado de conexão |

### Deployments (`/api/companies/:companyId/deployments/*`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/artifact-types` | Tipos de artefato Ninbus |
| POST | `/` | Criar deployment OTA |
| GET | `/:deploymentId` | Detalhes do deployment |
| PUT | `/:deploymentId/status` | Abortar deployment |
| GET | `/:deploymentId/statistics` | Estatísticas de progresso |
| GET | `/:deploymentId/devices` | Lista de dispositivos no deployment |
| GET | `/:deploymentId/devices/:menderDeviceId/log` | Log de instalação do dispositivo |
| DELETE | `/devices/:menderDeviceId/deployments` | Abortar todos deployments do dispositivo |
| GET | `/devices/:deviceId/history` | Histórico de deployments |

### Artefatos (`/api/companies/:companyId/artifacts/*`)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/` | Upload de artefato `.mender` |
| POST | `/generate` | Gerar `.mender` a partir de firmware raw (.fir/.frz/.bin) |
| GET | `/types` | Tipos de artefato Ninbus |
| GET | `/` | Listar artefatos |
| GET | `/:artifactId` | Detalhes do artefato |
| GET | `/:artifactId/download` | Link de download |
| DELETE | `/:artifactId` | Remover artefato |
| PUT | `/:artifactId` | Atualizar descrição |
| GET | `/releases` | Listar releases |

---

## Tipos de Artefato Ninbus

O sistema suporta 3 tipos de artefato para dispositivos Ninbus WiFi v3:

| Tipo | Destino | Risco | Reboot |
|------|---------|-------|--------|
| `firmware-ninbus` | NAND → Bootloader → STM32F407 | 🔴 HIGH | ✅ Sim |
| `firmware-controller` | CAN Bus → LightDot | 🟡 MEDIUM | ❌ Não |
| `configuration-nfx` | NAND NFX → CAN → LightDot | 🟢 LOW | ❌ Não |

---

## Testes

```bash
# Suba o PostgreSQL
docker run -d --name ninbus-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ninbus_db \
  -p 5432:5432 \
  postgres:16-alpine

# Rode as migrations no banco de teste
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ninbus_db bun run db:migrate

# Rode os testes
bun test

# Ou em modo watch
bun run test:watch
```

**184 testes** cobrindo: auth, CRUD de empresas/dispositivos/categorias, deployments, artefatos, health, validação, autorização.

---

## Scripts Disponíveis

| Script | Comando | Descrição |
|--------|---------|-----------|
| `dev` | `bun run dev` | Servidor com hot reload |
| `build` | `bun run build` | Build de produção |
| `start` | `bun run start` | Iniciar build de produção |
| `test` | `bun test` | Rodar testes |
| `lint` | `bun run lint` | Lint com Biome |
| `lint:fix` | `bun run lint:fix` | Lint + auto-fix |
| `format` | `bun run format` | Format com Biome |
| `db:generate` | `bun run db:generate` | Gerar migration |
| `db:migrate` | `bun run db:migrate` | Rodar migrations |
| `db:push` | `bun run db:push` | Push schema direto (dev) |
| `db:seed` | `bun run db:seed` | Popular banco |
| `db:studio` | `bun run db:studio` | Drizzle Studio |
| `docker:build` | `bun run docker:build` | Build Docker image |
| `docker:up` | `bun run docker:up` | Subir containers |
| `docker:down` | `bun run docker:down` | Derrubar containers |
| `docker:logs` | `bun run docker:logs` | Ver logs dos containers |

---

## Stack

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| [Bun](https://bun.sh) | >= 1.1 | Runtime + bundler + test runner |
| [Elysia](https://elysiajs.com) | latest | Web framework (plugins, macros, OpenAPI) |
| [Better Auth](https://better-auth.com) | latest | Autenticação (email/password, sessões, cookies) |
| [Drizzle ORM](https://orm.drizzle.team) | latest | ORM PostgreSQL com TypeBox schemas |
| [TypeBox](https://github.com/sinclairtypebox/typebox) | latest | Runtime type validation |
| [Biome](https://biomejs.dev) | latest | Linter + formatter |
| [Scalar](https://scalar.com) | — | Documentação OpenAPI interativa |
| Mender Gateway | — | OTA deployment server (externo) |

---

## Arquitetura

```
┌──────────────────────────────────────────────────────┐
│                    Ninbus API                         │
│                                                      │
│  Route (handler)  →  Service (logic)  →  Adapter     │
│  schemas.ts            service.ts        mender/     │
│  index.ts              (Drizzle DB)      client.ts   │
│  *-routes.ts                            http.ts      │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐   │
│  │  Better     │  │  Drizzle   │  │  Mender HTTP   │  │
│  │  Auth       │  │  ORM       │  │  Client        │  │
│  │  (sessions) │  │  (Postgres)│  │  (PAT + Host)  │  │
│  └────────────┘  └────────────┘  └───────────────┘   │
│                                                      │
│  env.ts → Single source of truth (24 vars validadas) │
└──────────────────────────────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │   Mender Gateway    │
              │   (Traefik v3.6)    │
              │                     │
              │  deviceauth         │
              │  deployments        │
              │  inventory          │
              │  deviceconnect      │
              └─────────────────────┘
```

### Fluxo de Autorização

```
Request → auth-guard (withAuth) → company-check (checkMembership) → loadDevice → requireMenderLink → handler
                │                        │                              │              │
          deriva user/session       verifica membro              busca dispositivo   verifica vínculo Mender
          rejeita 401 se não auth  rejeita 403 se não membro     rejeita 404 se não   rejeita 400 se não linkado
```

---

## Licença

Projeto proprietário — Ninbus Tecnologia.
