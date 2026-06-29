# Code Patterns — Ninbus API

Padrões de código usados no projeto com exemplos concretos.

---

## 1. Module Pattern

```
src/modules/<feature>/
├── index.ts       # Rotas (Elysia) — nunca lógica de negócio
├── schemas.ts     # TypeBox validation (body, params, response)
├── service.ts     # Lógica (Drizzle queries + hawkBit calls)
└── *.ts           # Sub-rotas se > 250 linhas total
```

- Arquivos < 250 linhas
- `service.ts` nunca importa Elysia
- `schemas.ts` nunca importa `service.ts`

---

## 2. Auth Guard

```typescript
// Company routes
export const mod = withAuth(new Elysia({ prefix: '/api/companies/:cid/...' }))
  .get('/', handler, { companyRole: 'viewer' })
  .post('/', handler, { companyRole: 'operator' })

// Platform routes (sem companyId) — nunca companyRole!
export const mod = withAuth(new Elysia({ prefix: '/api/devices' }))
  .post('/provision', handler, { auth: true })
```

---

## 3. hawkBit Error Guard (Two-Level)

```typescript
// Service — config check
if (!hawkbitConfig.enabled) throw new ValidationError('hawkBit disabled');

// Route — network error catch
catch (error) {
  if (error instanceof HawkbitApiError) { set.status = 502; return ...; }
  set.status = 503; return { error: 'Service Unavailable' };
}
```

---

## 4. Response Format

```typescript
// List (200)
{ data: [...], total: number }

// Create (201)
{ message: 'Created', data: { id, ... } }

// Delete (200)
{ message: 'Deleted' }

// Error (4xx/5xx)
{ error: 'Not Found', message: 'details' }
```

---

## 5. hawkBit Client

```
src/common/hawkbit/
├── client.ts              # Barrel + utilities (<100 linhas)
├── http.ts                # hawkbitRequest() + HawkbitApiError
├── targets.ts             # CRUD, actions, DS assignment
├── distribution-sets.ts   # CRUD, stats
├── software-modules.ts    # CRUD, artifact upload
├── constants.ts           # Artifact types
└── types.ts               # DTOs
```

- HTTP Basic Auth
- Bulk POST: array body `[data]`
- Upload: `FormData.append('file', file)`

---

## 6. Environment

```typescript
// env.ts — FONTE ÚNICA
const EnvSchema = Type.Object({ DATABASE_URL: Type.String(), ... });

// hawkbit.ts — thin accessor (ZERO process.env reads)
export const hawkbitConfig = { get enabled() { return env.HAWKBIT_ENABLED; } };
```

Nunca `process.env` fora de `env.ts`.

---

## 7. Serial Number

```typescript
normalizeSerial("25.5F.FF.FFF.FFFFF.F")
// → { hex: "255FFFFFFFFFFFF", display: "25.5F.FF.FF.FF.FF.FF.F" }
```

hex → hawkBit controllerId + DB · display → frontend

---

## 8. Better Auth Plugin Config

```typescript
// CORRETO — array
plugins: [bearer()]

// ERRADO — objeto (causa TypeError: .reduce is not a function)
plugins: { bearer: bearer() }
```

Better Auth 1.4.x espera plugins como array. Objeto causa crash na inicialização.

---

## 9. Auth in Route Bodies

Better Auth lê `request.json()` internamente — Elysia body schemas causam "Body already used".

```typescript
// CORRETO — document body in description string
.post('/sign-in/email', handler, {
  body: SignInBodySchema,  // for Swagger docs only
  detail: {
    description: 'Request Body: {"email": "...", "password": "..."}',
  },
})

// HANDLER — recria Request para Better Auth
({ body, request }) => auth.handler(
  new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(body),
  })
)
```

---

## 10. Tenant Isolation (Write-Through Pattern)

hawkBit é global — não tem conceito de empresa. O isolamento é garantido pelo banco local.

```typescript
// Schema — tabela local com companyId + hawkBit ID
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  hawkbitSmId: integer('hawkbit_sm_id').notNull(),  // UNIQUE index
  name: text('name').notNull(),
  // ...
}, (table) => [uniqueIndex('idx_artifacts_hawkbit_sm_id').on(table.hawkbitSmId)]);

// Service — ownership check antes de qualquer operação
async function requireOwnership(companyId: string, hawkbitSmId: number) {
  const [local] = await db.select({ companyId: artifacts.companyId })
    .from(artifacts).where(eq(artifacts.hawkbitSmId, hawkbitSmId));
  if (!local || local.companyId !== companyId)
    throw new ArtifactNotFoundError('Artifact not found in this company');
}

// Service — write-through: hawkBit + banco local
export async function uploadArtifact(companyId, userId, file, ...) {
  const sm = await hawkbitSoftwareModules.create({...});  // hawkBit
  await db.insert(artifacts).values({ companyId, hawkbitSmId: sm.id, ... });  // local
}

// Service — list filtrado
export async function listArtifacts(companyId) {
  const local = await db.select().from(artifacts).where(eq(artifacts.companyId, companyId));
  if (local.length === 0) return { data: [], total: 0 };
  const hawkbitData = await hawkbitSoftwareModules.listByIds(local.map(a => a.hawkbitSmId));
  return { data: enrich(hawkbitData), total: hawkbitData.length };
}

// Route — passa companyId + userId
.get('/', ({ params }) => service.listArtifacts(params.companyId), { companyRole: 'viewer' })
.post('/', ({ params, user }) => service.uploadArtifact(params.companyId, user.id, ...), { companyRole: 'operator' })
```

Mesmo padrão para devices (já existia) e deployments (adicionado junto com artifacts).
