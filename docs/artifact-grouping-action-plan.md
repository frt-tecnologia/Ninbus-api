# Plano de Ação — Agrupamento de Artefatos (tags/grupos) como Dispositivos

> **Status:** PLANEJAMENTO — aguardando avaliação. **Nenhuma alteração feita.**
> **Objetivo:** permitir que arquivos/artefatos sejam agrupados em grupos (tags), igual aos
> dispositivos, com troca via PATCH (adicionar/trocar tags).

---

## 1. Veredito de viabilidade: ✅ VIÁVEL e SIMPLES

- hawkBit **não possui** grouping/tagging nativo de Software Module (confirmado no código).
  → Grupos de artefato são **100% locais** (DB Ninbus): **zero sync hawkBit, zero guard hawkBit**.
  → As operações de agrupamento funcionam **mesmo com hawkBit fora do ar** (ganho de resiliência vs. o GET/list de artefatos que precisa do hawkBit).
- O padrão já existe para dispositivos (`categories` + `device_category_assignments` N:N + rotas).
  → Espelhar é direto.

---

## 2. Estado atual (referência)

| Componente | Dispositivos (existe) | Artefatos (a criar) |
|---|---|---|
| Tabela de grupos | `categories` (companyId, name, type, description) | **reuso** ou nova |
| Tabela N:N | `device_category_assignments(deviceId, categoryId)` | `artifact_category_assignments(artifactId, categoryId)` |
| Rotas de atribuição | `PUT /devices/:id/categories` (replace), `POST /categories/:id/devices` (bulk) | `PATCH /artifacts/:id/categories` (+ opcional bulk) |
| hawkBit sync | categorias são locais (não sincronizadas) | locais (igual) |

---

## 3. Decisão de design (3 opções — recomendada em destaque)

### 🟢 Opção A (RECOMENDADA): Reutilizar `categories` + nova N:N isolada
- **Reuso** da tabela `categories` (já é genérica: companyId + name + type + description).
- Nova `artifact_category_assignments(artifact_id, category_id)` — **domínio isolado**.
- **Prós:** mínima infraestrutura (CRUD de categorias já existe), UX idêntica a devices, uma empresa pode ter categorias compartilhadas (ex.: "região" que aplica a devices E variantes de firmware).
- **Contras:** o `type` enum é "device-flavored" (bus_line/garage/…); atribuir "Garagem Norte" a um firmware é semanticamente estranho (mas não prejudica).

### 🟡 Opção B: Nova `artifact_tags` (domínio separado)
- Tabela `artifact_tags(companyId, name, [color], description)` + N:N.
- **Prós:** separação de domínio limpa, semântica própria de firmware.
- **Contras:** infraestrutura paralela (CRUD duplicado).

### ⚪ Opção C: Reuso + discriminador `appliesTo`
- Adicionar `appliesTo` enum ('device'|'artifact'|'both') em `categories` + N:N de artefato.
- **Prós:** uma tabela, controle explícito de escopo (evita cross-pollution).
- **Contras:** migração de enum + complexidade; queries precisam filtrar por appliesTo.

**Recomendação:** **Opção A** (reuso + N:N isolada) — menor superfície, aderente ao que já existe, e a "poluição semântica" é controlável por convenção de uso (a empresa cria categorias `custom` para firmware). Se a separação rígida for mandatória, ir para **Opção B**.

> **Pergunta para você:** prefere reusar `categories` (A) ou ter `artifact_tags` separado (B)? A decisão afeta o resto do plano.

---

## 4. Modelo de dados (assumindo Opção A)

```dbml
// NOVA tabela — espelha device_category_assignments
artifact_category_assignments {
  artifact_id  uuid  NOT NULL  -> artifacts.id     ON DELETE CASCADE
  category_id  uuid  NOT NULL  -> categories.id    ON DELETE CASCADE
  assigned_at  timestamptz DEFAULT now()
  PRIMARY KEY (artifact_id, category_id)   // composto, sem id surrogate
  INDEX (category_id)                       // lookup reverso: "artefatos do grupo X"
}
```
- FK **CASCADE** nos dois lados: deletar artefato ou categoria limpa as atribuições automaticamente.
- `artifact_id` usa o **`id` (uuid PK)** da tabela `artifacts` — não o `hawkbitSmId` (que é o int do path). O serviço resolve `hawkbitSmId → id` (igual ao `requireOwnership`).
- **1 migration nova** (gerada via `drizzle-kit generate` + skip-check idempotente no migrator).

---

## 5. API design (aderente ao padrão existente)

Rotas novas sob `/api/companies/:companyId/artifacts` (em `manage-routes.ts` ou `category-routes.ts` novo):

| Método | Path | Role | Body | Semântica |
|---|---|---|---|---|
| GET | `/:artifactId/categories` | viewer | — | lista grupos do artefato |
| **PATCH** | `/:artifactId/categories` | operator | `{ "categoryIds": [uuid…] }` | **replace total** (igual ao PUT de devices, mas verbo PATCH) |
| DELETE | `/:artifactId/categories/:categoryId` | operator | — | remove um grupo (opcional) |

**Semântica PATCH = replace idempotente** (não delta). Satisfaz "adicionar" (incluir novo no set) e "trocar" (substituir o set). É **consistente com devices** e **idempotente** (retries seguros).

> Alternativa delta (`{ add:[], remove:[] }`) é mais eficiente p/ sets grandes, mas artefatos são tipicamente dezenas → replace é suficiente e mais simples. Defer delta se surgir necessidade.

---

## 6. hawkBit: NENHUMA interação

- Grupos são locais. As rotas de agrupamento **NÃO chamam** `requireHawkbit()` nem hawkBit.
- **Isso é uma vantagem:** listar/atribuir grupos funciona com hawkBit indisponível (resiliência), e os testes (HAWKBIT_ENABLED=false) cobrem o caminho feliz integralmente.

---

## 7. Performance (o mais otimizado)

- **N:N com PK composto** (sem surrogate) = índice natural p/ "grupos do artefato X".
- **Índice em `category_id`** p/ lookup reverso ("artefatos do grupo Y").
- **Batch load no GET /artifacts**: ao listar, trazer grupos de todos os artefatos em **1 query** (`WHERE artifact_id IN (...)`), **nunca N+1**.
- Operação de assign = `DELETE` + `INSERT` em batch (idempotente); dentro de transação p/ atomicidade.
- Sem sync hawkBit → latência mínima (só DB local).

---

## 8. Registro de RISCOS antecipados + correções

| # | Risco | Prob | Correção/mitigação |
|---|---|---|---|
| R1 | **Cross-tenant**: atribuir `categoryIds` de outra empresa | alta | Filtrar `categoryIds` por `companyId` antes do INSERT (silently drop inválidos, igual ao device). Ownership check via `requireOwnership`. |
| R2 | **artifactId do path é `hawkbitSmId` (int)**, mas a N:N usa `artifacts.id` (uuid) | certa | Serviço resolve hawkbitSmId→id uma vez; reutilizar helper estilo `requireOwnership`. |
| R3 | **Mass-assignment** de campos além de categoryIds | média | Schema `t.Object({ categoryIds: t.Array(t.String({format:'uuid'})) })` — Elysia descarta extras (já validado empiricamente). |
| R4 | ** hawkBit down** não deve bloquear agrupamento | — | Rotas de grupo **não** chamam `requireHawkbit` (só DB local). |
| R5 | **Orfandade** ao deletar artefato/categoria | média | FK `ON DELETE CASCADE` nos dois lados. |
| R6 | **Audit log**: enum `activity_action` não tem `artifact.category_changed` | média | Opção 1: adicionar valor ao enum (migration). Opção 2: skip de audit na v1 (devices já logam; seguir padrão só se adicionar enum). |
| R7 | **Semantics overload** (Opção A): "Garagem" atribuída a firmware | baixa | Convenção de uso + tipos `custom`; se crítico, ir p/ Opção B/C. |
| R8 | **N+1** ao mostrar grupos na lista de artefatos | média | Batch query com `IN` (R7 da performance). |
| R9 | **PATCH replace apaga grupos não mencionados** | média | Documentar claramente; app deve enviar o set COMPLETO. Igual ao PUT de devices. |
| R10 | **Conflito concorrente** (2 operadores editando) | baixa | Replace idempotente por artefato (last-write-wins); sem lock necessário. |

---

## 9. Plano de execução (ordem, após aprovação da Opção A/B)

1. **Decisão A vs B** (sua).
2. Schema Drizzle: `artifact_category_assignments` (+ `artifact_tags` se Opção B) → `drizzle-kit generate` (tooling) → migration `0015_*`.
3. `artifacts/service.ts`: `getArtifactCategories(smId, companyId)`, `assignArtifactCategories(smId, companyId, ids)` (com filtro cross-tenant + transação).
4. `artifacts/category-routes.ts` (novo, <100 linhas): GET + PATCH + DELETE. `companyRole: viewer/operator`.
5. Montar em `app.ts`.
6. Schemas em `artifacts/schemas.ts` (`assignArtifactCategoriesSchema`).
7. `enrichSoftwareModule` (opcional): incluir `categories: []` no GET /artifacts via batch.
8. Testes (`artifacts.test.ts`): assign (happy), cross-tenant drop, 404 não-dono, GET lista, replace idempotente. **Como é só DB local, 100% testável com hawkBit off.**
9. Validar via docker (igual às fixes anteriores): PATCH assign → 200, GET → grupos, cross-tenant → 404/drop.
10. `harness_analyze` + `harness_submit`.

---

## 10. Plano de testes (garantia de não-quebrar)

- **Unit/integration (bun, hawkBit off — caminho feliz COMPLETO):** assign troca grupos; GET retorna; replace é idempotente; cross-tenant categoryIds são droppados; 404 p/ artefato de outra empresa; 400 p/ categoryIds inválido.
- **docker e2e (hawkBit on):** upload artefato → criar categoria → PATCH assign → GET confirma grupos → DELETE categoria → cascade limpa atribuição.
- **Regressão:** suite `artifacts.test.ts` + `devices.test.ts` segue verde (não mexe em nada existente).

---

## 11. Perguntas em aberto (preciso de você)

1. **Opção A (reuso `categories`) ou B (`artifact_tags` separado)?** — define o modelo.
2. **PATCH = replace total** (recomendado, = devices) **ou delta `{add,remove}`?**
3. **Audit log:** adicionar `artifact.category_changed` ao enum (migration) ou pular na v1?
4. **GET /artifacts/:id** deve embutir `categories` no response, ou só via sub-recurso `GET .../categories`? (devices usam sub-recurso separado.)

---

**Aguardando avaliação do plano (especialmente Opção A vs B e as 4 perguntas) antes de qualquer código.**
