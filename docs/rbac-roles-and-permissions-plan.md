# Plano — RBAC v2: cargos, permissões granulares, SSE seguro e limpeza de código

> **Status: AGUARDANDO APROVAÇÃO — nada foi alterado.**
> Continuação de `docs/arc-dashboard-v2-plan.md` (Fase 1 — dashboard — executada; Fase 2 API pendente).
> Este plano **absorve o item SSE** do relatório de diagnóstico e adiciona o RBAC v2.
> A paginação server-side (antiga Fase 2) continua pendente e passa a ficar **depois** deste plano.

---

## 1. Diagnóstico (fatos verificados no código)

| # | Fato | Evidência |
|---|---|---|
| D1 | Papéis fixos e hierárquicos: `owner > admin > operator > viewer` | `pgEnum company_role` em `src/common/db/schema/companies.ts:9` |
| D2 | "admin" na empresa sugere controle da plataforma (queixa central) | enum + labels do dashboard (`roleOptions`) |
| D3 | Permissões 100% por nível — sem granularidade configurável | macro `companyRole` em `auth-guard.ts` (17 arquivos usam) |
| D4 | 8 módulos com `'admin'` hardcoded | grep em `src/modules` |
| D5 | SSE global **sem** `superAdmin` + wire corrompida (chunks como JSON de bytes) | `src/modules/sse/index.ts:158` (só `auth: true`); relatório anterior |
| D6 | Comentários multi-parágrafo nos arquivos da adaptação Arc | arquivos em `apps/dashboard/src/{lib,components}` desta iteração |

---

## 2. Nomenclatura de cargos (decisão a aprovar)

Contexto: gestão de frota de dispositivos, empresas operadoras, rollouts OTA. Objetivo: nomes sugestivos, sem conotação de "controlador de tudo".

**Chave de máquina (banco/API)** e **rótulo (UI pt-BR)**:

| Atual | Proposto (chave) | Rótulo UI | Escopo |
|---|---|---|---|
| `owner` | `owner` (mantém) | **Titular** | Dono da empresa; exclusão/transferência |
| `admin` | `manager` | **Gestor** | Controla a empresa: membros, configurações, frota |
| `operator` | `operator` (mantém) | **Operador** | Opera frota e rollouts |
| `viewer` | `observer` | **Observador** | Somente leitura |
| — | `super_admin` (mantém, via `SUPER_ADMIN_EMAILS`) | **Super admin** | Plataforma/fábrica — fora da empresa |

Alternativas (se rejeitar): gestor→`supervisor` · operador→`tecnico` · observador→`leitor`.

Migração: `ALTER TYPE company_role RENAME VALUE admin→manager, viewer→observer` (PG10+; sem rebuild de tabela). Nenhum dado perdido.

## 3. Permissões granulares (configuráveis pelo super admin)

### 3.1 Capabilities (chaves estáveis)
`devices.read | devices.write | devices.delete | groups.manage | members.manage | rollouts.create | rollouts.abort | rollouts.delete | releases.publish | releases.delete | company.settings | company.delete | audit.read`

### 3.2 Matriz padrão (defaults de fábrica — documentados, imutáveis)

| Capability | owner | manager | operator | observer |
|---|---|---|---|---|
| devices.read / audit.read / connectivity | ✓ | ✓ | ✓ | ✓ |
| devices.write / groups.manage / rollouts.* | ✓ | ✓ | ✓ | — |
| members.manage / company.settings / releases.* | ✓ | ✓ | — | — |
| company.delete | ✓ | — | — | — |

### 3.3 Override por empresa (o pedido central)
Nova tabela `company_role_policies(company_id, role, permissions jsonb, updated_by, updated_at)` — **editável apenas pelo super admin** no dashboard (aba "Permissões" na empresa). Sem linha = defaults. A resolução é `merge(defaults[role], override[company][role])`.

### 3.4 API declarativa (sem if disperso)
- Macro atual vira resolução de capabilities: `requireCapability: 'devices.delete'` → 403 se ausente.
- `companyRole: 'manager'` continua aceito (compatibilidade) e equivale ao nível mínimo.
- Auditoria dos 8 módulos com `'admin'` hardcoded → migram para capability ou novo nome.

## 4. SSE seguro (absorve o diagnóstico anterior)

1. `/api/sse/global` + `superAdmin: true` — não-super recebe 403 (nunca dados de outras empresas).
2. Wire fix: handlers SSE (global e empresa) retornam `new Response(stream, { headers })` — corrige chunks como JSON-de-bytes.
3. Empresa segue com `companyRole: 'observer'` (membro + capability de leitura).
4. Testes: positivo (super recebe evento) e negativo (comum → 403 no global).

## 5. Propagação (uma mudança, todos os pontos)

| Camada | Ação |
|---|---|
| Banco | migration: 2× RENAME VALUE + tabela policies (aplicar em local, test e cloud) |
| API | enum, auth-guard/company-guard, schemas, 8 módulos, testes |
| Dashboard | `roleOptions`/labels, gating visual por capability (ações somem sem permissão), aba Permissões (super admin) |
| Mobile | app vive em repositório externo — registrar no doc `rbac-roles-and-permissions.md` as novas chaves/rótulos para o time mobile alinhar (nada para migrar aqui) |
| Docs | `docs/rbac-roles-and-permissions.md` — sucinto: cargos, matriz, como configurar overrides |

## 6. Limpeza de código (clean code)

- Passada nos arquivos desta iteração (`apps/dashboard/src` + rotas tocadas): blocos de comentário multi-parágrafo → **no máximo 1 linha por seção**; JSDoc de 1 linha apenas em exports públicos; "porquês" só onde não-óbvio.
- Documentação viva migra para `docs/` (rbac, planos) — não para comentários.
- Regra registrada como princípio da harness para próximas sessões.

## 7. Fases, ordem e aceite

| Fase | Escopo | Aceite |
|---|---|---|
| **1** | SSE: superAdmin gate + wire fix (§4) | evento chega ao browser; comum → 403 global; drill docker |
| **2** | RBAC: renome + capabilities + policies + migration (§2–3, banco+API) | suite de matriz verde (defaults, override, deny); migration aplicada nas 3 bases |
| **3** | Dashboard: aba Permissões, labels, gating visual | super edita override e reflete na hora; operador sem `devices.delete` não vê o botão |
| **4** | Mobile + docs + limpeza de comentários (§5–6) | grep sem `'admin'` de empresa; build/tsc/biome limpos; docs revisadas |

Fase 2 antiga (paginação server-side + overview agregado) **segue pendente** e entra depois.

**Riscos:** migration de enum na cloud (backup antes + rollback script); o app mobile consome as chaves via API — chaves novas saem na mesma release (doc §5 cobre o time).
