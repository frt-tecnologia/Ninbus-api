---
name: ninbus-api-standards
description: >
  Padrões de arquitetura, segurança, estilo de código e qualidade para o Ninbus API
  (Elysia + Bun + Drizzle + Better Auth + Eclipse hawkBit 1.0.3).
  Use esta skill ao criar novos módulos, rotas, schemas, testes ou ao revisar código existente.
  Abrange: estrutura de módulos, validação de body/params/query, autenticação, autorização (RBAC por empresa),
  rate limiting, tipos de artefato OTA (firmware-ninbus, firmware-controller, configuration-nfx),
  integração hawkBit (Management API + DDI), tratamento de erros, naming conventions, testes.
---

# Ninbus API — Padrões de Engenharia de Software

## Visão Geral

Este documento é a **fonte única de verdade** para padrões de código, arquitetura e segurança do projeto Ninbus API.
Toda contribuição DEVE seguir estas diretrizes.

---

## 1. Stack & Arquitetura

| Camada | Tecnologia | Responsabilidade |
|--------|-----------|-----------------|
| Runtime | Bun (≥1.1.0) | Execução, testes, bundling |
| Framework | Elysia.js (≥1.4) | HTTP server, rotas, middleware, macros |
| ORM | Drizzle ORM + postgres.js | Queries tipadas, migrations |
| Auth | Better Auth | Sessões cookie-based, CSRF, email/password |
| OTA Server | Eclipse hawkBit 1.0.3 | Targets, Distribution Sets, Software Modules, DDI |
| Validação | TypeBox (via Elysia built-in) | Schema validation no body/params/response |
| Linter | Biome (tabs, single quotes, trailing commas) | Formatação e linting |
| Logging | Pino (JSON em prod, pino-pretty em dev) | Logs estruturados |
| Email | Resend (fallback console) | Transacional |
| Rate Limiting | LRU Cache (custom) | Proteção contra abuso |
| Docs API | @elysiajs/swagger + Scalar | Documentação interativa |

### Arquitetura Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                     NINBUS API (Elysia + Bun)                    │
│                                                                  │
│  Módulos (8):                                                    │
│  ├── Auth         → Better Auth (sign-up, sign-in, sessions)    │
│  ├── Companies    → Multi-tenancy (CRUD + members + RBAC)       │
│  ├── Categories   → Device grouping (bus_line, garage, yard...) │
│  ├── Devices      → Registry + hawkBit integration (N:N cats)   │
│  ├── Deployments  → OTA creation/monitoring via hawkBit DS      │
│  ├── Artifacts    → Firmware management via hawkBit SM           │
│  ├── Posts        → CRUD reference implementation               │
│  └── Health       → Server health check                         │
│                                                                  │
│  Infra:                                                          │
│  ├── hawkBit Client    → Typed HTTP client (Basic Auth)         │
│  ├── Auth Guard        → withAuth() + macros (auth, companyRole)│
│  ├── Company Guard     → Role-based authorization middleware     │
│  └── DB Schema        → companies, categories, devices, N:N     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Authorization: Basic admin:admin
                           ▼
                ┌──────────────────────┐
                │  ECLIPSE HAWKBIT 1.0.3│
                │  Management API       │
                │  + DDI (Device Poll)  │
                └──────────┬───────────┘
                           │
                    ┌──────┴──────┐
                    │  Dispositivos│
                    │  Ninbus WiFi │
                    │  v3 (100k+)  │
                    └─────────────┘
```

### Estrutura de Diretórios

```
src/
├── app.ts                          # Composition root (createApp factory)
├── index.ts                        # Entry point + graceful shutdown
├── common/
│   ├── config/                     # env.ts, auth.ts, auth-client.ts, email.ts, hawkbit.ts
│   ├── db/
│   │   ├── index.ts                # Drizzle client singleton (pool max 10)
│   │   └── schema/                 # Drizzle schemas
│   │       ├── auth.ts             # Better Auth tables (user, session, account, verification)
│   │       ├── companies.ts        # companies + company_members (roles: owner/admin/operator/viewer)
│   │       ├── categories.ts       # categories (type: bus_line, garage, yard, region, custom)
│   │       ├── devices.ts          # devices + device_category_assignments (N:N PK)
│   │       ├── posts.ts            # Posts (reference implementation)
│   │       └── index.ts            # Barrel exports
│   ├── hawkbit/
│   │   ├── client.ts              # Barrel re-export + utility functions (<100 lines)
│   │   ├── http.ts                # Core HTTP client (Basic Auth, timeout, TLS, error class)
│   │   ├── targets.ts             # Target CRUD, attributes, actions, DS assignment
│   │   ├── distribution-sets.ts   # Distribution Set CRUD, target assignment, stats
│   │   ├── software-modules.ts    # Software Module CRUD, artifact upload/download
│   │   ├── constants.ts           # Ninbus artifact types
│   │   └── types.ts               # hawkBit API DTO interfaces
│   ├── middleware/
│   │   ├── auth-guard.ts           # withAuth() derive + macros (auth + companyRole)
│   │   ├── company-check.ts        # checkMembership() shared helper
│   │   ├── company-guard.ts        # hasCompanyRole() standalone role middleware
│   │   ├── rate-limiter.ts         # createRateLimiter() factory
│   │   └── request-logger.ts       # onRequest/onAfterResponse logging
│   ├── logger/index.ts             # Pino logger (silent em testes)
│   ├── schemas/index.ts            # ErrorResponseSchema + GenericActionResponseSchema
│   └── utils/
│       └── serial-number.ts        # Serial number normalization (hex ↔ dotted)
├── modules/
│   ├── auth/index.ts + schemas.ts  # Better Auth routes (body in description, not schema)
│   ├── companies/                  # Multi-tenancy (4 files)
│   ├── categories/                 # Device grouping (3 files)
│   ├── devices/                    # Device registry + hawkBit integration (7 files)
│   │   ├── index.ts               # Device CRUD + claim
│   │   ├── schemas.ts             # Body/params/response schemas
│   │   ├── service.ts             # CRUD + hawkBit sync
│   │   ├── provisioning.ts        # Factory provisioning (provision + claim + link)
│   │   ├── provision-routes.ts    # POST /provision + GET /unclaimed (platform routes)
│   │   ├── hawkbit-routes.ts      # hawkBit operations (attributes, actions)
│   │   ├── category-routes.ts     # Category assignment (N:N)
│   │   ├── auth.ts                # loadDevice + requireHawkbitLink helpers
│   │   └── sync.ts                # hawkBit ↔ Ninbus sync engine
│   ├── deployments/                # OTA deployments via Distribution Sets (4 files)
│   ├── artifacts/                  # Firmware management via Software Modules (4 files)
│   ├── health/index.ts             # Health check
│   └── posts/                      # CRUD reference (3 files)
├── scripts/                        # migrate.ts, seed.ts
├── types/                          # elysia.d.ts (Context augmentation)
tests/
    ├── auth.test.ts                # Auth module tests
    ├── artifacts.test.ts           # Artifact CRUD + upload + types
    ├── companies.test.ts           # Company + member tests
    ├── categories.test.ts          # Category CRUD tests
    ├── devices.test.ts             # Device + provision + claim tests
    ├── deployments.test.ts         # Deployment + artifact types
    ├── health.test.ts              # Health check tests
    └── posts.test.ts               # Posts CRUD + ownership
```

### Princípios Arquiteturais

1. **Factory Pattern** — `createApp()` para testabilidade
2. **Modularização por Feature** — cada módulo em `src/modules/<nome>/`
3. **Separação de Concerns** — routes → schemas → service
4. **Dependency Injection via Context** — `withAuth()` injeta `user`/`session`
5. **Company-scoped Operations** — Toda operação hawkBit filtrada por empresa
6. **Fail-Fast** — validação de env no startup com TypeBox
7. **Two-Level Error Guard** — hawkBit calls: config check (service) + network catch (route)
8. **Platform vs Company Routes** — routes sem `:companyId` usam `auth: true` only

---

## 2. Convenções de Código

### 2.1 Naming

| Elemento | Convenção | Exemplo |
|----------|-----------|---------|
| Arquivos | kebab-case | `auth-guard.ts`, `company-guard.ts` |
| Diretórios | kebab-case | `common/`, `modules/`, `hawkbit/` |
| Variáveis/Funções | camelCase | `getAllPosts()`, `getAuthCookie()` |
| Constantes | UPPER_SNAKE_CASE ou camelCase | `ARTIFACT_TYPE_NINBUS_FIRMWARE`, `appLogger` |
| Tipos/Interfaces | PascalCase | `Post`, `NewPost`, `Env` |
| Schemas TypeBox | PascalCase + sufixo Schema | `ProvisionDeviceSchema` |
| Exportações de módulo | camelCase + sufixo Module | `postsModule`, `deploymentsModule` |
| DB Enums | camelCase + sufixo Enum | `companyRoleEnum`, `deviceStatusEnum` |
| Rotas API | kebab-case com prefixo | `/api/companies`, `/api/auth/sign-up/email` |

### 2.2 Formatação (Biome)

- **Indentação**: Tabs (largura 2)
- **Aspas**: Single quotes
- **Trailing commas**: Sim
- **Semicolons**: Sempre
- **Line width**: 100 caracteres

### 2.3 TypeScript

- **Strict mode** habilitado
- **Tipagem explícita** de returns em services
- **`any` permitido** em handlers Elysia (dentro de `({ params, body, user, set }: any)`)
- **Path aliases**: `@/*`, `@common/*`, `@modules/*`

### 2.4 Exportações

- **Named exports** para tudo (NUNCA `export default`)
- **Barrel exports** em `schema/index.ts`, `hawkbit/client.ts`
- Cada módulo exporta `{Feature}Module` como named export

---

## 3. hawkBit Integration

### 3.1 Conceitos hawkBit ↔ Ninbus

| hawkBit | Ninbus API | Descrição |
|---------|-----------|-----------|
| Target (controllerId) | Device | Dispositivo IoT com status de conexão |
| Software Module | Artifact container | Container tipado (firmware-ninbus, etc.) |
| Artifact Binary | Firmware file | Arquivo raw (.fir/.frz/.bin) |
| Distribution Set | Deployment | Agrupa SMs e é atribuído a targets |
| Target Attributes | Device inventory | Hardware/software info do device |
| Action | Deployment status | Status por target (running/finished/error) |
| DDI | Device polling | `GET /{tenant}/controller/v1/{controllerId}` |

### 3.2 Authentication

| API | Auth Method | Credenciais |
|-----|------------|-------------|
| Management API (`/rest/v1/*`) | HTTP Basic Auth | `HAWKBIT_USERNAME: HAWKBIT_PASSWORD` |
| DDI (`/{tenant}/controller/v1/*`) | TargetToken | `Authorization: TargetToken {securityToken}` |

### 3.3 hawkBit Client Architecture

```
src/common/hawkbit/
├── client.ts              # Barrel: re-exports targets, distribution-sets, etc.
├── http.ts                # Core: hawkbitRequest<T>() — Basic Auth, timeout, TLS
├── targets.ts             # hawkbitTargets: CRUD, attributes, actions, DS assignment
├── distribution-sets.ts   # hawkbitDistributionSets: CRUD, target assignment, stats
├── software-modules.ts    # hawkbitSoftwareModules: CRUD, artifact upload/download
├── constants.ts           # NINBUS_ARTIFACT_TYPES, NINBUS_DEVICE_TYPE
└── types.ts               # HawkbitTarget, HawkbitAction, HawkbitDS, etc.
```

### 3.4 hawkBit API Patterns

**Bulk POST (array body):**
```typescript
// hawkBit Management API requer array body para POSTs
// client.ts converte automaticamente
await hawkbitTargets.create({ controllerId: 'ABC', name: 'Dev' });
// → HTTP body: [{ controllerId: 'ABC', name: 'Dev' }]
// → Response: [{ controllerId: 'ABC', ... }]
```

**Multipart upload:**
```typescript
// Artifact upload requer FormData
const formData = new FormData();
formData.append('file', binaryFile);
await hawkbitSoftwareModules.uploadArtifact(moduleId, formData);
```

**Two-level error guard:**
```typescript
// Service: check config
if (!hawkbitConfig.enabled) throw new ArtifactValidationError('hawkBit disabled');

// Route handler: catch network errors
try {
  const data = await service.listArtifacts();
} catch (error) {
  if (error instanceof ArtifactValidationError) { set.status = 400; ... }
  else { set.status = 503; ... }  // hawkBit unreachable
}
```

### 3.5 DDI (Device Direct Integration)

**Requisitos obrigatórios do hawkBit server:**

1. `authentication.targettoken.enabled = true` — hawkBit 1.0.3 vem com false por padrão!
2. `hawkbit.server.ddi.autoprovisioning.enabled = true` — auto-cria target no primeiro poll

**Formato do poll do dispositivo:**
```
GET /DEFAULT/controller/v1/2100280018513531 HTTP/1.1
Host: 192.168.1.102:8080
Authorization: TargetToken key-test
```

**Config no docker-compose.yml:**
```yaml
HAWKBIT_SERVER_DDI_SECURITY_AUTHENTICATION_TARGETTOKEN_ENABLED: true
HAWKBIT_SERVER_DDI_AUTOPROVISIONING_ENABLED: true
```

---

## 4. Catálogo de Módulos e Rotas

### 4.1 Provisioning (`/api/devices/*`) — Platform Routes

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/devices/provision` | ✅ | Pré-registrar dispositivo (cria hawkBit target) |
| GET | `/api/devices/unclaimed` | ✅ | Listar dispositivos sem empresa |

> **Platform routes** usam `auth: true` only — NUNCA `companyRole` (não têm `:companyId` no path).

### 4.2 Devices (`/api/companies/:companyId/devices/*`)

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

### 4.3 Artifacts (`/api/companies/:companyId/artifacts/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| POST | `/` | operator | Upload firmware (.fir/.frz/.bin) |
| GET | `/types` | viewer | Tipos de artefato Ninbus |
| GET | `/` | viewer | Listar artefatos |
| GET | `/:artifactId` | viewer | Detalhes |
| GET | `/:artifactId/download` | viewer | Download info |
| PUT | `/:artifactId` | operator | Atualizar descrição |
| DELETE | `/:artifactId` | admin | Remover |

> Todos os artifact routes retornam 503 se hawkBit estiver offline, 400 se disabled.

### 4.4 Deployments (`/api/companies/:companyId/deployments/*`)

| Método | Rota | Role mín. | Descrição |
|--------|------|-----------|-----------|
| GET | `/artifact-types` | viewer | Tipos de artefato |
| POST | `/` | operator | Criar deployment OTA |
| GET | `/` | viewer | Listar deployments |
| GET | `/:deploymentId` | viewer | Detalhes |
| DELETE | `/:deploymentId` | admin | Remover |
| GET | `/:deploymentId/statistics` | viewer | Estatísticas hawkBit |
| GET | `/:deploymentId/targets` | viewer | Targets no deployment |

### 4.5 Auth, Companies, Categories, Posts

Ver documentação completa no README.md.

---

## 5. Tipos de Artefato Ninbus

O sistema suporta **3 tipos de artefato OTA** para dispositivos Ninbus WiFi v3:

| Tipo | Destino | Risco | Reboot | Payload |
|------|---------|-------|--------|---------|
| `firmware-ninbus` | NAND → Bootloader → STM32F407 | 🔴 HIGH | ✅ | `.fir` |
| `firmware-controller` | CAN → LightDot | 🟡 MEDIUM | ❌ | `.fir` |
| `configuration-nfx` | NAND NFX → CAN → LightDot | 🟢 LOW | ❌ | `.frz` |

### Validação no schema:
```typescript
artifactType: t.Union([
  t.Literal('firmware-ninbus'),
  t.Literal('firmware-controller'),
  t.Literal('configuration-nfx'),
]),
```

### Constantes canônicas:
```typescript
// src/common/hawkbit/constants.ts
export const NINBUS_ARTIFACT_TYPES = {
  NINBUS_FIRMWARE: 'firmware-ninbus',
  CONTROLLER_FIRMWARE: 'firmware-controller',
  NFX_CONFIGURATION: 'configuration-nfx',
} as const;
export const NINBUS_DEVICE_TYPE = 'ninbus-wifi-v3';
```

---

## 6. Multi-tenancy & RBAC

### 6.1 Role Hierarchy

```
owner (4) > admin (3) > operator (2) > viewer (1)
```

| Role | Create Company | Add Members | Manage Devices | Create Deploy | View |
|------|---------------|-------------|----------------|---------------|------|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin | ❌ | ✅ | ✅ | ✅ | ✅ |
| operator | ❌ | ❌ | ✅ | ✅ | ✅ |
| viewer | ❌ | ❌ | ❌ | ❌ | ✅ |

### 6.2 Super Admin

Controlado via `SUPER_ADMIN_EMAILS` env var (comma-separated). Não é um role no banco.
Bypassa checks de company membership.

---

## 7. Segurança — Requisitos Obrigatórios

### 7.1 Validação de Input

| Regra | Detalhe |
|-------|---------|
| **Body tipado** | TODO POST/PUT DEVE ter `body: t.Object({...})` explícito |
| **Params validados** | Todo `:id` DEVE usar `t.String({ format: 'uuid' })` |
| **Query validadas** | Endpoints com query DEVEM usar `query: t.Object({...})` |
| **Response schemas** | Definir em `schemas.ts`, nunca inline no route file |
| **Auth module** | NUNCA definir body schema — Better Auth lê request.json() internamente |

### 7.2 hawkBit Security

| Aspecto | Detalhe |
|---------|---------|
| Management API | HTTP Basic Auth (username:password via env) |
| DDI | TargetToken auth (`Authorization: TargetToken {token}`) |
| TargetToken config | DEVE ser habilitado — padrão hawkBit é **false** |
| deviceKey | NUNCA armazenado no DB — passado apenas ao hawkBit como securityToken |
| Auto-provisioning | Seguro — device deve enviar securityToken correto |

### 7.3 Rate Limiting

- **Global**: 100 req/60s por IP
- **Auth**: 10 req/60s por IP
- **Desabilitado em testes**: `ENABLE_RATE_LIMITER=false`

### 7.4 Environment Variables — hawkBit

| Var | Required | Description |
|-----|----------|-------------|
| `HAWKBIT_ENABLED` | Não (default false) | Habilita integração hawkBit |
| `HAWKBIT_URL` | Sim (quando enabled) | URL base do Management API |
| `HAWKBIT_USERNAME` | Sim (quando enabled) | Basic Auth username |
| `HAWKBIT_PASSWORD` | Sim (quando enabled) | Basic Auth password |
| `HAWKBIT_TIMEOUT_MS` | Não (default 30000) | Timeout para chamadas |
| `HAWKBIT_SKIP_TLS` | Não (default false) | Ignora cert TLS (dev) |
| `HAWKBIT_AUTOPROVISIONING` | Não (default true) | Auto-cria target no DDI poll |
| `HAWKBIT_DDI_TARGET_TOKEN_AUTH` | Não (default true) | **CRITICAL** — habilita TargetToken auth |

---

## 8. Eficiência Computacional

- **Select explícito** — sempre listar campos, nunca `*`
- **hawkBit timeout** — 30s default, configurável via env
- **Two-level error guard** — sem 500 por hawkBit offline
- **Graceful shutdown** — SIGTERM/SIGINT → `server.stop()` → `closeDatabase()`
- **Production logging** — JSON pino (sem pino-pretty/worker threads)

---

## 9. Testes — 139 testes

### 9.1 Comandos

```bash
bun test                                        # Rodar todos (usa .env.test)
DATABASE_URL=... HAWKBIT_ENABLED=false bun test  # Com env override
bun test tests/<module>.test.ts                  # Módulo específico
```

### 9.2 Execução

- Testes rodam contra Neon cloud DB
- `HAWKBIT_ENABLED=false` no `.env.test` — sem chamadas hawkBit
- Latência do Neon pode causar 1-2 timeouts intermittents (não é bug de código)

### 9.3 Checklist de Cobertura por Módulo

| Cenário | Status Codes | Obrigatório |
|---------|-------------|-------------|
| Listar recursos | 200 | ✅ |
| Buscar por ID existente | 200 | ✅ |
| Buscar por ID inexistente | 404 | ✅ |
| Criar sem autenticação | 401 | ✅ |
| Criar autenticado | 201 | ✅ |
| Atualizar sem ser dono | 403 | ✅ |
| Body vazio/campo faltante | 400 | ✅ |
| hawkBit disabled → 400 | 400 | ✅ |
| hawkBit unreachable → 503 | 503 | ✅ |

---

## 10. Checklist de Qualidade (PR Review)

- [ ] **Body validation**: Todo POST/PUT tem `body: t.Object({...})`
- [ ] **Response schemas**: Definidos em `schemas.ts`, nunca inline
- [ ] **Auth**: Rotas protegidas usam `auth: true` ou `companyRole`
- [ ] **Platform routes**: Sem `companyRole` em rotas sem `:companyId`
- [ ] **hawkBit guard**: Service check `enabled` + route catch network errors
- [ ] **Serial normalization**: `normalizeSerial()` antes de criar hawkBit target
- [ ] **ArtifactType**: Deployments com tipo válido (3 valores)
- [ ] **Tests**: Todos passando com `HAWKBIT_ENABLED=false`
- [ ] **Config**: Novas vars em env.ts + .env.example + .env.test
- [ ] **Files < 250 lines**: Split se necessário
- [ ] **No process.env** fora de env.ts
- [ ] **Docs**: Swagger tags e summary preenchidos

---

## Referências

- [Elysia.js Docs](https://elysiajs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://better-auth.com)
- [TypeBox](https://github.com/sinclairzx81/typebox)
- [Biome](https://biomejs.dev)
- [Bun Test](https://bun.sh/docs/cli/test)
- [Eclipse hawkBit Management API](https://eclipse.github.io/hawkbit/rest-api/management-api.html)
- [Eclipse hawkBit DDI API](https://eclipse.github.io/hawkbit/rest-api/ddi-api.html)
- [Ninbus Device Provisioning](../../docs/device-provisioning.md)
