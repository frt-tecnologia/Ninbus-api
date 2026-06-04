# 🔴 BUG CRÍTICO: Vazamento de Artefatos e Deployments Entre Empresas

## Data: 2026-06-04 | Severidade: CRÍTICA (Segurança / Multi-tenancy)

---

## 1. Resumo Executivo

Artefatos e deployments de TODAS as empresas são retornados para qualquer usuário autenticado que seja membro de qualquer empresa. A correção deve seguir o **mesmo padrão dos dispositivos**: tabela local com `companyId`, service layer com ownership check, e sincronização com hawkBit.

**Zero mudanças no frontend** — endpoints, contratos e status codes continuam idênticos.

---

## 2. Diagnóstico: Comparação Dispositivos ✅ vs Artefatos/Deployments ❌

### Fluxo dos Dispositivos (CORRETO — modelo a seguir)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. TABELA LOCAL (devices)                                       │
│    ┌──────────────────────────────────────────────────┐          │
│    │ id (UUID) | companyId | hawkbitTargetId | status │          │
│    │───────────|───────────|─────────────────|────────│          │
│    │ abc-123   | EMP-A     | TARGET-001      |accepted│          │
│    │ def-456   | EMP-B     | TARGET-002      |accepted│          │
│    │ ghi-789   | NULL      | TARGET-003      |unclaimed│         │
│    └──────────────────────────────────────────────────┘          │
│                                                                  │
│ 2. ROUTES (index.ts)                                             │
│    GET / → service.getCompanyDevices(companyId)                  │
│              ↓ SELECT WHERE company_id = :companyId              │
│    POST / → service.registerDevice(companyId, ...)               │
│              ↓ INSERT com companyId                              │
│    DELETE  → service.deleteDevice(deviceId, companyId)           │
│              ↓ verifica companyId no WHERE                       │
│                                                                  │
│ 3. SYNC ENGINE (sync.ts → sync-core/fetch/helpers/strategies)   │
│    Periodic: busca TODOS os targets hawkBit → atualiza DB local  │
│    Hybrid: busca só targets de empresas ativas                   │
│    On-demand: syncCompanyOnDemand(companyId) no GET /devices     │
│    Single-device SWR: syncSingleDeviceSwr(targetId)              │
│                                                                  │
│ 4. RESULTADO                                                     │
│    Empresa A lista → só devices com company_id = EMP-A           │
│    Empresa B lista → só devices com company_id = EMP-B           │
│    Empresa A tenta acessar device da B → 404                     │
└──────────────────────────────────────────────────────────────────┘
```

### Fluxo Atual dos Artefatos (INCORRETO)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. NÃO EXISTE tabela local de artefatos                          │
│    → Sem companyId, sem ownership                                │
│                                                                  │
│ 2. ROUTES (index.ts + manage-routes.ts)                          │
│    GET /  → service.listArtifacts()       ← SEM companyId!      │
│    GET /:id → service.getArtifact(smId)   ← SEM companyId!      │
│    DELETE  → service.deleteArtifact(smId) ← SEM companyId!      │
│    PUT     → service.updateArtifact(smId) ← SEM companyId!      │
│    GET /download → service.getArtifactDownloadUrl(smId) ← SEM!  │
│                                                                  │
│ 3. NÃO EXISTE sync engine para artefatos                         │
│                                                                  │
│ 4. RESULTADO                                                     │
│    Qualquer empresa lista → TODOS os SMs do hawkBit (GLOBAL)     │
│    Empresa A pode deletar SM da Empresa B                        │
│    Empresa B pode baixar firmware da Empresa A                   │
└──────────────────────────────────────────────────────────────────┘
```

### Fluxo Atual dos Deployments (INCORRETO — parcial)

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. NÃO EXISTE tabela local de deployments                        │
│    → Sem companyId, sem ownership                                │
│                                                                  │
│ 2. ROUTES (index.ts)                                             │
│    POST / → service.createDeployment(companyId, ...) ✅ CORRETO  │
│              (filtra targets por companyId)                       │
│    GET /  → service.listDeployments()     ← SEM companyId!      │
│    GET /:id → service.getDeployment(dsId) ← SEM companyId!      │
│    DELETE  → service.deleteDeployment(dsId) ← SEM companyId!    │
│                                                                  │
│ 3. NÃO EXISTE sync engine para deployments                       │
│                                                                  │
│ 4. RESULTADO                                                     │
│    Qualquer empresa lista → TODOS os DSs do hawkBit (GLOBAL)     │
│    Empresa A pode deletar deployment da Empresa B                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Análise: O Padrão de Dispositivos Aplicado a Artefatos/Deployments

### Dispositivos têm sincronização. Artefatos/Deployments precisam?

**NÃO na mesma complexidade.** Dispositivos precisam de sync porque:
- Dados mudam externamente (device faz poll → hawkBit atualiza pollStatus/updateStatus)
- A cada sync cycle, o estado do device muda (connected/disconnected, pending/in_sync)
- Por isso existe sync engine com periodic/hybrid/on-demand, SWR, etc.

**Artefatos são dados essencialmente estáticos:**
- Upload → cria no hawkBit + registra no banco local (WRITE-THROUGH)
- List/Get → lê do banco local, enriquece com dados do hawkBit se necessário
- Delete → remove do hawkBit + do banco local
- Não há estado externo que mude (o hawkBit não altera um SM sozinho)

**Deployments são semi-dinâmicos:**
- O status muda conforme os devices respondem (pending → running → finished/error)
- MAS: o `createDeployment` já grava tudo no hawkBit. O status pode ser enriquecido via enrichment.
- O sync engine de devices já cuida do status dos targets.

### Conclusão: o que replicar e o que não replicar

| Padrão de Devices | Replicar em Artifacts? | Replicar em Deployments? |
|---|:-:|:-:|
| Tabela local com `companyId` | ✅ SIM | ✅ SIM |
| Ownership check no service | ✅ SIM | ✅ SIM |
| `createdBy` no registro | ✅ SIM | ✅ SIM |
| Write-through (cria hawkBit + local) | ✅ SIM | ✅ SIM |
| Sync engine (periodic/hybrid) | ❌ NÃO | ❌ NÃO |
| SWR por item | ❌ NÃO | ❌ NÃO |
| On-demand sync no GET | ❌ NÃO | ❌ NÃO (dados locais) |
| SSE emission | ❌ NÃO (já existe no upload) | ✅ SIM (já existe no create/delete) |

**Por que NÃO precisa de sync engine:**
- Artefatos e deployments são criados EXCLUSIVAMENTE pela API Ninbus
- Não existe agente externo criando SMs ou DSs no hawkBit
- O banco local é a fonte de verdade para ownership
- O hawkBit é consultado para enriquecimento (hashes, tamanhos, estatísticas), NÃO para listing

---

## 4. Plano de Ação (Alinhado ao Padrão de Dispositivos)

### Fase 1: Schema — Tabelas Locais (como `devices.ts`)

**Criar `src/common/db/schema/artifacts.ts`:**

```typescript
// Padrão idêntico ao devices.ts
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  hawkbitSmId: integer('hawkbit_sm_id').notNull(),  // UNIQUE constraint
  name: text('name').notNull(),
  artifactType: text('artifact_type').notNull(),
  version: text('version').notNull().default('1.0'),
  description: text('description'),
  originalFilename: text('original_filename'),
  payloadSize: integer('payload_size'),
  packageSize: integer('package_size'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
// UNIQUE(hawkbit_sm_id) — 1 SM hawkBit = 1 registro Ninbus
```

**Criar `src/common/db/schema/deployments.ts`:**

```typescript
export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  hawkbitDsId: integer('hawkbit_ds_id').notNull(),  // UNIQUE constraint
  name: text('name').notNull(),
  artifactType: text('artifact_type').notNull(),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
// UNIQUE(hawkbit_ds_id)
```

**Atualizar `src/common/db/schema/index.ts`** — adicionar exports.

### Fase 2: Artifacts Service — Refatorar (seguir `devices/service.ts`)

**Padrão atual (devices):**
```typescript
// devices/service.ts — CORRETO
export async function getCompanyDevices(companyId: string) {
  return db.select().from(devices).where(eq(devices.companyId, companyId));
}

export async function getDeviceById(deviceId: string, companyId: string) {
  return db.select().from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));
}

export async function deleteDevice(deviceId: string, companyId: string) {
  const [device] = await db.select().from(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.companyId, companyId)));
  if (!device) return;
  // ... delete logic
}
```

**Novo padrão (artifacts):**
```typescript
// artifacts/service.ts — REFATORADO

/** List artifacts for a specific company (like getCompanyDevices). */
export async function listArtifacts(companyId: string, params?: { offset?; limit? }) {
  // 1. Buscar SM IDs da empresa no banco local
  const localArtifacts = await db.select().from(artifacts)
    .where(eq(artifacts.companyId, companyId));

  if (!hawkbitConfig.enabled || localArtifacts.length === 0) {
    return { data: [], total: 0 };
  }

  // 2. Buscar dados do hawkBit por ID (batch)
  const smIds = localArtifacts.map(a => a.hawkbitSmId);
  const hawkbitSMs = await fetchSoftwareModulesByIds(smIds);

  // 3. Enriquecer e retornar
  const enriched = await Promise.all(hawkbitSMs.map(enrichSoftwareModule));
  return { data: enriched, total: enriched.length };
}

/** Get artifact — verify ownership first (like getDeviceById). */
export async function getArtifact(companyId: string, smId: number) {
  await requireOwnership(companyId, smId);  // throws 404 if not owned
  requireHawkbit();
  return enrichSoftwareModule(await hawkbitSoftwareModules.get(smId));
}

/** Upload — write-through: hawkBit + local DB (like registerDevice). */
export async function uploadArtifact(companyId: string, userId: string, file, name, type, ...) {
  // 1. Cria no hawkBit (exatamente como hoje)
  const sm = await hawkbitSoftwareModules.create({...});
  const artifact = await hawkbitSoftwareModules.uploadArtifact(sm.id, file);

  // 2. Registra no banco local (como claimDevice grava companyId)
  await db.insert(artifacts).values({
    companyId, hawkbitSmId: sm.id, name, artifactType: type,
    createdBy: userId, originalFilename: file.name, ...
  });

  return { smId: sm.id, ... };
}

/** Ownership helper (shared between get/delete/update/download). */
async function requireOwnership(companyId: string, smId: number) {
  const [local] = await db.select({ companyId: artifacts.companyId })
    .from(artifacts).where(eq(artifacts.hawkbitSmId, smId));
  if (!local || local.companyId !== companyId) {
    throw new ArtifactNotFoundError('Artifact not found');
  }
}
```

### Fase 3: Deployments Service — Refatorar (mesmo padrão)

```typescript
// deployments/service.ts — REFATORADO

/** Create — já funciona, adicionar registro local. */
export async function createDeployment(companyId: string, userId: string, data) {
  const ds = await hawkbitDistributionSets.create({...});
  // NOVO: registrar no banco local
  await db.insert(deployments).values({
    companyId, hawkbitDsId: ds.id, name: data.name,
    artifactType: data.artifactType, createdBy: userId,
  });
  // ... resto da lógica (assign targets, etc.)
}

/** List — filtrar por companyId (como getCompanyDevices). */
export async function listDeployments(companyId: string, params?) {
  const localDeployments = await db.select().from(deployments)
    .where(eq(deployments.companyId, companyId));

  if (!hawkbitConfig.enabled || localDeployments.length === 0) {
    return { data: [], total: 0 };
  }

  // Buscar DSs do hawkBit por ID + enriquecer
  const dsIds = localDeployments.map(d => d.hawkbitDsId);
  // ... fetch from hawkBit, enrich, return
}

/** Ownership helper. */
async function requireDeploymentOwnership(companyId: string, dsId: number) {
  const [local] = await db.select({ companyId: deployments.companyId })
    .from(deployments).where(eq(deployments.hawkbitDsId, dsId));
  if (!local || local.companyId !== companyId) {
    throw new DeploymentNotFoundError('Deployment not found');
  }
}
```

### Fase 4: Routes — Passar companyId + userId (como devices)

**Antes (artifacts/manage-routes.ts):**
```typescript
const result = await service.listArtifacts({ offset, limit });  // SEM companyId!
```

**Depois:**
```typescript
const result = await service.listArtifacts(params.companyId, { offset, limit });
```

**Antes (artifacts/index.ts — upload):**
```typescript
const result = await uploadArtifact(artifactFile, body.artifactName, ...);  // SEM companyId!
```

**Depois:**
```typescript
const result = await uploadArtifact(params.companyId, user.id, artifactFile, body.artifactName, ...);
```

### Fase 5: hawkBit Client — Adicionar busca por IDs (como fetchTargetsByIds)

**Novo helper em `software-modules.ts`:**
```typescript
/** List software modules by IDs (for company-scoped listing). */
async listByIds(smIds: number[]): Promise<HawkbitSoftwareModule[]> {
  if (smIds.length === 0) return [];
  // hawkBit suporta RSQL: q=id=in=(1,2,3)
  const q = `id=in=(${smIds.join(',')})`;
  const result = await hawkbitRequest({
    method: 'GET', path: '/rest/v1/softwaremodules',
    query: { q, limit: Math.min(smIds.length, 500) }
  });
  return result.content;
}
```

**Novo helper em `distribution-sets.ts`:**
```typescript
async listByIds(dsIds: number[]): Promise<HawkbitDistributionSet[]> {
  if (dsIds.length === 0) return [];
  const q = `id=in=(${dsIds.join(',')})`;
  const result = await hawkbitRequest({
    method: 'GET', path: '/rest/v1/distributionsets',
    query: { q, limit: Math.min(dsIds.length, 500) }
  });
  return result.content;
}
```

### Fase 6: Testes Cross-Tenant

```typescript
describe('Artifact Tenant Isolation', () => {
  // Setup: criar empresa A e B, upload artefato na A
  it('Empresa B lista artefatos → retorna vazio', async () => { ... });
  it('Empresa B tenta GET do artefato da A → 404', async () => { ... });
  it('Empresa B tenta DELETE do artefato da A → 404', async () => { ... });
  it('Empresa B tenta PUT do artefato da A → 404', async () => { ... });
  it('Empresa B tenta download do artefato da A → 404', async () => { ... });
});

describe('Deployment Tenant Isolation', () => {
  // Setup: criar empresa A e B, criar deployment na A
  it('Empresa B lista deployments → retorna vazio', async () => { ... });
  it('Empresa B tenta GET do deployment da A → 404', async () => { ... });
  it('Empresa B tenta DELETE do deployment da A → 404', async () => { ... });
});
```

### Fase 7: Migration de Dados Existentes

Para artefatos/deployments já existentes no hawkBit sem mapeamento:
- Opção recomendada: Script SQL manual que associa a uma empresa padrão
- Ou: excluir e re-upload (mais seguro para dados de teste)

---

## 5. Comparação: Padrão Devices vs Proposta Artifacts/Deployments

```
DEVICES                          ARTIFACTS (proposto)              DEPLOYMENTS (proposto)
─────────────────────────────    ─────────────────────────────    ─────────────────────────────
Tabela: devices                  Tabela: artifacts                 Tabela: deployments
  id (UUID) PK                     id (UUID) PK                     id (UUID) PK
  companyId FK                     companyId FK                     companyId FK
  hawkbitTargetId                  hawkbitSmId (UNIQUE)             hawkbitDsId (UNIQUE)
  status                           artifactType                     name
  ...                              createdBy                        createdBy
                                   ...                              ...

Service:                         Service:                         Service:
  getCompanyDevices(cid)          listArtifacts(cid)               listDeployments(cid)
  getDeviceById(id, cid)          getArtifact(cid, smId)           getDeployment(cid, dsId)
  registerDevice(cid, ...)        uploadArtifact(cid, uid, ...)    createDeployment(cid, uid, ...)
  deleteDevice(id, cid)           deleteArtifact(cid, smId)        deleteDeployment(cid, dsId)
  updateDevice(id, cid, ...)      updateArtifact(cid, smId, ...)   (update não existe)

Sync Engine:                     Sync Engine:                     Sync Engine:
  ✅ periodic/hybrid/on-demand    ❌ NÃO precisa                   ❌ NÃO precisa
  ✅ SWR per-device               ❌ NÃO precisa                   ❌ NÃO precisa
  Motivo: device status muda      Motivo: artefato é estático      Motivo: status via enrichment
  externamente via DDI poll       (não muda sozinho)               (computeDeploymentStatus)

 hawkBit Client:                 hawkBit Client:                  hawkBit Client:
  hawkbitTargets.list()           hawkbitSoftwareModules.list()    hawkbitDistributionSets.list()
  hawkbitTargets.get(id)          hawkbitSoftwareModules.get(id)   hawkbitDistributionSets.get(id)
  hawkbitTargets.create(...)      hawkbitSoftwareModules.create()  hawkbitDistributionSets.create()
  + fetchTargetsByIds(ids)        + listByIds(smIds) ← NOVO       + listByIds(dsIds) ← NOVO

Routes:                          Routes:                          Routes:
  GET / → getCompanyDevices(cid)  GET / → listArtifacts(cid)       GET / → listDeployments(cid)
  POST / → registerDevice(cid)    POST / → uploadArtifact(cid)     POST / → createDeployment(cid)
  DELETE /:id → verifica cid      DELETE /:id → verifica cid       DELETE /:id → verifica cid
```

---

## 6. Arquivos a Criar/Modificar

| Arquivo | Ação | Linhas (~) |
|---------|------|:---:|
| `src/common/db/schema/artifacts.ts` | **NOVO** — tabela Drizzle | 40 |
| `src/common/db/schema/deployments.ts` | **NOVO** — tabela Drizzle | 30 |
| `src/common/db/schema/index.ts` | Adicionar exports | +2 |
| `src/common/hawkbit/software-modules.ts` | Adicionar `listByIds()` | +15 |
| `src/common/hawkbit/distribution-sets.ts` | Adicionar `listByIds()` | +15 |
| `src/modules/artifacts/service.ts` | Refatorar: companyId, ownership, write-through | 250 |
| `src/modules/artifacts/index.ts` | Passar companyId + userId | ~5 mudanças |
| `src/modules/artifacts/manage-routes.ts` | Passar companyId | ~5 mudanças |
| `src/modules/deployments/service.ts` | Refatorar: companyId, ownership, write-through | ~280 |
| `src/modules/deployments/index.ts` | Passar companyId + userId | ~5 mudanças |
| `tests/artifacts.test.ts` | Adicionar testes cross-tenant | +60 |
| `tests/deployments.test.ts` | Adicionar testes cross-tenant | +60 |
| Drizzle migration | **NOVA** migration SQL | ~30 |

**Total: ~13 arquivos, ~4-6h de trabalho**

---

## 7. O Que NÃO Precisa Ser Feito

| Item | Por que não |
|------|-------------|
| Sync engine para artefatos | Artefatos são criados pela API, não mudam externamente |
| Sync engine para deployments | Status obtido via enrichment (computeDeploymentStatus), não sync |
| SWR (stale-while-revalidate) | Dados locais são atuais (write-through) |
| SSE para artifact status | Artefatos não têm status dinâmico |
| Mudanças no frontend | Endpoints, contratos e status codes idênticos |

---

## 8. Ordem de Execução

1. **Schema** → criar tabelas + migration + export
2. **hawkBit client** → adicionar `listByIds()` nos dois sub-clients
3. **Artifacts service** → refatorar com companyId + ownership + write-through
4. **Artifacts routes** → repassar companyId + userId
5. **Deployments service** → refatorar com companyId + ownership + write-through
6. **Deployments routes** → repassar companyId + userId
7. **Testes cross-tenant** → artifacts + deployments
8. **Migration de dados existentes** → associar artefatos órfãos a empresa padrão
9. **Build + testes** → validar tudo passa
