---
name: ninbus-api-standards
description: >
  Padrões de arquitetura, segurança, estilo de código e qualidade para o Ninbus API (Elysia + Bun + Drizzle + Better Auth + Mender Gateway).
  Use esta skill ao criar novos módulos, rotas, schemas, testes ou ao revisar código existente.
  Abrange: estrutura de módulos, validação de body/params/query, autenticação, autorização (RBAC por empresa),
  rate limiting, tipos de artefato OTA (firmware-ninbus, firmware-controller, configuration-nfx),
  integração Mender Gateway, tratamento de erros, naming conventions, testes com cobertura ≥85%.
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
| Framework | Elysia.js (≥1.4) | HTTP server, rotas, middleware |
| ORM | Drizzle ORM + postgres.js | Queries tipadas, migrations |
| Auth | Better Auth | Sessões cookie-based, CSRF, email/password |
| OTA Gateway | Mender Server (self-hosted) | Device auth, deployments, artifacts, inventory |
| Validação | TypeBox (via drizzle-typebox + Elysia built-in) | Schema validation no body/params/response |
| Linter | Biome (tabs, single quotes, trailing commas) | Formatação e linting |
| Logging | Pino + pino-pretty (dev) | Logs estruturados |
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
│  ├── Companies    → Multi-tenancy (CRUD + members + roles)      │
│  ├── Categories   → Device grouping (bus_line, garage, yard...) │
│  ├── Devices      → Registry + Mender integration (N:N cats)    │
│  ├── Deployments  → OTA creation/monitoring via Mender          │
│  ├── Artifacts    → Firmware management (list, download, etc.)   │
│  ├── Posts        → CRUD reference implementation               │
│  └── Health       → Server health check                         │
│                                                                  │
│  Infra:                                                          │
│  ├── Mender Client    → Typed HTTP client (PAT auth)            │
│  ├── Company Guard    → Role-based authorization middleware      │
│  └── DB Schema        → companies, categories, devices, N:N     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Authorization: Bearer <PAT>
                           ▼
                ┌──────────────────────┐
                │   MENDER GATEWAY     │
                │   (78 endpoints)     │
                └──────────┬───────────┘
                           │
                    ┌──────┴──────┐
                    │  Dispositivos│
                    │  ninbus-wifi │
                    │  -v3 (100k+) │
                    └─────────────┘
```

### Estrutura de Diretórios

```
src/
├── app.ts                          # Composition root (createApp factory)
├── index.ts                        # Entry point + graceful shutdown
├── common/
│   ├── config/                     # env.ts, auth.ts, auth-client.ts, email.ts, mender.ts
│   ├── db/
│   │   ├── index.ts                # Drizzle client singleton (pool max 10)
│   │   └── schema/                 # Drizzle schemas
│   │       ├── auth.ts             # Better Auth tables (user, session, account, verification)
│   │       ├── companies.ts        # companies + company_members (roles: owner/admin/operator/viewer)
│   │       ├── categories.ts       # categories (type: bus_line, garage, yard, region, custom)
│   │       ├── devices.ts          # devices + device_category_assignments (N:N PK)
│   │       ├── posts.ts            # Posts (reference implementation)
│   │       └── index.ts            # Barrel exports
│   ├── logger/index.ts             # Pino logger (silent em testes)
│   ├── mender/
│   │   ├── artifact-generator.ts   # Pure TS .mender v3 generator (tar+gzip, zero binary deps)
│   │   ├── client.ts              # Mender Gateway HTTP client (tipado, PAT, timeout, error class)
│   │   ├── http.ts                # Core HTTP client (PAT injection, Host override, TLS skip)
│   │   └── types.ts               # Mender API DTO interfaces
│   ├── middleware/
│   │   ├── auth-guard.ts           # withAuth() derive + macro (auth: true)
│   │   ├── company-check.ts        # checkMembership() shared helper (retorna err|null)
│   │   ├── company-guard.ts        # hasCompanyRole() (owner > admin > operator > viewer)
│   │   ├── rate-limiter.ts         # createRateLimiter() factory (global + auth)
│   │   └── request-logger.ts       # onRequest/onAfterResponse logging
│   └── schemas/index.ts            # ErrorResponseSchema + GenericActionResponseSchema
├── modules/
│   ├── auth/index.ts + schemas.ts  # Better Auth routes (body schemas explícitos)
│   ├── companies/                  # Multi-tenancy (4 files: index.ts, member-routes.ts, schemas.ts, service.ts)
│   ├── categories/                 # Device grouping (3 files)
│   ├── devices/                    # Device registry + Mender integration (6 files: index.ts, mender-routes.ts, schemas.ts, service.ts, auth.ts, sync.ts)
│   ├── deployments/                # OTA deployments (4 files: index.ts, device-routes.ts, schemas.ts, service.ts)
│   ├── artifacts/                  # Artifact management (upload, generate, list, download, delete)
│   │   ├── index.ts               # POST /upload + POST /generate + GET /types
│   │   ├── manage-routes.ts       # GET / list, get, delete, download, releases
│   │   ├── schemas.ts             # Body validation schemas + constants + response schemas
│   │   └── service.ts             # Upload logic, file validation, Mender proxy, artifact generation
│   ├── health/index.ts             # Health check
│   └── posts/                      # CRUD reference (3 files)
├── scripts/                        # migrate.ts, seed.ts
├── types/                          # elysia.d.ts (Context augmentation)
tests/
    ├── auth.test.ts                # 27 testes
    ├── artifacts.test.ts           # 58 testes (upload validation, enrichment, generate, auth/403/400)
    ├── companies.test.ts           # 13 testes
    ├── categories.test.ts          # 12 testes
    ├── devices.test.ts             # 19 testes
    ├── deployments.test.ts         # 26 testes (inclui artifact types)
    ├── health.test.ts              # 5 testes
    └── posts.test.ts               # 24 testes
```

### Princípios Arquiteturais

1. **Factory Pattern** — `createApp()` para testabilidade
2. **Modularização por Feature** — cada módulo em `src/modules/<nome>/`
3. **Separação de Concerns** — routes (index.ts) → schemas → service
4. **Dependency Injection via Context** — `withAuth()` injeta `user`/`session`
5. **Company-scoped Mender** — Toda operação Mender é filtrada por empresa
6. **Fail-Fast** — validação de env no startup com TypeBox

---

## 2. Convenções de Código

### 2.1 Naming

| Elemento | Convenção | Exemplo |
|----------|-----------|---------|
| Arquivos | kebab-case | `auth-guard.ts`, `company-guard.ts` |
| Diretórios | kebab-case | `common/`, `modules/`, `mender/` |
| Variáveis/Funções | camelCase | `getAllPosts()`, `getAuthCookie()` |
| Constantes | UPPER_SNAKE_CASE para tipos de artefato, camelCase para demais | `ARTIFACT_TYPE_NINBUS_FIRMWARE`, `appLogger` |
| Tipos/Interfaces | PascalCase | `Post`, `NewPost`, `Env`, `NinbusArtifactType` |
| Schemas TypeBox | camelCase + sufixo Schema | `createPostSchema`, `createOtaDeploymentSchema` |
| Exportações de módulo | camelCase + sufixo Module | `postsModule`, `deploymentsModule` |
| DB Enums | camelCase + sufixo Enum | `companyRoleEnum`, `deviceStatusEnum` |
| Rotas API | kebab-case com prefixo | `/api/companies`, `/api/auth/sign-up/email` |

### 2.2 Formatação (Biome)

- **Indentação**: Tabs (largura 2)
- **Aspas**: Single quotes
- **Trailing commas**: Sim
- **Semicolons**: Sempre
- **Line width**: 100 caracteres
- **Arrow parens**: Sempre `(x) => ...`
- **Bracket spacing**: Sim
- **Organize imports**: Automático

### 2.3 Imports — Ordem

1. Pacotes externos (`elysia`, `drizzle-orm`, etc.)
2. Aliases internos (`@common/*`, `@modules/*`, `@/*`)
3. Imports relativos (`./schemas`, `../service`)

### 2.4 TypeScript

- **Strict mode** habilitado com `noUncheckedIndexedAccess`, `noImplicitOverride`
- **Tipagem explícita** de returns em services
- **`any` permitido** em handlers Elysia (dentro de `({ params, body, user, set }: any)`)
- **Path aliases**: `@/*`, `@common/*`, `@modules/*`

### 2.5 Exportações

- **Named exports** para tudo (NUNCA `export default`)
- **Barrel exports** em `schema/index.ts`
- Cada módulo exporta `{Feature}Module` como named export

---

## 3. Catálogo de Módulos e Rotas

### 3.1 Health (`/health`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| GET | `/health` | ❌ | Status do servidor + DB connectivity |

### 3.2 Auth (`/api/auth`)

| Método | Rota | Auth | Body Required |
|--------|------|------|---------------|
| POST | `/api/auth/sign-up/email` | ❌ | `email`, `password`, `name`, `image?`, `callbackURL?` |
| POST | `/api/auth/sign-in/email` | ❌ | `email`, `password`, `callbackURL?` |
| POST | `/api/auth/sign-out` | JWT | — |
| GET | `/api/auth/get-session` | JWT | — |
| POST | `/api/auth/request-password-reset` | ❌ | `email`, `redirectTo?` |
| POST | `/api/auth/reset-password` | ❌ | `token`, `newPassword` |

> **Catch-all**: O módulo auth registra `.all('/*', handler)` para repassar qualquer rota não mapeada diretamente ao Better Auth handler.

### 3.3 Companies (`/api/companies`)

| Método | Rota | Auth | Body Required | Access |
|--------|------|------|---------------|--------|
| GET | `/api/companies` | ✅ | — | Lista empresas do user |
| POST | `/api/companies` | ✅ | `name` | Cria com user como owner |
| GET | `/api/companies/:companyId` | ✅ | — | Requer ser membro |
| PUT | `/api/companies/:companyId` | ✅ | `name?` | Requer ser membro |
| DELETE | `/api/companies/:companyId` | ✅ | — | Requer ser membro |
| GET | `/api/companies/:companyId/members` | ✅ | — | Requer ser membro |
| POST | `/api/companies/:companyId/members` | ✅ | `userId`, `role` | Requer ser membro |
| PUT | `/api/companies/:companyId/members/:userId` | ✅ | `role` | Requer ser membro |
| DELETE | `/api/companies/:companyId/members/:userId` | ✅ | — | Requer ser membro |

### 3.4 Categories (`/api/companies/:companyId/categories`)

| Método | Rota | Auth | Body Required |
|--------|------|------|---------------|
| GET | `/` | ✅ | — |
| POST | `/` | ✅ | `name`, `type` (bus_line/garage/yard/region/custom), `description?` |
| GET | `/:categoryId` | ✅ | — |
| PUT | `/:categoryId` | ✅ | `name?`, `description?` |
| DELETE | `/:categoryId` | ✅ | — |

### 3.5 Devices (`/api/companies/:companyId/devices`)

| Método | Rota | Auth | Body Required | Mender? |
|--------|------|------|---------------|---------|
| GET | `/` | ✅ | — | ❌ |
| POST | `/` | ✅ | `name`, `serialNumber?`, `menderDeviceId?` | ❌ |
| GET | `/:deviceId` | ✅ | — | ✅ enrich |
| PUT | `/:deviceId` | ✅ | `name?`, `serialNumber?` | ❌ |
| DELETE | `/:deviceId` | ✅ | — | ❌ |
| GET | `/:deviceId/categories` | ✅ | — | ❌ |
| PUT | `/:deviceId/categories` | ✅ | `categoryIds` (uuid[]) | ❌ |
| POST | `/:deviceId/approve` | ✅ | `authId` | ✅ |
| POST | `/:deviceId/reject` | ✅ | `authId` | ✅ |
| POST | `/:deviceId/decommission` | ✅ | — | ✅ |
| POST | `/:deviceId/check-update` | ✅ | — | ✅ |
| GET | `/:deviceId/inventory` | ✅ | — | ✅ |
| GET | `/:deviceId/connection` | ✅ | — | ✅ |

### 3.6 Deployments (`/api/companies/:companyId/deployments`)

| Método | Rota | Auth | Body Required |
|--------|------|------|---------------|
| GET | `/artifact-types` | ✅ | — |
| POST | `/` | ✅ | `name`, `artifactName`, **`artifactType`**, `deviceIds?`/`categoryIds?`/`allDevices?`, `retries?` |
| GET | `/:deploymentId` | ✅ | — |
| GET | `/:deploymentId/statistics` | ✅ | — |
| PUT | `/:deploymentId/status` | ✅ | `{ status: "aborted" }` |
| GET | `/:deploymentId/devices` | ✅ | query: `status?`, `page?`, `perPage?` |
| GET | `/:deploymentId/devices/:menderDeviceId/log` | ✅ | — |
| DELETE | `/devices/:menderDeviceId/deployments` | ✅ | — |
| GET | `/devices/:deviceId/history` | ✅ | query: `status?`, `page?`, `perPage?` |

### 3.7 Artifacts (`/api/companies/:companyId/artifacts`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/` | ✅ | **Upload de .mender artifact** (multipart/form-data, max 500MB) |
| POST | `/generate` | ✅ | **Generate .mender from raw firmware** (file + artifactName + artifactType) |
| GET | `/` | ✅ | Lista artifacts com enriquecimento Ninbus |
| GET | `/types` | ✅ | Lista 3 tipos Ninbus com metadata |
| GET | `/:artifactId` | ✅ | Detalhes com tipo enriquecido |
| GET | `/:artifactId/download` | ✅ | Link pré-assinado |
| DELETE | `/:artifactId` | ✅ | Remove artefato |
| PUT | `/:artifactId` | ✅ | Atualiza descrição |
| GET | `/releases` | ✅ | Lista releases do Mender |

### 3.8 Artifacts — Upload Flow (Detalhado)

O upload de artefatos segue o fluxo:

```
Client (UI/CLI)                          Ninbus API                           Mender Gateway
     │                                        │                                      │
     │  POST /artifacts (multipart)            │                                      │
     │  Content-Type: multipart/form-data      │                                      │
     │  Fields: artifact (.mender), description│                                      │
     │────────────────────────────────────────>│                                      │
     │                                        │  1. Validar file extension (.mender)  │
     │                                        │  2. Validar file size (≤500MB)        │
     │                                        │                                      │
     │                                        │  POST /api/management/v1/             │
     │                                        │  deployments/artifacts (multipart)    │
     │                                        │──────────────────────────────────────>│
     │                                        │                                      │
     │                                        │  201 Created                         │
     │                                        │<──────────────────────────────────────│
     │                                        │                                      │
     │                                        │  GET /artifacts?name=<filename>      │
     │                                        │  (retrieve enriched metadata)         │
     │                                        │──────────────────────────────────────>│
     │                                        │                                      │
     │                                        │  200 + artifact data                  │
     │                                        │<──────────────────────────────────────│
     │                                        │                                      │
     │  201 + enriched artifact data          │                                      │
     │<────────────────────────────────────────│                                      │
```

**Body Schema (POST /artifacts)**:
```typescript
body: t.Object({
  artifact: t.File({ description: 'Mender artifact file (.mender). Max 500MB.' }),
  description: t.Optional(t.String({ minLength: 1, maxLength: 1000 })),
})
```

**File Validation** (`src/modules/artifacts/service.ts`):
- Extension: `.mender` only (case insensitive)
- Size: 1 byte – 500 MB
- Error class: `ArtifactValidationError` with codes: `INVALID_EXTENSION`, `FILE_TOO_LARGE`, `EMPTY_FILE`, `MISSING_FILE`

**Mender Gateway API** (proxy):
- `POST /api/management/v1/deployments/artifacts` — multipart: `artifact` (binary) + `description` (text)
- Supports artifact versions v1, v2, v3
- Returns 409 if artifact with same name + dependencies already exists
- Returns 201 with `Location` header on success

### 3.9 Artifacts — Generate Flow (Detalhado)

O generate endpoint permite criar artefatos `.mender` a partir de firmware raw, sem necessidade do `mender-artifact` CLI:

```
Client (UI/CLI)                          Ninbus API                           Mender Gateway
     │                                        │                                      │
     │  POST /artifacts/generate (multipart)   │                                      │
     │  Fields: file (.fir/.frz/.bin),         │                                      │
     │          artifactName, artifactType,    │                                      │
     │          description?                   │                                      │
     │────────────────────────────────────────>│                                      │
     │                                        │  1. Validate raw file extension       │
     │                                        │  2. Validate file size (≤100MB)       │
     │                                        │  3. Generate .mender v3 in memory     │
     │                                        │     (tar + gzip + SHA-256 checksums)  │
     │                                        │                                      │
     │                                        │  POST /api/management/v1/             │
     │                                        │  deployments/artifacts (multipart)    │
     │                                        │──────────────────────────────────────>│
     │                                        │                                      │
     │                                        │  201 Created                         │
     │                                        │<──────────────────────────────────────│
     │                                        │                                      │
     │                                        │  GET /artifacts?name=<name>          │
     │                                        │──────────────────────────────────────>│
     │                                        │  200 + enriched artifact data         │
     │                                        │<──────────────────────────────────────│
     │                                        │                                      │
     │  201 + enriched artifact data          │                                      │
     │<────────────────────────────────────────│                                      │
```

**Body Schema (POST /artifacts/generate)**:
```typescript
body: t.Object({
  file: t.File({ description: 'Raw firmware file (.fir, .frz, .bin)' }),
  artifactName: t.String({ minLength: 1, maxLength: 256 }),
  artifactType: t.Union([
    t.Literal('firmware-ninbus'),
    t.Literal('firmware-controller'),
    t.Literal('configuration-nfx'),
  ]),
  description: t.Optional(t.String({ minLength: 1, maxLength: 1000 })),
})
```

**Artifact Generator** (`src/common/mender/artifact-generator.ts`):
- Pure TypeScript `.mender` v3 format generator — zero external binary dependencies
- Creates valid POSIX/UStar tar archives with proper headers and checksums
- Format: outer tar → `version`(3) + `manifest`(SHA-256) + `header.tar.gz`(metadata) + `data/0000.tar.gz`(payload)
- Uses `Bun.gzipSync()` for compression and `crypto.subtle.digest('SHA-256')` for checksums
- Supported raw extensions: `.fir`, `.frz`, `.nfx`, `.bin`, `.hex`, `.fw`, `.cfg`, `.conf`
- Max raw payload: 100MB (before .mender wrapping)

### 3.10 Posts (`/api/posts`) — Reference

| Método | Rota | Auth | Body Required |
|--------|------|------|---------------|
| GET | `/` | ❌ | — |
| GET | `/:id` | ❌ | — |
| POST | `/` | ✅ | `title`, `content` |
| PUT | `/:id` | ✅ | `title?`, `content?` (owner only) |
| DELETE | `/:id` | ✅ | — (owner only) |

---

## 4. Tipos de Artefato Ninbus (CRÍTICO)

O sistema suporta **3 tipos de artefato OTA** para dispositivos Ninbus WiFi v3.
Cada tipo determina o caminho de atualização no hardware embarcado (STM32F407):

| Tipo | Constante | Destino | Risco | Reboot | Payload |
|------|-----------|---------|-------|--------|---------|
| `firmware-ninbus` | `ARTIFACT_TYPE_NINBUS_FIRMWARE` | NAND → Bootloader → STM32F407 | **HIGH** | **YES** | `.fir` |
| `firmware-controller` | `ARTIFACT_TYPE_CONTROLLER_FIRMWARE` | CAN → LightDot | MEDIUM | NO | `.fir` |
| `configuration-nfx` | `ARTIFACT_TYPE_NFX_CONFIGURATION` | NAND NFX → CAN → LightDot | LOW | NO | `.frz` |

### 4.1 Constantes Canônicas (duas fontes, um source of truth)

**Source of truth** — `src/common/mender/client.ts`:
```typescript
export const NINBUS_ARTIFACT_TYPES = {
  NINBUS_FIRMWARE: 'firmware-ninbus',
  CONTROLLER_FIRMWARE: 'firmware-controller',
  NFX_CONFIGURATION: 'configuration-nfx',
} as const;

export type NinbusArtifactType = (typeof NINBUS_ARTIFACT_TYPES)[keyof typeof NINBUS_ARTIFACT_TYPES];

export const NINBUS_ARTIFACT_TYPE_META: Record<NinbusArtifactType, {
  label: string;
  description: string;
  target: string;
  requiresReboot: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}>;

export const NINBUS_DEVICE_TYPE = 'ninbus-wifi-v3';
export function isNinbusArtifactType(type: string): type is NinbusArtifactType;
export function resolveArtifactType(artifact): NinbusArtifactType | null;
```

**Artifact Generator** — `src/common/mender/artifact-generator.ts`:
```typescript
// Pure TypeScript .mender v3 format generator
// Creates tar + gzip archives matching Mender's expected format
export async function generateMenderArtifact(options: {
  artifactName: string;
  artifactType: NinbusArtifactType;
  deviceType?: string;  // default: 'ninbus-wifi-v3'
  payloadFileName: string;
  payloadData: Uint8Array;
}): Promise<Uint8Array>;  // .mender file contents
```

**Deployment schema** — `src/modules/deployments/schemas.ts`:
```typescript
export const ARTIFACT_TYPE_NINBUS_FIRMWARE = 'firmware-ninbus';
export const ARTIFACT_TYPE_CONTROLLER_FIRMWARE = 'firmware-controller';
export const ARTIFACT_TYPE_NFX_CONFIGURATION = 'configuration-nfx';
```

### 4.2 Regras Obrigatórias

1. **Todo deployment DEVE especificar `artifactType`** — campo obrigatório no body
2. **Validação de tipo** — o schema usa `t.Union([t.Literal(...), ...])` com 3 valores
3. **Pre-flight validation** — `service.validateArtifactForDeployment()` verifica:
   - Artefato existe no Mender
   - `device_types_compatible` inclui `ninbus-wifi-v3`
4. **Enriquecimento de metadados** — artifacts listados via GET são enriquecidos com `ninbusType` e `ninbusMeta`
5. **Risk level no response** — cada tipo retorna `riskLevel` (low/medium/high) para UI
6. **Erros específicos** — 422 com mensagem clara se artifact not found / not compatible / no eligible devices

### 4.3 Criação de Artefatos via CLI (no host de build)

```bash
# Firmware do Ninbus (STM32F407) — RISK HIGH
mender-artifact write module-image \
    -T firmware-ninbus \
    -o ninbus-firmware-3.3.0.mender \
    -n ninbus-firmware-3.3.0 \
    -t ninbus-wifi-v3 \
    -f wifi3.fir

# Firmware do Controlador (LightDot via CAN) — RISK MEDIUM
mender-artifact write module-image \
    -T firmware-controller \
    -o controller-firmware-12.6.0.mender \
    -n controller-firmware-12.6.0 \
    -t ninbus-wifi-v3 \
    -f controller.fir

# Configuração NFX (painéis) — RISK LOW
mender-artifact write module-image \
    -T configuration-nfx \
    -o config-nfx-2026-04-14.mender \
    -n config-nfx-2026-04-14 \
    -t ninbus-wifi-v3 \
    -f nfx.frz
```

### 4.4 Fluxo OTA no Embarcado (por tipo)

```
firmware-ninbus (HIGH risk):
  Mender Server → ESP8266 (AT/TLS) → STM32 → NAND Flash (firmware.fir)
  → report "success" → systemReset() → Bootloader grava Flash interna → jump app

firmware-controller (MEDIUM risk):
  Mender Server → ESP8266 → STM32 → NAND temp (artifact.tmp)
  → forwardFirmwareToController() → CAN: FSFORMAT → WRFIR (blocks) → RESET → LightDot atualiza

configuration-nfx (LOW risk):
  Mender Server → ESP8266 → STM32 → NAND NFX (nfx.frz)
  → sendConfigToControlador() → CAN → LightDot aplica config nos painéis
```

### 4.5 Mender Client Architecture

O client em `src/common/mender/client.ts` é o **único ponto de contato** com o Mender Gateway:

- `menderDeviceAuth` — list/get/approve/reject/decommission/preauthorize/count
- `menderInventory` — list/get/groups/tags/group devices
- `menderArtifacts` — list/get/upload/delete/update/download link
- `menderDeployments` — create/createForGroup/get/statistics/abort/abortDevice/listDevices/getDeviceLog/listDeviceHistory
- `menderReleases` — list/setTags
- `menderDeviceConnect` — getConnectionState/forceCheckUpdate

Todas as chamadas usam PAT no header `Authorization: Bearer <PAT>`.
Todas têm timeout configurável (`MENDER_TIMEOUT_MS`, default 30s).
Erros são encapsulados em `MenderApiError` (status, body, endpoint).

O **artifact generator** em `src/common/mender/artifact-generator.ts` gera arquivos `.mender` v3 localmente:
- Não faz chamadas HTTP — apenas gera o binário `.mender` em memória
- Usado por `POST /artifacts/generate` para converter firmware raw em `.mender` com tipo customizado
- Zero dependências externas (usa `Bun.gzipSync()` + `crypto.subtle.digest()`)

---

## 5. Multi-tenancy & RBAC

### 5.1 Company Model

```
companies ──< company_members >── user
                  (role: owner/admin/operator/viewer)
                  (cascade delete on both sides)
```

### 5.2 Role Hierarchy

```
owner (4) > admin (3) > operator (2) > viewer (1)
```

| Role | Create Company | Add Members | Manage Devices | Create Deploy | View |
|------|---------------|-------------|----------------|---------------|------|
| owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| admin | ❌ | ✅ | ✅ | ✅ | ✅ |
| operator | ❌ | ❌ | ✅ | ✅ | ✅ |
| viewer | ❌ | ❌ | ❌ | ❌ | ✅ |

### 5.3 Company-scoped Access Pattern

Todas as rotas de devices, categories, deployments e artifacts usam o prefixo `/api/companies/:companyId`.
O middleware `isCompanyMember()` verifica membership em cada handler:

```typescript
const memberCheck = await isCompanyMember(params.companyId, user.id);
if (!memberCheck) {
  set.status = 403;
  return { error: 'Forbidden', message: 'Not a member of this company' };
}
```

---

## 6. Device Registry & Categorias

### 6.1 Device Model

```
companies ──< devices (status: pending/accepted/rejected/preauthorized/decommissioned)
                  │
                  │  menderDeviceId → link to Mender Gateway device
                  │
                  └──< device_category_assignments >── categories
                              (N:N, composite PK: deviceId + categoryId)
```

### 6.2 Category Types

| Type | Uso |
|------|-----|
| `bus_line` | Linhas de ônibus |
| `garage` | Garagens |
| `yard` | Pátios |
| `region` | Regiões operacionais |
| `custom` | Categorias livres |

### 6.3 Deployment Target Resolution

Ao criar um deployment, o service resolve os Mender device IDs a partir de:

```
deviceIds[]      → buscar devices da empresa com status=accepted → extrair menderDeviceId
categoryIds[]    → buscar devices nas categorias → extrair menderDeviceId
allDevices       → todos devices accepted da empresa → extrair menderDeviceId
```

---

## 7. Segurança — Requisitos Obrigatórios

### 7.1 Validação de Input (CRÍTICO)

| Regra | Detalhe |
|-------|---------|
| **Body tipado** | TODO endpoint POST/PUT/PATCH DEVE ter `body: t.Object({...})` explícito |
| **Params validados** | Todo `:id` DEVE usar `t.String({ format: 'uuid' })` |
| **Query validadas** | Endpoints com query params DEVEM usar `query: t.Object({...})` |
| **Sem body vazio** | Nunca permitir body sem schema |
| **Constraints** | Sempre definir `minLength`, `maxLength`, `format`, `pattern` quando aplicável |
| **Response schemas** | Definir `response` com tipos explícitos para contrato |
| **ArtifactType** | Deployment DEVE ter `artifactType` com Union de 3 literais |

**❌ ANTI-PATTERN** — Campos apenas na description:
```typescript
// ERRADO
.post('/', handler, {
  detail: { description: 'Body: email (required), password (required)' },
})
```

**✅ CORRETO** — Body schema explícito:
```typescript
.post('/', handler, {
  body: t.Object({
    email: t.String({ format: 'email', description: 'User email' }),
    password: t.String({ minLength: 8, maxLength: 128, description: 'User password' }),
  }),
})
```

### 7.2 Autenticação & Autorização

| Camada | Implementação |
|--------|--------------|
| **Sessão** | Better Auth cookie-based (httpOnly, secure em prod, sameSite: lax) |
| **Derive** | `withAuth()` injeta `user` e `session` em todas as rotas do módulo |
| **Proteção** | Macro `auth: true` retorna 401 se não autenticado |
| **Company RBAC** | `isCompanyMember()` verifica membership por empresa |
| **Ownership** | Checagem manual no handler com `isOwner()` → 403 se não |
| **Mender PAT** | Configurado via `MENDER_PAT` env var, nunca hardcoded |

### 7.3 Rate Limiting

- **Global**: 100 req/60s por IP (exclui OPTIONS, /health, /api/auth)
- **Auth**: 10 req/60s por IP
- **IP Detection**: `x-forwarded-for` → `x-real-ip` → fallback `127.0.0.1`
- **Storage**: LRU Cache em memória (max 10000 global, 1000 auth)
- **Desabilitado em testes**: `ENABLE_RATE_LIMITER=false` no `.env.test`

### 7.4 Environment Variables — Mender

| Var | Required | Description |
|-----|----------|-------------|
| `MENDER_ENABLED` | Não (default false) | Habilita/desabilita integração Mender |
| `MENDER_GATEWAY_URL` | Não (sem default) | URL base do Mender Gateway |
| `MENDER_PAT` | **Sim** (quando enabled) | Personal Access Token para API Mender |
| `MENDER_TIMEOUT_MS` | Não (default 30000) | Timeout para chamadas Mender |
| `MENDER_HOST_OVERRIDE` | Não | Override do header Host (para Traefik/Docker) |
| `MENDER_SKIP_TLS` | Não (default false) | Ignora certificado TLS (dev) |
| `MENDER_TENANT_TOKEN` | Não | Token para Mender multi-tenant |

### 7.5 Database Security

- **SQL Injection**: Impossível com Drizzle ORM (parameterized queries)
- **Foreign Keys**: `onDelete: 'cascade'` em todas as relações
- **Connection Pool**: max 10, idle_timeout 20s, connect_timeout 10s
- **Select explícito**: Nunca `SELECT *` — sempre especificar campos
- **N:N composite PK**: `device_category_assignments` usa PK(deviceId, categoryId)

### 7.6 Docker Security

- Multi-stage build (install → build → production)
- `USER bun` (non-root)
- Healthcheck configurado (`/health`)
- Secrets via environment variables
- **Auto-migration**: Migrations rodadas automaticamente no startup via `runStartupMigrations()` em `src/index.ts`
- **Migration journal**: `drizzle/meta/_journal.json` DEVE conter todas as migrations SQL listadas

### 7.7 Startup Sequence

O container executa na seguinte ordem:

1. `src/scripts/migrate.ts` → `runStartupMigrations()` — Roda todas as pending migrations
2. `src/app.ts` → `createApp()` — Registra middleware, plugins e módulos
3. `src/index.ts` → `app.listen()` — Inicia o servidor HTTP
4. Logs de startup: `[MIGRATION]`, `[SERVER]`, `[API]`, `[HEALTH]`

### 7.8 Error Handling Global

| Error Code | Status | Log Level |
|------------|--------|-----------|
| `NOT_FOUND` | 404 | Nenhum (tratado pelo request logger) |
| `VALIDATION` | 400 | `WARN` |
| Qualquer outro | 500 | `ERROR` |

### 7.9 Auth Module — Body Schema Constraint

**NUNCA definir `body` schemas nas rotas de Auth (`/api/auth/*`).**

O Better Auth lê `request.json()` internamente. Se o Elysia define `body: t.Object({...})`,
o body é parseado uma primeira vez (Elysia validation) e depois uma segunda (Better Auth),
causando `TypeError: Body already used`.

Better Auth valida todos os campos internamente (required, min/max, email format).
Documentação OpenAPI é feita via `detail.summary` e `detail.description`.

---

## 8. Eficiência Computacional

- **Select explícito** — sempre listar campos, nunca `*`
- **Join apenas quando necessário** — `leftJoin` para autor em listagens
- **N:N queries** — `deviceCategoryAssignments` + `categories` com `innerJoin`
- **Pagination** — Implementar `LIMIT/OFFSET` para coleções grandes
- **N+1** — evitar queries dentro de loops; usar JOINs
- **Mender timeout** — 30s default, configurável via env
- **Graceful shutdown** — SIGTERM/SIGINT → `server.stop()` → `closeDatabase()`

---

## 9. Testes — Cobertura ≥85%

### 9.1 Arquivos de Teste (8 módulos)

| Arquivo | Testes | Cobre |
|---------|--------|-------|
| `tests/artifacts.test.ts` | 58 | Upload validation, file extension/size, enrichment, auth/403/400 per endpoint |
| `tests/auth.test.ts` | 27 | Sign-up, sign-in, session, password reset, body validation |
| `tests/companies.test.ts` | 13 | CRUD, members, roles, 403 non-member |
| `tests/categories.test.ts` | 12 | CRUD, 5 tipos, validation, 403 |
| `tests/devices.test.ts` | 19 | CRUD, N:N categories, approve/reject, check-update, inventory, Mender endpoints |
| `tests/deployments.test.ts` | 26 | artifact-types (3 tipos, risk levels), artifactType validation, CRUD, auth |
| `tests/health.test.ts` | 5 | Status ok, ISO timestamp, uptime, responseTime format |
| `tests/posts.test.ts` | 24 | CRUD completo, ownership, validation |

### 9.2 Checklist de Cobertura por Módulo

| Cenário | Status Codes | Obrigatório |
|---------|-------------|-------------|
| Listar recursos | 200 | ✅ |
| Buscar por ID existente | 200 | ✅ |
| Buscar por ID inexistente | 404 | ✅ |
| ID inválido (não-UUID) | 400 | ✅ |
| Criar sem autenticação | 401 | ✅ |
| Criar autenticado | 201 | ✅ |
| Atualizar sem autenticação | 401 | ✅ |
| Atualizar próprio recurso | 200 | ✅ |
| Atualizar recurso alheio | 403 | ✅ |
| Atualizar recurso inexistente | 404 | ✅ |
| Deletar sem autenticação | 401 | ✅ |
| Deletar próprio recurso | 200 | ✅ |
| Deletar recurso alheio | 403 | ✅ |
| Body vazio/campo faltante | 400 | ✅ |
| Campo vazio (minLength) | 400 | ✅ |
| Campo excedendo maxLength | 400 | ✅ |

### 9.3 Checklist Adicional — Deployments & Artifacts

| Cenário | Obrigatório |
|---------|-------------|
| GET artifact-types retorna 3 tipos | ✅ |
| Cada tipo tem riskLevel válido | ✅ |
| Cada tipo tem requiresReboot boolean | ✅ |
| POST sem artifactType → 400 | ✅ |
| POST com artifactType inválido → 400 | ✅ |
| POST com artifactType válido (cada um dos 3) → passa validação | ✅ |
| GET artifacts/types retorna tipos enriquecidos | ✅ |
| Non-member em qualquer endpoint → 403 | ✅ |

### 9.4 Checklist Adicional — Artifact Upload

| Cenário | Obrigatório |
|---------|-------------|
| POST upload com arquivo .mender válido | ✅ |
| POST upload com arquivo .zip → 400 INVALID_EXTENSION | ✅ |
| POST upload com arquivo .fir → 400 INVALID_EXTENSION | ✅ |
| POST upload com arquivo vazio → 400 EMPTY_FILE | ✅ |
| POST upload com arquivo >500MB → 400 FILE_TOO_LARGE | ✅ |
| POST upload sem arquivo → 400 | ✅ |
| POST upload sem autenticação → 401 | ✅ |
| POST upload non-member → 403 | ✅ |
| PUT description vazia → 400 | ✅ |
| PUT description >1000 chars → 400 | ✅ |
| PUT body vazio → 400 | ✅ |
| Enrichment: firmware-ninbus → risk HIGH, reboot YES | ✅ |
| Enrichment: firmware-controller → risk MEDIUM, reboot NO | ✅ |
| Enrichment: configuration-nfx → risk LOW, reboot NO | ✅ |
| Enrichment: tipo desconhecido → null type/meta | ✅ |

### 9.5 Checklist Adicional — Artifact Generate

| Cenário | Obrigatório |
|---------|-------------|
| POST generate com .fir válido + artifactType | ✅ |
| POST generate com .frz válido + artifactType | ✅ |
| POST generate com .bin válido + artifactType | ✅ |
| POST generate com extensão inválida (.mender, .zip) → 400 | ✅ |
| POST generate com arquivo >100MB → 400 | ✅ |
| POST generate sem arquivo → 400 | ✅ |
| POST generate sem artifactName → 400 | ✅ |
| POST generate sem artifactType → 400 | ✅ |
| POST generate com artifactType inválido → 400 | ✅ |
| POST generate sem autenticação → 401 | ✅ |
| POST generate non-member → 403 | ✅ |
| Generated .mender tem tipo correto no header | ✅ |
| Generated .mender tem manifest SHA-256 válido | ✅ |

### 9.6 Comandos

```bash
bun test                          # Rodar todos os testes
bun test --env-file=.env.test     # Com env de teste explícito
bun test tests/<module>.test.ts   # Testar módulo específico
```

---

## 10. Checklist de Qualidade (PR Review)

Antes de merge, verifique:

- [ ] **Body validation**: Todo POST/PUT tem `body: t.Object({...})` explícito
- [ ] **Params validation**: Todo `:id` usa `t.String({ format: 'uuid' })`
- [ ] **Response schemas**: Endpoints críticos definem `response` com tipos
- [ ] **Auth**: Rotas protegidas usam `auth: true`
- [ ] **Company scope**: Rotas de empresa verificam `isCompanyMember()`
- [ ] **Ownership**: Recursos validam dono antes de update/delete
- [ ] **ArtifactType**: Deployments especificam tipo válido (3 valores)
- [ ] **Artifact Upload**: Validação de extensão (.mender), tamanho (≤500MB) e tipo MIME
- [ ] **File handling**: Multipart/form-data com `t.File()` schema no body
- [ ] **SQL**: Queries usam campos explícitos, sem `*`
- [ ] **Errors**: Sem stack traces em production
- [ ] **Rate limiting**: Rotas sensíveis protegidas
- [ ] **Tests**: Cobertura ≥85% com cenários da tabela acima
- [ ] **Lint**: `bun run lint` passa sem erros
- [ ] **Biome**: Formatação consistente (tabs, single quotes)
- [ ] **Types**: Strict mode, sem `@ts-ignore`
- [ ] **Docs**: Swagger tags e summary preenchidos
- [ ] **Secrets**: Nenhum secret hardcoded (incluindo MENDER_PAT)
- [ ] **Unused imports**: Nenhum import não utilizado (Biome pega isso)

---

## Referências

- [Elysia.js Docs](https://elysiajs.com)
- [Drizzle ORM](https://orm.drizzle.team)
- [Better Auth](https://better-auth.com)
- [TypeBox](https://github.com/sinclairzx81/typebox)
- [Biome](https://biomejs.dev)
- [Bun Test](https://bun.sh/docs/cli/test)
- [Mender Server Architecture Guide](../../mender-server/backend/docs/ARCHITECTURE_GUIDE.md)
- [Mender API Reference](../../mender-server/backend/docs/api-portal/openapi.json)
- [Ninbus Embedded Mender Integration](../../../Workspace/Ninbus-v3%20-%20Copia/docs/MENDER-INTEGRACAO.md)
