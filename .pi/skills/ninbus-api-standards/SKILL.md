---
name: ninbus-api-standards
description: >
  Padrões para o Ninbus API (Bun + Elysia + Drizzle + Better Auth + hawkBit 1.0.3).
---

# Ninbus API — Padrões

## Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Bun ≥1.1 |
| Framework | Elysia.js |
| ORM | Drizzle ORM + postgres.js |
| Auth | Better Auth (cookie sessions + Bearer token) |
| OTA | Eclipse hawkBit 1.0.3 |
| Proxy reverso | nginx (name-based vhost — único ponto público) |
| Validação | TypeBox (via Elysia) |
| Logging | Pino (JSON em prod) |

---

## Arquitetura

```
Internet → nginx (:80/:443/:8080) ── name-based vhost (Host/SNI) ──┐
  │                                                                  │
  │   api.ninbus.frt.com.br → API          hb.ninbus.frt.com.br → DDI only
Flutter → Ninbus API (Cookie/Bearer) → hawkBit Management (Basic Auth, rede interna)
                │                              │
                │                              └── DDI (TargetToken, device polling)
                │
                └── PostgreSQL (Neon) ← Sync Engine (background)
```

**Proxy reverso (nginx):** único ponto público. Management API e UI do hawkBit
não são expostas — só o path DDI `/<tenant>/controller/v1/*`. hawkBit usa
`SERVER_FORWARD_HEADERS_STRATEGY=framework` para gerar `_links` DDI com o domínio
público (`hb…`) em vez do hostname interno. Detalhes: `docker/nginx/` e
`docs/nginx-reverse-proxy-plan.md`.

**Módulos:** Auth · Companies · Categories · Devices · Deployments · Artifacts · Health

---

## Módulos

Auth · Admin (factory) · Companies (+ designations) · Categories (+ membros) · Devices (+ name-sync) · Deployments (+ snapshot) · Artifacts · SSE · Health

## Autorização — 3 Camadas

1. **`auth: true`** — qualquer usuário logado
2. **`superAdmin: true`** — emails em `SUPER_ADMIN_EMAILS` env var (não DB)
3. **`companyRole: 'viewer'`** — RBAC: owner(4) > admin(3) > operator(2) > viewer(1)

Rotas sem `:companyId` NUNCA usam `companyRole`. Rotas `/api/admin/*` e `/api/devices/*`
(factory provisioning) usam `superAdmin: true`.

### Modelo Fábrica (Onboarding por Email)

- **POST /companies** exige `superAdmin` + `ownerEmail`. Se o usuário já existe,
  vira owner imediatamente; senão, designação pendente (tabela `pending_company_members`)
  resolvida automaticamente no sign-up via hook `user.create.after`.
- Safety-net: `GET /companies` resolve pendências antes de listar.
- POST /members também é por **email** (granted/pending). Último owner protegido (409).
- Empresas suspensas bloqueiam writes (GET permitido). Apenas super admin suspende.

### ⚠️ companyRole NÃO verifica ownership de dados

O `companyRole` macro verifica apenas se o usuário é **membro** da empresa. Ele **NÃO** verifica se os **dados acessados pertencem àquela empresa**. O service layer deve sempre:

1. Receber `companyId` como parâmetro
2. Filtrar/buscar com `WHERE company_id = :companyId`
3. Verificar ownership via `requireOwnership(companyId, hawkbitId)` antes de qualquer mutation

### ⚠️ hawkBit é single-tenant — ownership SEMPRE pela tabela local

hawkBit roda com **um tenant só ("DEFAULT")** e **não tem noção de companyId**.
Portanto, qualquer lookup global no hawkBit (por SM ID, targetId, DS ID) é
**cross-tenant por design**. O ownership DEVE ser enforced pela tabela local
Ninbus, filtrada por `companyId`:

- **Artifacts (Software Modules):** `findSoftwareModule(companyId, nameOrId)`
  busca na tabela `artifacts` com `WHERE company_id` — nunca `hawkbitSoftwareModules.get/list`
  direto. Aceita nome de exibição OU SM-ID, ambos validados contra a empresa.
- **Targets (Devices):** rotas que recebem `targetId` no path (action-status,
  ddi-check) DEVEM chamar `isTargetOwnedByCompany(companyId, targetId)` antes
  de qualquer chamada hawkBit → 404 se não pertencer (nunca 403, para não
  vazar existência).
- **Distribution Sets (Deployments):** já escopados por `requireDeploymentOwnership`
  e `WHERE company_id`.

Brute-force de IDs sequenciais do hawkBit (SM ID 1, 2, 3...) retorna 404 para
qualquer empresa — não enumera o catálogo alheio.

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

## Categorias (Grupos) e Membros

3 tipos pré-existentes: `bus_line` (linhas) · `garage` (garagens) · `region` (regiões).
Também suporta `yard` e `custom`.

**CRUD do grupo:** `/api/companies/:companyId/categories` (viewer→GET, operator→POST/PUT, admin→DELETE).

**Membros do grupo (N:N devices):** `/api/companies/:companyId/categories/:categoryId/devices`
- GET (viewer) — lista dispositivos do grupo com `assignedAt`
- POST (operator) — adesão em massa, **idempotente** (skip já-membros), **cross-tenant safe** (filtra deviceIds por companyId)
- PUT (operator) — substitui todos os membros
- DELETE /:deviceId (operator) — remove um membro (device permanece na empresa)

Deletar o grupo cascade as atribuições (dispositivos permanecem). Um device pode
estar em N grupos simultaneamente.

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
- **DDI atrás de proxy:** `SERVER_FORWARD_HEADERS_STRATEGY=framework` no hawkBit + o proxy envia `Host`, `X-Forwarded-Proto/Host/Port`. Sem isso, os `_links` das respostas DDI saem com o hostname interno (`hawkbit:8080`) e os devices não conseguem segui-los. Só o path `/<tenant>/controller/v1/*` fica público; `/rest/v1/*` (Management API) é bloqueado no proxy.
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

**Sync adaptativo:** Quando detecta devices pending, ativa fast sync (5s), pausa sync normal (30s), e polla action status para emitir SSE de progresso em tempo real. Quando deploy termina, retoma sync normal.

**Scalability:** Max 50 devices/ciclo com round-robin, cache de action para skip de polls redundantes, deduplicação por controllerId, concurrency limit 10.

### Firmware OTA — Tar Canônico v4 + Manifesto NPM (v1/v2)

Firmware de device viaja SEMPRE como `.tar` canônico (USTAR, mtime=0, 2 membros na ordem):

```
update-app.tar
├── artifact.info        → 'type "<artifactType>"\n'   (ASCII, primeiro membro)
└── data/firmware.npm    → ninbus: manifesto assinado (128 B) + imagem
    └── data/controller.fir / data/config.frz → payload raw nos demais tipos
```

Tipos de release no catálogo: `firmware-ninbus` (self-update) · `firmware-controller` (CAN). `configuration-nfx` é dado operacional company-scoped (módulo artifacts), NÃO entra no catálogo de firmware.

**Manifesto NPM (128 B)** — o formato antigo `header-info/featureidentity.json` foi rejeitado pelo firmware v4 (incidente deployment 657):

| Offset | v1 (legado) | v2 (version-piso) |
|---|---|---|
| 0..3 | `NPM\x01` | `NPM\x02` |
| 4..7 | size u32 LE | idem |
| 8..39 | digest | digest ESTENDIDO |
| 40..43 | counter u32 LE | idem |
| 44..47 | — | **version u32 LE** (major≪24\|minor≪16\|patch≪8\|build) |
| 48..51 | — | **flags u32 LE** (bit0=allow_downgrade; demais bits = 0) |
| 52/44 | len(DER) | len(DER) em v2 (@52) |
| 53/45.. | DER ECDSA-P-256 (prehashed) + pad 0xFF | idem (@53) |

digest v1 = `SHA256(imagem ‖ counter ‖ size)` · v2 = `SHA256(imagem ‖ counter ‖ size ‖ version ‖ flags)` — version e flags são ASSINADOS (tamper quebra o digest). Oracle: `Ninbus-v4/tools/ota_sign.py` (`--version`, `--allow-downgrade`). Device v2: rejeita `counter ≤ piso` OU (`version ≤ piso` E `!allow_downgrade`). Versões v2 são `X.Y.Z[.B]` estritas — sem sufixos (`-dev`/`-rc`).

### Firmware — Ciclo de Vida da Release (draft → pilot → published)

```
upload (draft) ──▶ deploy piloto (releaseId explícito, console admin) ──▶ publish (gate completo)
   │                      │                                                │
   │                      │ gate 'pilot' (estrutural)                      │ companies veem update_available
   │                      │ resposta: draftPilot flag                     │ opt-in install via trigger
   └──────────────────────┴── sem releaseId → resolve SÓ published (nunca draft)
```

**Regras do contrato (incidentes 660–664):**
- **Upload .tar de fábrica**: versão assinada no manifesto é a FONTE; a digitada é CONFERÊNCIA (mismatch = 400). Counter deve ser estritamente > max do catálogo.
- **Upload .bin**: server assina v2 (FIRMWARE_SIGNING_KEY) com counter = max+1 automático (inclui drafts).
- **Publish**: exige o gate completo — re-download do artefato servido, integridade do tar, sha256 da imagem recomputado, v2 com version == declarada, counter > max published, version > piso da frota (salvo allow_downgrade assinado). Veredito persistido em `firmware_releases.gate` (JSONB) + `gateAt`.
- **Anti-replay floor (bootloader)**: counter servido é queimado nos devices mesmo em falha/rollback. Delete da única portadora do counter servido → 409 `COUNTER_FLOOR_BURNED`; `?realignFloor=true` transfere o piso pra release mais antiga (runbook automatizado). **Console (dashboard)**: o 409 abre um 2º ConfirmDialog oferecendo "excluir transferindo o piso" — `firmwareService.remove(id, {realignFloor})` via `http.delete(path, query)`. Nunca exiba toast de sucesso sem o resolve real do fetch (bug clássico: bundle stale do browser mente — Ctrl+Shift+R após deploys do dashboard).
- **Re-oferecimento**: última deployment do tipo com todos os targets em `error` + mesma versão + release ANTERIOR à deployment → 409 `REJECTED_ARTIFACT` (escape: `force: true` para falha transitória).

### Firmware — Mapa do Módulo (`src/modules/firmware/`)

| Arquivo | Responsabilidade |
|---|---|
| `errors.ts` | `FirmwareValidationError` + mapa canônico código→HTTP (toda rota usa `firmwareErrorResponse()`) |
| `catalog.ts` | leituras (list/latest/byId) + `catalogCounterFloor()` (fonte única do max(counter)) |
| `upload.ts` | pipeline de upload (sign/validate/hawkBit/insert) |
| `delete.ts` | delete + guard de piso + realign |
| `publication-gate.ts` | gate (publish/pilot) + evidência + status flip |
| `deploy-trigger.ts` | trigger (resolução de release, piloto, re-offer, draftWarning) |
| `status-service.ts` | leitura company (status mobile + enrichment) |
| `ota-signer.ts` · `tar-validator.ts` · `versioning.ts` | contrato cripto/formato + semver |
| `service.ts` | barrel (re-exports — import sites estáveis) |

**HTTP canônico dos erros**: `NOT_FOUND`→404 · `DUPLICATE_VERSION`/`INVALID_STATUS`/`COUNTER_FLOOR_BURNED`/`GATE_FAILED`/`REJECTED_ARTIFACT`→409 · demais→400.

**Testes**: ciclo draft⇄published testa com tipo `firmware-controller` (gate é no-op pass) sob `HAWKBIT_ENABLED=false`; suíte pura do contrato v2 em `tests/firmware-manifest-v2.test.ts` (layout, digest estendido, tamper, flags, v1 compat).

---

## Device Lifecycle

| Ação | Quem | hawkBit Target | DB Record | Name sync |
|------|------|---------------|-----------|-----------|
| Provision | Super admin | Cria | Cria (unclaimed) | — |
| Claim | Company member | Preservado | companyId set | ✅ PUT name |
| Unclaim | Admin | **PRESERVADO** | companyId=null | — |
| Deprovision | Super admin | **DELETADO** | **DELETADO** | — |
| Rename (PUT) | Operator | Preservado | name updated | ✅ PUT name |

### Name Sync (Device → hawkBit)

O `name` do usuário é propagado ao hawkBit via `PUT /rest/v1/targets/{controllerId} { name }`
em claim/update/link (`src/modules/devices/name-sync.ts`). Best-effort: erros não
bloqueiam a mutação local (DB é canônico). Guard `hawkbitConfig.enabled`.

## Deployment Snapshot (STICKY-FINISHED)

hawkBit NÃO preserva histórico de actions canceladas/substituídas. O Ninbus
armazena snapshot imutável por target em `deployments.target_status_snapshot` (JSONB).

**Regra STICKY-FINISHED:** uma vez `installed`, o snapshot é frozen e NUNCA
sobrescrito (nem por cancel). Dispositivos em estado não-terminal viram `canceled`
quando o deployment é cancelado.

- `GET /target-statuses` prefere snapshot frozen (preserva histórico).
- `GET /deployments` NÃO filtra `!deleted` (histórico nunca some).
- Sync engine freeze automaticamente em fases terminais.

---

## SSE Events

### Device & Deployment Lifecycle

| Evento | Quando |
|--------|--------|
| `device.status` | Sync atualiza device |
| `device.deployment` | Target recebe deployment |
| `device.action.status` | **Progresso detalhado** (phase + progress 0-100%) durante deploy ativo |
| `deployment.stats` | **Estatísticas agregadas** do deployment (total, finished, failed, etc.) |
| `device.claimed` / `device.unclaimed` | Claim/unclaim |
| `deployment.created` / `deployment.deleted` | Deploy CRUD |
| `devices.batch` | Sync cycle completo |

### device.action.status — Real-Time Progress

Pushado a cada ciclo de sync quando existem devices com `hawkbitUpdateStatus='pending'`. O sync engine muda para modo rápido (5s) durante deploys ativos.

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

`phase`: assigned → pending → downloading → downloaded → installing → installed / error / canceled
`progress`: 0-100 (download), null (outras phases)

### deployment.stats — Aggregate Statistics

```json
{
  "deploymentId": 5,
  "summary": { "totalTargets": 10, "finished": 7, "failed": 0, "inProgress": 2, "pending": 1, "canceled": 0 },
  "status": "in_progress"
}
```

---

## Convenções de Código

- **Files < 250 linhas** — split em sub-arquivos quando necessário
- **Response schemas** em `schemas.ts`, nunca inline em rotas
- **hawkBit guard:** checar `hawkbitConfig.enabled` antes de qualquer chamada
- **Config:** TUDO por `env.ts`, nunca `process.env` direto
- **Logger:** `%s/%d/%j` format strings em hot-path. Template literals OK em startup
- **Drizzle dates:** usar `t.Date()` em response schemas (aceita Date objects), nunca `t.String({ format: 'date-time' })`
- **Params:** schema deve incluir TODOS os path parameters (companyId + outros)
- **Comentários:** código enxuto — JSDoc de 1 linha por export; rationale/histórico de decisões e contratos vivem AQUI (skill) e em `docs/notes/`, NUNCA acumulados em comentários de bloco no código (stale comments mentem)

---

## Testes

```bash
bun test --env-file=.env.test
```

- **Integration tests** (10 arquivos): auth · companies · categories · devices · deployments · artifacts · provisioning · health · posts · sse
- **Unit tests**: deployment status helpers · snapshot (STICKY-FINISHED, 6 test) · name-sync (5 test) · enrichment · email
- Separate test DB via `.env.test`
- `afterAll(() => cleanAll())` em cada suite — limpa TODAS as tabelas em ordem FK
- `HAWKBIT_ENABLED=false` — zero hawkBit calls
- `SUPER_ADMIN_EMAILS=admin-test@ninbus.com.br` para setup (factory)

---

## Environment

Ver `.env.example` para lista completa. Fonte única: `src/common/config/env.ts` (TypeBox validated).

Novas variáveis devem ser adicionadas em: (1) `env.ts` schema, (2) `.env.example`, (3) `.env.test` simultaneamente.
