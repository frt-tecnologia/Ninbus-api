# Code Patterns Reference — Ninbus API

Este documento cataloga os padrões de código usados no projeto com exemplos concretos.

---

## 1. Padrão: Module (Feature-based)

Cada módulo segue a tríade: **routes** → **schemas** → **service**

```
src/modules/<feature>/
├── index.ts     # Rotas (Elysia controller) — NUNCA lógica de negócio
├── schemas.ts   # TypeBox validation schemas (body, params, response)
└── service.ts   # Lógica de negócio (queries Drizzle + chamadas hawkBit)
```

**Regras**:
- `index.ts` é o único arquivo que importa de `schemas.ts` e `service.ts`
- `service.ts` nunca importa de Elysia
- `schemas.ts` nunca importa de `service.ts`
- Módulos com rotas extras (>200 linhas) splitam em `manage-routes.ts`, `member-routes.ts`, `hawkbit-routes.ts`, etc.
- **Todos os arquivos < 250 linhas**

**Módulos atuais**: auth (2), companies (4), categories (3), devices (7), deployments (4), artifacts (4), health (1), posts (3)

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

**Platform routes** (sem `:companyId` no path):
```typescript
// provision-routes.ts — NUNCA usar companyRole!
export const provisionRoutes = withAuth(new Elysia({ prefix: '/api/devices' }))
  .post('/provision', handler, { auth: true, body: ... })
  .get('/unclaimed', handler, { auth: true });
```

**Company routes** (com `:companyId` no path):
```typescript
export const devicesModule = withAuth(
  new Elysia({ prefix: '/api/companies/:companyId/devices' }),
)
  .get('/', handler, { companyRole: 'viewer' })
  .post('/', handler, { companyRole: 'operator', body: ... });
```

---

## 4. Padrão: Serial Number Normalization

```typescript
import { normalizeSerial } from '@common/utils/serial-number';

// Aceita qualquer formato:
normalizeSerial("25.5F.FF.FFF.FFFFF.F")
// → { hex: "255FFFFFFFFFFFF", display: "25.5F.FF.FF.FF.FF.FF.F" }

normalizeSerial("2100280018513531")
// → { hex: "2100280018513531", display: "21.00.28.00.18.51.35.31" }

normalizeSerial("invalid!@#")
// → null
```

**Uso no provisionamento**:
```typescript
const normalized = normalizeSerial(data.serialNumber);
if (!normalized) return { error: 'Invalid serial number format' };

// hex → hawkBit controllerId + DB serial_number
// display → DB serial_display (frontend)
```

---

## 5. Padrão: hawkBit Two-Level Error Guard

Todo código que chama hawkBit APIs deve ter **dois níveis** de proteção:

### Nível 1 — Service (config check)
```typescript
// service.ts
export async function listArtifacts() {
  if (!hawkbitConfig.enabled) {
    throw new ArtifactValidationError('hawkBit integration is disabled');
  }
  return hawkbitSoftwareModules.listArtifacts();
}
```

### Nível 2 — Route handler (network error catch)
```typescript
// manage-routes.ts
.get('/', async ({ set }) => {
  try {
    const data = await artifactService.listArtifacts();
    return { data, total: data.length };
  } catch (error) {
    if (error instanceof ArtifactValidationError) {
      set.status = 400;
      return { error: 'Validation error', message: error.message };
    }
    // Network error → hawkBit unreachable
    set.status = 503;
    return { error: 'Service Unavailable', message: 'hawkBit is not available' };
  }
})
```

**Resultado**: Nunca retorna 500 por hawkBit estar offline. Sempre 400 (disabled) ou 503 (unreachable).

---

## 6. Padrão: hawkBit Client (Split por Domínio)

```
src/common/hawkbit/
├── client.ts              # Barrel re-export + utility functions
├── http.ts                # Core HTTP client (Basic Auth, timeout, TLS)
├── targets.ts             # Target CRUD, attributes, actions, DS assignment
├── distribution-sets.ts   # Distribution Set CRUD, target assignment, stats
├── software-modules.ts    # Software Module CRUD, artifact upload/download
├── constants.ts           # Ninbus artifact types
└── types.ts               # hawkBit API DTO interfaces
```

**Regras**:
- Cada sub-client < 250 linhas
- `client.ts` apenas re-exports (< 100 linhas)
- Todos usam `hawkbitRequest()` de `http.ts`
 hawkBit Management API usa **HTTP Basic Auth** (não PAT)
 hawkBit bulk POST endpoints requerem **array body**: `[data]`

---

## 7. Padrão: Response Schema (schemas.ts)

```typescript
// schemas.ts — SEMPRE definir response schemas aqui
export const DeviceResponseSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  companyId: t.Nullable(t.String({ format: 'uuid' })),
  hawkbitTargetId: t.Nullable(t.String()),
  serialNumber: t.String(),
  serialDisplay: t.String(),
  name: t.String(),
  status: t.String(),
  lastSeenAt: t.Nullable(t.Date()),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

// index.ts — IMPORTAR do schemas.ts, nunca definir inline
import { DeviceResponseSchema } from './schemas';
.get('/:deviceId', handler, {
  response: DeviceResponseSchema,
})
```

---

## 8. Padrão: Error Response Format

```typescript
// 400 — Validação
{ error: 'Validation error', message: '<detalhes>' }

// 401 — Não autenticado
{ error: 'Unauthorized', message: 'Please login first' }

// 403 — Proibido
{ error: 'Forbidden', message: 'Not a member of this company' }

// 404 — Não encontrado
{ error: 'Not Found', message: 'Device not found' }

// 503 — hawkBit indisponível
{ error: 'Service Unavailable', message: 'hawkBit is not available' }
```

---

## 9. Padrão: Success Response Format

```typescript
// Listagem (200)
{ data: [...], total: number }

// Criação (201)
{ message: 'Device provisioned successfully', data: { ... } }

// Atualização (200)
{ message: 'Device updated successfully', data: { ... } }

// Deleção (200)
{ message: 'Device deleted successfully' }

// Provisioning (201) — serial display incluso
{
  message: 'Device provisioned successfully',
  data: {
    id: "uuid",
    serialNumber: "2100280018513531",    // hex (hawkBit controllerId)
    serialDisplay: "21.00.28.00.18.51.35.31",  // dotted (frontend)
    hawkbitTargetId: "2100280018513531",
    status: "unclaimed",
    companyId: null
  }
}
```

---

## 10. Padrão: Drizzle Schema → TypeBox Schema

```typescript
// devices.ts — DB schema
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  serialNumber: text('serial_number').notNull(),
  serialDisplay: text('serial_display'),
  hawkbitTargetId: text('hawkbit_target_id'),
  status: deviceStatusEnum('status').notNull().default('pending'),
  // ...
});

// schemas.ts — Validation schema
export const ProvisionDeviceSchema = t.Object({
  serialNumber: t.String({ minLength: 1, maxLength: 64 }),
  deviceKey: t.String({ minLength: 1, maxLength: 256 }),
  name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});
```

---

## 11. Padrão: Environment Validation

```typescript
// env.ts — FONTE ÚNICA DE VERDADE para toda configuração
const EnvSchema = Type.Object({
  DATABASE_URL: Type.String(),
  HAWKBIT_ENABLED: Type.Optional(Type.Boolean({ default: false })),
  HAWKBIT_URL: Type.Optional(Type.String()),
  // ...
});

// hawkbit.ts — thin accessor tipado (ZERO process.env reads)
export const hawkbitConfig = {
  get enabled() { return env.HAWKBIT_ENABLED; },
  get baseUrl() { return env.HAWKBIT_URL; },
  // ...
};
```

**Regra**: NUNCA ler `process.env` fora de `env.ts`. Todo config flui pelo schema validado.

---

## 12. Padrão: hawkBit Bulk POST (Array Body)

```typescript
// hawkBit Management API requer array body para POSTs
await hawkbitTargets.create({
  controllerId: '2100280018513531',
  name: 'Device',
  securityToken: 'token',
});
// → Internamente envia: [{ controllerId, name, securityToken }]
// → Response: [{ controllerId, name, ... }]

// Sempre extrair arr[0] para single-item creates
const [target] = await hawkbitTargets.create(data);
```
