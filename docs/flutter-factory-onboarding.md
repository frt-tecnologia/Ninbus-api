# Flutter — Integração do Modelo Fábrica (Onboarding por Email)

Guia de integração do modelo de **onboarding por designação de email** — a fábrica (super admin) cria empresas e designa o dono por email. O cliente simplesmente se cadastra para receber acesso.

## Visão geral do modelo

```
┌─ FÁBRICA (super admin) ──────────────────────────────────────┐
│  POST /api/companies { name, ownerEmail }                    │
│  → se o usuário já existe: adiciona como owner imediatamente │
│  → se não existe: cria "designação pendente"                 │
└──────────────────────────────────────────────────────────────┘
        │ a fábrica diz ao cliente: "cadastre-se com este email"
        ▼
┌─ CLIENTE (app Flutter) ──────────────────────────────────────┐
│  POST /api/auth/sign-up/email { email, password, name }      │
│  → hook automático resolve designações pendentes             │
│  → cliente ganha a role designada (owner/operator/etc)       │
│                                                              │
│  GET /api/companies → já vê a empresa como owner             │
└──────────────────────────────────────────────────────────────┘
```

**Sem convites, sem links, sem tokens.** A fábrica decide quem tem acesso; o cliente apenas se cadastra.

## RBAC

| Papel | Nível | Quem tem |
|-------|-------|----------|
| `owner` | 4 | Dono da empresa (designado pela fábrica) |
| `admin` | 3 | Gerencia membros, exclui grupos/dispositivos |
| `operator` | 2 | Adiciona/edita dispositivos, grupos, membros de grupo |
| `viewer` | 1 | Apenas leitura |

Super admin (fábrica) bypassa TODAS as checagens — vê e gerencia tudo.

---

## Endpoints da Fábrica (super admin)

Todos exigem email em `SUPER_ADMIN_EMAILS`.

### Criar empresa + designar dono
`POST /api/companies`
```json
{ "name": "Viação Exemplo S.A.", "ownerEmail": "dono@viação.com.br" }
```
**201** → `{ "message": "...", "data": { "id": "uuid", "name": "...", ... } }`

### Visão global — todas as empresas
`GET /api/admin/companies`
**200** → `{ "data": [{ "id", "name", "status", "memberCount", "deviceCount", "pendingCount", ... }], "total": N }`

### Detalhe de qualquer empresa
`GET /api/admin/companies/:companyId`

### Suspender / reativar empresa
`PUT /api/admin/companies/:companyId/status`
```json
{ "status": "suspended" }  // ou "active"
```
> Empresa suspensa bloqueia TODAS as operações de escrita dos membros (GET permanece).

### Listar todos os usuários
`GET /api/admin/users` → `{ "data": [{ "id", "email", "name", "companyCount", "isSuperAdmin", ... }] }`

### Listar todos os dispositivos
`GET /api/admin/devices`

### Listar todas as designações pendentes
`GET /api/admin/pending-designations` → vê quais emails estão aguardando cadastro.

---

## Endpoints do Cliente (membro da empresa)

### Listar minhas empresas (com minha role)
`GET /api/companies`
**200** →
```json
{
  "data": [{ "id": "uuid", "name": "...", "status": "active", "role": "owner", ... }],
  "total": 1
}
```
> Este endpoint resolve designações pendentes como safety-net (além do hook de sign-up).

### Gerenciar membros (admin+)
- `GET /api/companies/:companyId/members` — lista membros
- `POST /api/companies/:companyId/members` — adiciona/designa por email
  ```json
  { "email": "operador@exemplo.com", "role": "operator" }
  ```
  → `{ "data": { "granted": true/false, "pending": true/false } }`
- `PUT /api/companies/:companyId/members/:userId` — altera role
- `DELETE /api/companies/:companyId/members/:userId` — remove (não pode remover último owner → 409)

### Gerenciar designações pendentes (admin+)
- `GET /api/companies/:companyId/designations` — lista pendentes
- `DELETE /api/companies/:companyId/designations/:designationId` — revoga (antes do claim)

---

## Fluxo completo no Flutter

```dart
// ═══ FÁBRICA (painel admin separado) ═══
// 1. Criar empresa para um cliente
final company = await api.post('/api/companies',
  body: {'name': 'Viação Exemplo', 'ownerEmail': 'joao@viação.com.br'},
);
// A fábrica avisa o cliente: "cadastre-se com joao@viação.com.br"

// ═══ CLIENTE (app mobile) ═══
// 2. Cliente se cadastra normalmente
await api.post('/api/auth/sign-up/email',
  body: {'email': 'joao@viação.com.br', 'password': '...', 'name': 'João'},
);

// 3. Login
final session = await api.post('/api/auth/sign-in/email',
  body: {'email': 'joao@viação.com.br', 'password': '...'},
);

// 4. Lista empresas — a Viação Exemplo já aparece como owner!
final companies = await api.get('/api/companies');
// companies.data[0].role == 'owner'

// 5. Dono adiciona operadores por email
await api.post('/api/companies/${companyId}/members',
  body: {'email': 'motorista@viação.com.br', 'role': 'operator'},
);
```

---

## Casos de borda cobertos

| Situação | Comportamento |
|----------|---------------|
| Cliente cadastra ANTES da fábrica criar empresa | Quando a fábrica criar com o email, o cliente é adicionado imediatamente (granted) |
| Cliente cadastra DEPOIS | Designação fica pendente → resolvida automaticamente no sign-up (hook) |
| Email designado em UPPER, cadastrado em lower | **Case-insensitive** — vincula normalmente |
| Fábrica designa email errado | Revoga via `DELETE /designations/:id` antes do claim |
| Remover o último owner | **409 Conflict** — protegido |
| Empresa suspensa tentando escrever | **403** "company is suspended" |
| Usuário comum (não-fábrica) criando empresa | **403 Forbidden** |
| Super admin acessando empresa alheia | **Permitido** (bypass de membership) |

---

## Tratamento de erros

| Status | Quando |
|--------|--------|
| 400 | Body inválido (sem ownerEmail, email malformado) |
| 401 | Sem sessão |
| 403 | Sem permissão (comum criando empresa, não-membro acessando, empresa suspensa escrevendo) |
| 404 | Recurso não existe |
| 409 | Tentar remover último owner |

---

## Cobertura de testes

`tests/companies.test.ts` — 23 testes cobrindo:
- FASE 1+2: factory onboarding (owner existente granted, owner pendente auto-vinculado, case-insensitive)
- Ataques: usuário comum cria empresa (403), sem ownerEmail (400), email inválido (400), sem auth (401)
- FASE 3: visão admin (listar todas)
- FASE 4: proteção último owner (409), suspensão de empresa
- Membros por email (granted vs pending), designations

`tests/categories.test.ts` e `tests/deployments.test.ts` atualizados para o novo fluxo.
