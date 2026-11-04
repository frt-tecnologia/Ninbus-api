# RBAC — Cargos e Permissões por Empresa

Como o controle de acesso funciona para membros de empresa (API + apps clientes). Plano original: `docs/rbac-roles-and-permissions-plan.md`.

## Cargos (`company_role`)

| Valor | Nome | Resumo |
|---|---|---|
| `owner` | Titular | Dono da empresa: exclusão, transferência e tudo do Gestor |
| `manager` | Gestor | Controla membros, configurações, frota e releases |
| `operator` | Operador | Opera frota e rollouts; não gerencia acesso |
| `observer` | Observador | Somente leitura |

Nomes legados `admin`/`viewer` são aceitos na entrada (alias) e normalizados para `manager`/`observer` — APIs existentes não quebram. Migration 0025 renomeou o enum in-place.

## Capabilities

Chaves estáveis usadas pela API (`src/common/auth/capabilities.ts`):

`devices.read` · `devices.write` · `devices.delete` · `groups.manage` · `members.manage` · `rollouts.create` · `rollouts.abort` · `rollouts.delete` · `releases.publish` · `releases.delete` · `company.settings` · `company.delete` · `audit.read`

### Matriz padrão (fábrica)

| Capability | owner | manager | operator | observer |
|---|:-:|:-:|:-:|:-:|
| devices.read | ✓ | ✓ | ✓ | ✓ |
| devices.write | ✓ | ✓ | ✓ | · |
| devices.delete | ✓ | ✓ | · | · |
| groups.manage | ✓ | ✓ | · | · |
| members.manage | ✓ | ✓ | · | · |
| rollouts.create | ✓ | ✓ | ✓ | · |
| rollouts.abort | ✓ | ✓ | ✓ | · |
| rollouts.delete | ✓ | ✓ | · | · |
| releases.publish | ✓ | ✓ | · | · |
| releases.delete | ✓ | ✓ | · | · |
| company.settings | ✓ | ✓ | · | · |
| company.delete | ✓ | · | · | · |
| audit.read | ✓ | ✓ | · | · |

## Overrides por empresa

Tabela `company_role_policies(company_id, role)` guarda um mapa `{capability: bool}` por cargo. Resolução: `merge(defaults[role], override[company][role])` — o override vence chave a chave; ausência de chave segue o padrão. Editável **somente por super admin** (console, aba **Permissões** da empresa).

## Uso na API

- Rota empresa-escopada com cargo mínimo: `companyRole: 'manager'` (macro em `auth-guard.ts`; hierarquia owner > manager > operator > observer).
- Rota empresa-escopada por capability: `requireCapability: 'members.manage'` — resolve membership, aplica override da empresa e retorna 403 `Missing capability` quando negado.
- Super admin (fábrica, `SUPER_ADMIN_EMAILS`) tem bypass: todas as capabilities.
- Ambas as macros exigem `:companyId` no path.

## Console (dashboard)

- Aba **Permissões** em Empresas → empresa: matriz 4×13 com tri-estado por célula (Padrão / Permitir sempre / Negar sempre) e badge de efeito efetivo.
- Endpoints (super admin): `GET/PUT /api/admin/companies/:id/role-policies`.
- Convites e mudança de cargo usam os mesmos nomes (`manager`, `observer`…).

## Apps externos (mobile)

Papel do usuário em `company_members.role`. Para saber o que pode fazer antes de chamar a API, use a matriz padrão acima; overrides por empresa são resolvidos no servidor e refletem como **403 Missing capability** — trate o 403 ocultando a ação, sem hardcode de cargos no app.
