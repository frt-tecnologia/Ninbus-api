---
name: ninbus-api-standards
description: >
  Padrões para o Ninbus API (Bun + Elysia + Drizzle + Better Auth + hawkBit 1.0.3).
---

# Ninbus API — Padrões

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Bun ≥1.1 |
| Framework | Elysia.js |
| ORM | Drizzle ORM + postgres.js |
| Auth | Better Auth (cookie sessions + Bearer token) |
| OTA | Eclipse hawkBit 1.0.3 |
| Validação | TypeBox (via Elysia) |
| Logging | Pino (JSON em prod) |

---

## Arquitetura

```
Flutter → Ninbus API (Cookie/Bearer) → hawkBit Management (Basic Auth)
                │                              │
                │                              └── DDI (TargetToken, device polling)
                │
                └── PostgreSQL (Neon) ← Sync Engine (background)
```

**Módulos:** Auth · Companies · Categories · Devices · Deployments · Artifacts · Health

---

## Autorização — 3 Camadas

1. **`auth: true`** — qualquer usuário logado
2. **`superAdmin: true`** — emails em `SUPER_ADMIN_EMAILS` env var (não DB)
3. **`companyRole: 'viewer'`** — RBAC: owner(4) > admin(3) > operator(2) > viewer(1)

Rotas sem `:companyId` NUNCA usam `companyRole`.

### ⚠️ companyRole NÃO verifica ownership de dados

O `companyRole` macro verifica apenas se o usuário é **membro** da empresa. Ele **NÃO** verifica se os **dados acessados pertencem àquela empresa**. O service layer deve sempre:

1. Receber `companyId` como parâmetro
2. Filtrar/buscar com `WHERE company_id = :companyId`
3. Verificar ownership via `requireOwnership(companyId, hawkbitId)` antes de qualquer mutation

### Tenant Isolation Pattern (Write-Through)

Todos os recursos do hawkBit têm tabela local com `companyId`:

| Recurso | Tabela | Campo hawkBit | Padrão |
|---------|--------|---------------|--------|
| Device | `devices` | `hawkbitTargetId` | claim → set companyId |
| Artifact | `artifacts` | `hawkbitSmId` (UNIQUE) | upload → insert com companyId |
| Deployment | `deployments` | `hawkbitDsId` (UNIQUE) | create → insert com companyId |

```typescript
// Service — ownership check (throws 404 se não pertence)
async function requireOwnership(companyId: string, hawkbitSmId: number) {
  const [local] = await db.select({ companyId: artifacts.companyId })
    .from(artifacts).where(eq(artifacts.hawkbitSmId, hawkbitSmId));
  if (!local || local.companyId !== companyId)
    throw new ArtifactNotFoundError('Artifact not found in this company');
}

// Service — write-through (cria no hawkBit + registra no banco local)
await db.insert(artifacts).values({ companyId, hawkbitSmId: sm.id, ... });

// Service — list filtrado por empresa
const local = await db.select().from(artifacts).where(eq(artifacts.companyId, companyId));
const hawkbitData = await hawkbitSoftwareModules.listByIds(local.map(a => a.hawkbitSmId));
```

---

## Auth — Better Auth

- **Plugins:** DEVE ser array `[bearer()]`, NÃO objeto `{ bearer: bearer() }`
- **Cookie:** `auth.session_token` = valor assinado (HMAC), não o token raw
- **Bearer:** `Authorization: Bearer <token>` — o token vem do campo `token` na resposta de sign-in
- **Sessões:** 7 dias TTL, httpOnly cookies
- **Body schemas:** NUNCA definir body schema em rotas Better Auth (causa "Body already used"). Descrever body no `detail.description` string

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

### Padrões hawkBit

- **Bulk POST:** body em array `[data]`, response é array → `arr[0]`
- **Assign body:** campo `type` (NÃO `forceType`) para force type
- **Artifact upload:** `FormData` + `formData.append('file', file)` — nunca raw File
- **Cancel two-step:** step 1 (DELETE sem force) → step 2 (DELETE com force)
- **DDI TargetToken:** `HAWKBIT_DDI_TARGET_TOKEN_AUTH=true` obrigatório
- **SM names:** UUID-based (`sm-{uuid}`), nunca nomes legíveis (hawkBit unique constraint inclui soft-deleted)
- **DS names:** UUID-based (`ds-{uuid}`)

### hawkBit Guard (Two-Level Error Protection)

```typescript
// Service — config check
if (!hawkbitConfig.enabled) throw new ArtifactValidationError('HAWKBIT_NOT_ENABLED');

// Route — network error catch
catch (error) {
  if (error instanceof HawkbitApiError) { set.status = 502; return ...; }
  set.status = 503; return { error: 'Service Unavailable' };
}
```

### Sync Engine

| Modo | Background | On-demand | Uso |
|------|-----------|-----------|-----|
| periodic | ALL targets | — | <1k |
| on_demand | nenhum | per-request (cache 60s) | debug |
| hybrid | active companies | single device (cache 60s) | **produção 50k+** |

GET /devices faz ZERO chamadas hawkBit — tudo do DB local.

### Artifact Tar Packaging

Firmware empacotado em `.tar` antes do upload ao hawkBit:
```
├── header-info/featureidentity.json    {"type": "configuration-nfx"}
└── data/payload.bin                    firmware raw
```

Tipos: `firmware-ninbus` (HIGH), `firmware-controller` (MED), `configuration-nfx` (LOW)

---

## Device Lifecycle

| Ação | Quem | hawkBit Target | DB Record |
|------|------|---------------|-----------|
| Provision | Super admin | Cria | Cria (unclaimed) |
| Claim | Company member | Preservado | companyId set |
| Unclaim | Admin | **PRESERVADO** | companyId=null |
| Deprovision | Super admin | **DELETADO** | **DELETADO** |

---

## SSE Events

| Evento | Quando |
|--------|--------|
| `device.status` | Sync atualiza device |
| `device.deployment` | Target recebe deployment |
| `device.claimed` / `device.unclaimed` | Claim/unclaim |
| `deployment.created` / `deployment.deleted` | Deploy CRUD |
| `devices.batch` | Sync cycle completo |

---

## Convenções de Código

- **Files < 250 linhas** — split em sub-arquivos quando necessário
- **Response schemas** em `schemas.ts`, nunca inline em rotas
- **hawkBit guard:** checar `hawkbitConfig.enabled` antes de qualquer chamada
- **Config:** TUDO por `env.ts`, nunca `process.env` direto
- **Logger:** `%s/%d/%j` format strings em hot-path. Template literals OK em startup
- **Drizzle dates:** usar `t.Date()` em response schemas (aceita Date objects), nunca `t.String({ format: 'date-time' })`
- **Params:** schema deve incluir TODOS os path parameters (companyId + outros)

---

## Testes

```bash
bun test --env-file=.env.test
```

- 174 integration tests (10 arquivos) + 71 unit tests (deployment.test.ts)
- Separate test DB via `.env.test`
- `afterAll(() => cleanAll())` em cada suite
- `HAWKBIT_ENABLED=false` — zero hawkBit calls

---

## Environment

Ver `.env.example` para lista completa. Fonte única: `src/common/config/env.ts` (TypeBox validated).

Novas variáveis devem ser adicionadas em: (1) `env.ts` schema, (2) `.env.example`, (3) `.env.test` simultaneamente.
