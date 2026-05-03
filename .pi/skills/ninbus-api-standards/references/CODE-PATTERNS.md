# Code Patterns Reference — Ninbus API

Este documento cataloga os padrões de código usados no projeto com exemplos concretos.

---

## 1. Padrão: Module (Feature-based)

Cada módulo segue a tríade: **routes** → **schemas** → **service**

```
src/modules/<feature>/
├── index.ts     # Rotas (Elysia controller) — NUNCA lógica de negócio
├── schemas.ts   # TypeBox validation schemas (quando houver)
└── service.ts   # Lógica de negócio (queries Drizzle + chamadas Mender)
```

**Regras**:
- `index.ts` é o único arquivo que importa de `schemas.ts` e `service.ts`
- `service.ts` nunca importa de Elysia
- `schemas.ts` nunca importa de `service.ts`
- Módulos com rotas extras (>200 linhas) splitam em `manage-routes.ts`, `member-routes.ts`, `mender-routes.ts`, etc.

**Módulos atuais**: auth (2 files), companies (4 files), categories (3 files), devices (6 files), deployments (4 files), artifacts (4 files), health (1 file), posts (3 files)

---

## 2. Padrão: Factory App

```typescript
// src/app.ts
export const createApp = () => {
  const app = new Elysia()
    .use(requestLogger)
    .use(globalRateLimit)
    .use(cors({ origin: env.CORS_ORIGIN, credentials: true }))
    .use(swagger({ ... }))
    .onError(({ code, error, set }) => { ... })
    .use(healthModule)
    .use(postsModule)
    .use(companiesModule)
    .use(categoriesModule)
    .use(devicesModule)
    .use(deploymentsModule)
    .use(artifactsModule);

  if (env.ENABLE_AUTH) {
    app.use(authRateLimit);
    app.use(authModule);
  }

  return app;
};
```

**Por quê?** Permite criar instâncias isoladas para testes sem side effects.

---

## 3. Padrão: Auth Guard Macro

```typescript
// Uso — injeta user/session em todas as rotas do módulo
export const postsModule = withAuth(new Elysia({ prefix: '/api/posts' }))
  .get('/', handler, { /* pública — sem auth */ })
  .post('/', handler, { auth: true, body: ... })  // protegida
  .put('/:id', handler, { auth: true, ... });      // protegida
```

**Como funciona**:
1. `withAuth()` chama `derive()` para injetar `user` e `session` em toda request
2. A macro `auth: true` registra `beforeHandle` que retorna 401 se `user` for null
3. Ownership checks são feitos manualmente no handler com `isOwner()`

---

## 4. Padrão: Company-scoped Routes

Todas as rotas de devices, categories, deployments e artifacts usam:

```typescript
// src/modules/devices/index.ts
export const devicesModule = withAuth(
  new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
  .get('/', async ({ params, user, set }: any) => {
    const memberCheck = await isCompanyMember(params.companyId, user.id);
    if (!memberCheck) {
      set.status = 403;
      return { error: 'Forbidden', message: 'Not a member of this company' };
    }
    // ... lógica
  }, { auth: true, ... });
```

**Padrão**: Todo handler de rota company-scoped DEVE:
1. Verificar `isCompanyMember(params.companyId, user.id)`
2. Retornar 403 se não for membro
3. Usar `params.companyId` para filtrar dados

---

## 5. Padrão: Drizzle Schema → TypeBox Schema

```typescript
// 1. Definir tabela Drizzle com pgEnum
export const deviceStatusEnum = pgEnum('device_status', [
  'pending', 'accepted', 'rejected', 'preauthorized', 'decommissioned',
]);
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  menderDeviceId: text('mender_device_id'),
  name: text('name').notNull(),
  status: deviceStatusEnum('status').notNull().default('pending'),
  // ...
});

// 2. Gerar schemas TypeBox
export const createPostSchema = createInsertSchema(posts, {
  title: t.String({ minLength: 1, maxLength: 255 }),
});

// 3. Usar nas rotas
body: t.Omit(createPostSchema, ['id', 'authorId', 'createdAt', 'updatedAt'])
```

### N:N Table com Composite PK

```typescript
// src/common/db/schema/devices.ts
export const deviceCategoryAssignments = pgTable(
  'device_category_assignments',
  {
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.deviceId, table.categoryId] }),
  }),
);
```

---

## 6. Padrão: Error Response Format

```typescript
// 400 — Validação
{ error: 'Validation error', message: '<detalhes>' }
{ error: 'Bad Request', message: 'Device is not linked to Mender' }
{ error: 'Bad Request', message: 'Must specify deviceIds, categoryIds, or allDevices' }

// 401 — Não autenticado
{ error: 'Unauthorized', message: 'Please login first' }

// 403 — Proibido
{ error: 'Forbidden', message: 'You are not a member of this company' }
{ error: 'Forbidden', message: 'Not a member of this company' }

// 404 — Não encontrado
{ error: 'Not Found', message: 'Post not found' }
{ error: 'Not Found', message: 'Device not found or not linked to Mender' }

// 422 — Unprocessable
{ error: 'Unprocessable Entity', message: 'No eligible devices found for deployment' }
{ error: 'Unprocessable Entity', message: "Artifact 'x' not found in Mender..." }
{ error: 'Unprocessable Entity', message: "Artifact 'x' is not compatible with ninbus-wifi-v3..." }

// 429 — Rate limit
{ error: 'Too Many Requests', message: 'Rate limit exceeded. Please try again later.' }

// 500 — Erro interno
{ error: 'Internal server error', message: '<msg apenas em dev>' }
```

---

## 7. Padrão: Success Response Format

```typescript
// Listagem (200)
{ data: [...], total: number }

// Busca por ID (200) — pode incluir Mender enrichment
{ data: { ... }, mender: { menderStatus, connectionStatus, lastSeen } | null }

// Criação (201)
{ message: '<Recurso> created successfully', data: { ... } }

// Atualização (200)
{ message: '<Recurso> updated successfully', data: { ... } }

// Deleção (200)
{ message: '<Recurso> deleted successfully' }

// Deployment criado (201) — inclui artifactMeta
{ message: 'Deployment created successfully', data: { id, artifactType, artifactMeta } }

// Artifact types (200)
{ data: [{ type, label, description, target, requiresReboot, riskLevel }, ...] }

// Artifacts listados (200) — enriquecidos com Ninbus type
{ data: [{ ..., ninbusType: 'firmware-ninbus' | null, ninbusMeta: { ... } | null }] }

// Health check (200)
{ status: 'ok' | 'degraded', timestamp, uptime, database, responseTime }
```

---

## 8. Padrão: Ninbus Artifact Types

Constantes canônicas para tipos de artefato OTA:

```typescript
// src/common/mender/client.ts — canonical source of truth
export const NINBUS_ARTIFACT_TYPES = {
  NINBUS_FIRMWARE: 'firmware-ninbus',
  CONTROLLER_FIRMWARE: 'firmware-controller',
  NFX_CONFIGURATION: 'configuration-nfx',
} as const;
export const NINBUS_DEVICE_TYPE = 'ninbus-wifi-v3';
```

```typescript
// src/modules/deployments/schemas.ts — para uso no schema
export const ARTIFACT_TYPE_NINBUS_FIRMWARE = 'firmware-ninbus';
export const ARTIFACT_TYPE_CONTROLLER_FIRMWARE = 'firmware-controller';
export const ARTIFACT_TYPE_NFX_CONFIGURATION = 'configuration-nfx';
```

### Validação no schema:

```typescript
artifactType: t.Union([
  t.Literal('firmware-ninbus', { description: 'Firmware Ninbus → NAND → Bootloader → Reboot' }),
  t.Literal('firmware-controller', { description: 'Firmware Controlador → CAN → LightDot' }),
  t.Literal('configuration-nfx', { description: 'Configuração NFX → NAND NFX → CAN → LightDot' }),
]),
```

### Pre-flight validation no service:

```typescript
export async function validateArtifactForDeployment(artifactName, expectedType) {
  const artifacts = await menderArtifacts.list({ name: artifactName });
  const artifact = artifacts.find(a => a.name === artifactName);
  if (!artifact) throw new Error('not found');
  if (!artifact.device_types_compatible.includes('ninbus-wifi-v3')) throw new Error('not compatible');
  return { artifactId, artifactName, size, expectedType, validated: true };
}
```

### Enriquecimento de artifacts listados:

```typescript
const enriched = artifacts.map((artifact) => ({
  ...artifact,
  ninbusType: isNinbusArtifactType(artifact.type) ? artifact.type : null,
  ninbusMeta: artifactType ? NINBUS_ARTIFACT_TYPE_META[artifactType] : null,
}));
```

---

## 9. Padrão: Company-scoped Mender Operations

Todas as operações Mender são scoped por empresa:

```typescript
// 1. Verificar membership
const memberCheck = await isCompanyMember(companyId, userId);
if (!memberCheck) return 403;

// 2. Resolver Ninbus device IDs → Mender device IDs
const menderDeviceIds = await resolveMenderDeviceIds(companyId, { deviceIds, categoryIds, allDevices });

// 3. Chamar Mender Gateway
const deployment = await menderDeployments.create({ devices: menderDeviceIds, ... });
```

### Device ID Resolution Flow:

```
Ninbus deviceIds[] ──→ DB query (companyId + status=accepted) ──→ extract menderDeviceId[]
Category IDs[] ──────→ DB query (N:N) ──→ Ninbus deviceIds[] ──→ same flow above
allDevices ──────────→ DB query (companyId + status=accepted) ──→ same flow above
```

---

## 10. Padrão: Mender Error Handling

```typescript
// Erros do Mender são encapsulados
export class MenderApiError extends Error {
  status: number;    // HTTP status do Mender
  body: unknown;     // Body do erro
  endpoint: string;  // Path do endpoint
}

// No handler, erros são mapeados:
try {
  const deployment = await service.createDeployment(...);
} catch (error: any) {
  if (error.message?.includes('not found'))      → 422
  if (error.message?.includes('not compatible'))  → 422
  if (error.message?.includes('No eligible'))     → 422
  throw error;  // outros erros → 500 via onError global
}
```

---

## 11. Padrão: Rate Limiter Factory

```typescript
const cache = new LRUCache<string, number[]>({ max: N, ttl: windowMs });

export const rateLimiter = createRateLimiter({
  max: requestsPerWindow,
  windowMs: windowInMs,
  cache,
  skip: (req) => boolean,  // opcional
});
```

---

## 12. Padrão: Environment Validation

```typescript
const EnvSchema = Type.Object({
  VAR_NAME: Type.String({ description: '...', pattern: '...' }),
  MENDER_PAT: Type.Optional(Type.String({ description: 'Mender PAT' })),
  MENDER_GATEWAY_URL: Type.Optional(Type.String({ pattern: '^https?://.+', default: '...' })),
});

export function validateEnv(): Env {
  const rawEnv = { /* parsing de process.env */ };
  if (!Value.Check(EnvSchema, rawEnv)) {
    throw new Error(`Environment validation failed:\n${formatErrors(errors)}`);
  }
  return Value.Decode(EnvSchema, rawEnv);
}

export const env = validateEnv(); // Fail-fast no import
```
