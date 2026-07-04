# Plano: Observabilidade & Auditoria da Dashboard Ninbus (v3 — Eventos de Transição)

> **Status:** 🚧 IMPLEMENTAÇÃO EM ANDAMENTO (backend API — Fases A/B/C CONCLUÍDAS).
> **Mudança v2 → v3 (sua sugestão):** telemetria agora é **eventos de transição
> append-only puros** (1 linha por "conectou"/"desconectou"), não janelas com UPDATE.
> Mantém riqueza de observabilidade, ganha robustez e simplifica o modelo.
> Complementa `dashboard-admin-plan.md` e `dashboard-redesign-plan.md`.
> **Princípio norteador:** tudo via API (zero acesso direto ao banco pelo front),
> visibilidade exclusiva de superadmin, UX orgânica de domínio (não genérica de IA).

---

## 0. Resumo executivo — viabilidade por requisito

| # | Requisito | Dados | UI | O que falta |
|---|---|---|---|---|
| 1 | "log: grupo criado, quem criou/editou/excluiu + infos" | 🔴 falta | 🔴 | **`activity_log`** (baixo volume) + `created_by` em `categories` + endpoint + feed |
| 2 | "dispositivos: adesão, modificação" | 🟡 parcial | 🔴 | `activity_log` registra provision/claim/unclaim/rename |
| 3 | "deployments: quem criou, p/ quais devices, certo/não" | 🟢 **existem** | 🟡 | Expor `createdBy` no enrichment + coluna + drill na UI |
| 4 | "dispositivo logou na rede + histórico de conexão" | 🔴 só `lastPollAt` | 🔴 | **`device_connections`** (eventos de transição) + captura no sync + gráfico |
| 5 | "organizar por garagem/linha/região + editar" | 🟢 **existe** (`categories` + N:N; superadmin já bypassa) | 🔴 | Só frontend + 1 endpoint agregado opcional |
| 6 | "visibilidade só superadmin" | 🟡 | — | `superAdmin: true` em endpoints novos |
| 7 | "filtros: range picker, empresa, grupos" | — | 🔴 | `TimeRangePicker` global + filtros ligados |
| 8 | "empresa: gráfico + lista + grupos + logs" | depende de #1/#4/#5 | 🔴 | Página **Company Observability** com 3 seções |

**Veredito:** tudo factível pela API. O trabalho pesado é infraestrutura de dados — modelada nesta v3 para escalar com custo mínimo.

---

## 1. ⚡ Decisão central (v3): Eventos de transição, append-only

Sua proposta: **gravar só as mudanças de estado nos dois sentidos (conectou/desconectou), nunca a cada poll.** É a modelagem correta. Refinei em relação à v2:

### 1.1 Comparação dos três modelos
| | v1 (descartada) | v2 (sessões) | **v3 (eventos de transição) ← adotada** |
|---|---|---|---|
| Quando grava | todo poll | só transição | **só transição** |
| Representação | append | 1 linha/sessão (INSERT + UPDATE p/ fechar) | **append-only puro (só INSERT)** |
| Linhas/dia (online estável, poll 60s) | ~1.440 | ~1–2 | ~2–4 |
| Resiliência a falha de sync | n/a | 🔴 sessão fica "aberta p/ sempre" se perder o offline | 🟢 cada evento é independente; nada se perde |
| Custo de query p/ o gráfico | n/a | 🟢 banda = linha direta | 🟡 banda = window fn (LEAD) — trivial |

### 1.2 Por que eventos (v3) supera sessões (v2)
1. **Append-only puro → nunca UPDATE.** Sistema de observabilidade deve ser um log
   imutável. Se um ciclo de sync cair entre um "conectou" e um "desconectou", na v2
   a sessão fica eternamente aberta (vira zumbi); na v3 cada evento é autossuficiente.
2. **Simplicidade de captura:** cada mudança detectada = 1 INSERT, sem lógica de
   "existe sessão aberta?" (elimina o lookup do partial index em cada transição).
3. **Volume ainda desprezível:** v3 ≈ 2× a v2, mas ambas ~140–300× menores que v1.
   A diferença 45M vs 90M linhas/90d é irrelevante com particionamento (poucos GB).
4. **Fidelidade à semântica:** "conectou às 14:03, desconectou às 14:47" é exatamente
   o que o operador pensa. As bandas do gráfico são *computadas* a partir dos pares.

### 1.3 Custo computacional da captura (confirmado no código)
- O sync roda periodicamente; o SELECT `getTargetIdsForCompanies()` já busca os
  devices. **Basta adicionar a coluna `connectionStatus` nesse SELECT** (o estado
  *anterior*, de graça) e comparar com o estado *novo* em `batchUpdateDevicesFromTargets`.
- Só há INSERT quando `anterior ≠ novo` (transição real). **Steady-state = 0 writes.**
- O diff é O(1) por device (comparação de string) — custo de CPU desprezível.

### 1.4 Computação das bandas (endpoint, não storage)
O gráfico precisa de bandas (online contínuo). A partir de eventos, com **1 window function**:
```sql
WITH ordered AS (
  SELECT deviceId, event, occurredAt, ipAddress,
         LEAD(occurredAt) OVER (PARTITION BY deviceId ORDER BY occurredAt) AS nextAt
  FROM device_connections
  WHERE companyId = $1 AND occurredAt BETWEEN $2 AND $3
)
SELECT deviceId, occurredAt AS start, COALESCE(nextAt, NOW()) AS end, ipAddress
FROM ordered WHERE event = 'online'
```
→ cada "online" vira uma banda; `COALESCE(nextAt, NOW())` fecha a sessão atual. Robusto
mesmo se faltar o "offline" final (termina em NOW()). Custo: só no read, indexado.

---

## 2. Outras decisões de design (mantidas/refinadas)

### 2.1 ⚖️ Gráfico: timeline de bandas (strip-plot), não scatter
Scatter cru falha (poll a cada poucos min → pontos sobrepostos). A informação útil é
"*quando esteve conectado*" (sessão). **Timeline de bandas:** cada device = faixa
horizontal (eixo y); cada sessão = banda preenchida no eixo x (tempo). Clica num
device da lista → foca a faixa. SVG próprio leve, anti-genérico, combina com `Signal`.

### 2.2 ⚖️ Modelo de auditoria: `activity_log` append-only (baixo volume → riqueza)
Captura via helper `logActivity()` nos pontos de mutação. Volume por natureza baixo
(ações humanas, dezenas/dia) → prioriza riqueza narrativa (snapshot de email/label que
sobrevivem a delete). **Retroatividade:** dados anteriores ao deploy não existem — documentado.

### 2.3 IA/UX — página de Empresa como hub de observabilidade
Ao selecionar uma empresa: **gráfico de conexão + lista de devices (clicável) → grupos → logs**.
```
┌─ Header: [Empresa ▼] [Range: 24h ▼] [Grupo ▼] [Atualizar] ─────────────────┐
├─ SEÇÃO 1 — Conectividade (signature) ──────────────────────────────────────┤
│  ┌ Timeline de bandas (SVG) ─────────┐  ┌ Lista de devices ──────────────┐ │
│  │ faixa/device, banda=sessão        │  │ ordenado por "visto por último"│ │
│  │ clica device → foca faixa         │  │ clicável → foca o gráfico      │ │
│  │ eixo x = tempo (range selecionado)│  │                                │ │
│  └───────────────────────────────────┘  └────────────────────────────────┘ │
├─ SEÇÃO 2 — Grupos (garagem/linha/região) — cards por tipo, editar ──────────┤
├─ SEÇÃO 3 — Logs de atividade (auditoria) — timeline filtrável ──────────────┤
```
`TimeRangePicker` **global** (RangeContext) → mudou o range, tudo re-busca. Sidebar mantida.

---

## 3. Otimização de volume & custo (ponderação que você pediu)

### 3.1 Estimativa de crescimento (100k devices, ~5 sessões/dia, retenção 90d)
| Tabela | Linhas/dia | Linhas/90d | Tamanho aprox. | Veredito |
|---|---|---|---|---|
| `device_connections` (v3) | ~1M | ~90M | ~6–7 GB (c/ índices) | **sustentável** |
| `device_connections` (v1 descartada) | ~144M | ~13 bilhões | ~1 TB+ | inviável |
| `activity_log` | ~centenas | ~dezenas de milhares | <100 MB | irrelevante |

→ ~140× menos volume que v1; retenção de 90 dias barata.

### 3.2 Tipos de dados compactos (menos bytes = menos I/O = menos CPU)
- **`bigserial`** (8B) p/ IDs internos das tabelas de telemetria (vs uuid 16B).
- **`inet`** p/ IP (valida + otimiza range query).
- **`timestamptz`** p/ timestamps (sem ambiguidade de fuso).
- **enums nativos Postgres** (4B) p/ `action`/`entityType`/`event` (vs varchar).
- `event` só `'online'|'offline'` (2 valores) — pode ser boolean implícito, mas enum é mais legível.

### 3.3 Índices cirúrgicos (só queries quentes)
- `device_connections`: `(companyId, occurredAt DESC)` → gráfico por empresa no range.
- `device_connections`: `(deviceId, occurredAt DESC)` → histórico de um device.
- `activity_log`: `(companyId, createdAt DESC)` → feed por empresa (cursor); `(entityType, createdAt DESC)`.
- **Nenhum redundante** (cada um custa 1 write de manutenção).

### 3.4 Particionamento + retenção barata
- `device_connections` particionada **por mês** (occurredAt). Retenção = **DROP PARTITION**
  inteira (O(1)) quando `occurredAt < now − retenção`. Config por env:
  `OBS_CONNECTIONS_RETENTION_DAYS` (default 90).
- `activity_log`: **não expira** (auditoria). Cresce devagar (baixo volume).

### 3.5 Agregação server-side (evita afogar o cliente)
- **range ≤ 7d:** `view=session` → bandas brutas por device (poucas linhas: só transições).
- **range > 7d:** `view=aggregate` → bucket temporal (ex.: 1h) com `count(*)` de eventos
  online ativos → dezenas de pontos, não milhões. Visão de tendência.
- Auto-select no endpoint conforme `from`/`to` (overridable).

### 3.6 Custo do write path
- **`logActivity()`:** INSERT indexado (<1ms), `await` direto (baixo volume não justifica queue).
- **Captura de conexão:** 1 INSERT só quando `anterior ≠ novo`; nenhum I/O por device estável.

---

## 4. Arquitetura técnica (API-first, sem acesso direto ao banco)

### 4.1 Novas tabelas (Drizzle) — migration `0012_observability.sql`

**`activity_log`** (append-only, baixo volume → riqueza):
```ts
activityLog = pgTable('activity_log', {
  id: bigserial('id').primaryKey(),
  actorUserId: text → user.id (ON DELETE SET NULL),
  actorEmail: text,                                   // snapshot (sobrevive a delete — é auditoria)
  companyId: uuid → companies (ON DELETE CASCADE),
  action: activityActionEnum,    // enum: 'category.created' | 'device.provisioned' | ...
  entityType: activityEntityEnum,// enum: 'company'|'category'|'device'|'deployment'|'artifact'|'member'|'designation'
  entityId: text,                // string (acomoda int/uuid)
  entityLabel: text,             // snapshot legível (nome/serial) — sobrevive a delete
  metadata: jsonb DEFAULT '{}',  // só extras variáveis; jsonb comprime (TOAST)
  ipAddress: inet('ip_address'),
  createdAt: timestamptz NOT NULL DEFAULT NOW(),
})
// índices: (companyId, createdAt DESC), (entityType, createdAt DESC), (actorUserId)
```

**`device_connections`** (eventos de transição, alto volume → compressão) —
**PARTICIONADA por mês**, append-only puro (só INSERT):
```ts
deviceConnections = pgTable('device_connections', {
  id: bigserial('id').primaryKey(),
  deviceId: uuid → devices (ON DELETE CASCADE),
  companyId: uuid → companies (ON DELETE CASCADE),
  hawkbitTargetId: text,         // controllerId (snapshot)
  deviceName: text,              // snapshot (sobrevive a rename)
  event: connectionEventEnum,    // enum: 'online' | 'offline'  ← só mudança de estado
  occurredAt: timestamptz NOT NULL,
  ipAddress: inet('ip_address'),
  recordedAt: timestamptz NOT NULL DEFAULT NOW(),
})
// índices: (companyId, occurredAt DESC), (deviceId, occurredAt DESC)
// Particionamento: por mês em occurredAt; retenção via DROP PARTITION.
// NUNCA UPDATE — append-only. Bandas computadas no read via LEAD().
```

**Ajustes de schema existente (mesma migration):**
```sql
ALTER TABLE companies  ADD COLUMN created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE categories ADD COLUMN created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL;
-- companies.createCompany() passa a gravar created_by (hoje descarta o campo).
```

### 4.2 Novo módulo API: `src/modules/observability/` (superadmin)
Containerização (cada arquivo < 250 linhas, schemas em `schemas.ts`):
```
src/modules/observability/
├── index.ts                     // rotas admin (todas superAdmin: true)
├── schemas.ts                   // response/query schemas (t.Date(), enums)
├── activity-service.ts          // logActivity() + listActivity() (filtros + cursor)
├── connections-service.ts       // recordConnectionTransition() + listSessions()/aggregate()
└── category-aggregate-service.ts// categorias cross-company c/ deviceCount
```

**Helper de auditoria** (`activity-service.ts`):
```ts
export async function logActivity(entry: {
  actorUserId: string | null; actorEmail: string | null;
  companyId: string | null; action: ActivityAction;
  entityType: ActivityEntity; entityId: string; entityLabel?: string;
  metadata?: Record<string, unknown>; ipAddress?: string;
}): Promise<void>  // best-effort (try/catch; erro de log NUNCA quebra a mutação)
```

**Helper de conexão** (`connections-service.ts`) — chamado no sync só quando há transição:
```ts
export async function recordConnectionTransition(device: {
  deviceId: string; companyId: string; hawkbitTargetId: string; deviceName: string;
  previous: string; current: string; ipAddress: string | null;
}): Promise<void>  // se previous === current → não faz nada (guarda no caller).
// previous='offline' & current='online' → INSERT event='online' occurredAt=lastPollAt
// previous='online' & current='offline' → INSERT event='offline' occurredAt=now
```

**Endpoints novos (todos `superAdmin: true`, prefix `/api/admin`):**

| Método | Rota | Retorna | Filtros (query) |
|---|---|---|---|
| GET | `/api/admin/activity` | `{ data: ActivityLogEntry[], total, hasMore }` | `companyId?`, `entityType?`, `action?`, `actorUserId?`, `from?`, `to?`, `limit?`, `before?` (cursor) |
| GET | `/api/admin/devices/connections` | `view=session`: bandas · `view=aggregate`: count por bucket | `companyId?`, `deviceId?`, `categoryId?`, `from`, `to`, `view=session\|aggregate\|auto` |
| GET | `/api/admin/categories` | `{ data: AggregatedCategory[] }` (com `deviceCount`) | `companyId?`, `type?` |

**Pontos de injeção de `logActivity()` (mutações existentes):**
companies create/update/delete/suspend · categories CRUD · members add/role/remove ·
designations · devices provision/deprovision/claim/unclaim/rename · deployments create/delete ·
artifacts upload/delete.

**Ponto de injeção de `recordConnectionTransition()`:**
1. `getTargetIdsForCompanies()` (sync-strategies.ts): **adicionar coluna `connectionStatus`**
   ao SELECT (o estado *anterior*, de graça).
2. `batchUpdateDevicesFromTargets()` (sync-helpers.ts): comparar `anterior` (do SELECT)
   com `current` (do hawkBit); se diferente → `recordConnectionTransition()`.

### 4.3 Exposição de `createdBy` em deployments (ajuste mínimo)
`enrichment.ts`: `LocalDeploymentRecord` + `EnrichedDeployment` ganham
`createdBy`/`creatorEmail` (join com `user`). → UI mostra "criado por".

### 4.4 Frontend — novos componentes (containerização, sobre `system/*`)
```
apps/dashboard/src/
├── components/
│   ├── system/time-range-picker.tsx          # RangeContext global (presets + custom)
│   ├── domain/observability/
│   │   ├── company-observability.tsx         # CONTAINER: 3 seções + filtros
│   │   ├── connection-timeline.tsx           # SVG bandas (signature)
│   │   ├── device-connection-list.tsx        # lista lateral clicável (visto por último)
│   │   ├── activity-feed.tsx                 # timeline de logs
│   │   ├── group-organizer.tsx              # cards garagem/linha/região + editar
│   │   └── observability-filters.tsx         # empresa + grupo + range (slots no Toolbar)
│   └── domain/devices/device-category-editor.tsx  # atribuir grupo a um device
├── lib/api/observability.ts                  # activity(), connections(), aggregatedCategories()
└── app/(admin)/companies/{page.tsx,[id]/page.tsx}  # lista + modo observabilidade
```
Container vs presentacional: `company-observability`/hooks = client (fetch);
timeline/feed/organizer = props-in, render determinístico.

---

## 5. VISÃO GERAL COMPLETA DA IMPLEMENTAÇÃO (overview)

Esta seção é o mapa-múmia do trabalho. **Cada fase é independente, testável e
commitável isoladamente.** Nenhuma fase depende de UI pronta para ser validada.

### Mapa de dependências
```
A (dados) ─┬─► B (instrumentação) ─► C (endpoints) ─┬─► D (gráfico + range) ─► E (página empresa)
           │                                       │
           └─► (schemas Drizzle)                   └─► F (drill + editor de grupos) ─► G (retenção + docs)
```

### 5.1 FASE A — Fundação de dados (API) · destrava tudo
**Objetivo:** criar tabelas e services isolados. Sem tocar rotas existentes ainda.
- **A1.** Migration `0012_observability.sql`:
  - `activity_log` (com enums `activity_action`, `activity_entity`).
  - `device_connections` (enum `connection_event`) **particionada por mês** (occurredAt).
  - `ALTER companies/categories ADD created_by`.
  - Função/rotina auxiliar p/ criar partições mensais (ou documentar o cron manual).
- **A2.** Schemas Drizzle: `src/common/db/schema/observability.ts` + export em `schema/index.ts`.
- **A3.** Aplicar migration nos 3 DBs (dev, teste, cloud); verificar colunas em
  `information_schema.columns` (princípio do projeto). Confirmar partição ativa.
- **A4.** `observability/activity-service.ts`: `logActivity()` + `listActivity()` (filtros + cursor).
- **A5.** `observability/connections-service.ts`:
  - `recordConnectionTransition()` (INSERT só em transição).
  - `listSessions(companyId, range, {view})` → bandas via LEAD(); `aggregate()` p/ range longo.
- **A6.** `observability/category-aggregate-service.ts`: categorias cross-company + deviceCount.
- **Checkpoint:** `bun build` limpo; teste unitário dos services (mock DB) verde.

### 5.2 FASE B — Instrumentação (API) · preenche as tabelas
**Objetivo:** as mutações reais começam a gerar auditoria; o sync começa a gerar conexões.
- **B1.** Injetar `logActivity()` nos pontos de mutação (lista no §4.2). Best-effort (try/catch).
- **B2.** `companies.createCompany()` passa a gravar `created_by` (corrigir o descarte).
- **B3.** Captura de conexão:
  - `getTargetIdsForCompanies()`: adicionar `connectionStatus` ao SELECT.
  - `batchUpdateDevicesFromTargets()`: diff `anterior` vs `current`; se ≠ → `recordConnectionTransition()`.
  - Guard `hawkbitConfig.enabled` implícito (sync não roda desabilitado).
- **B4.** Expor `createdBy`/`creatorEmail` no enrichment de deployments (§4.3).
- **Checkpoint:** criar categoria/deployment → vê linha em `activity_log`; transição
  online↔offline → vê linhas em `device_connections`. Steady-state não gera writes.

### 5.3 FASE C — Endpoints admin (API) · superadmin-only
**Objetivo:** expor os dados ao front, com filtros e isolamento de tenant.
- **C1.** `observability/schemas.ts`: `ActivityLogSchema`, `DeviceConnectionSchema`,
  `AggregatedCategorySchema`, query/params schemas (todos com `t.Date()`).
- **C2.** `observability/index.ts`: rotas `GET /activity`, `/devices/connections`, `/categories`
  — todas `{ auth:true, superAdmin:true }`.
- **C3.** Registrar módulo em `app.ts`.
- **C4.** Testes de integração: superAdmin libera (200); comum → 403; filtros por
  empresa/tempo/tipo; `view=aggregate` em range longo; **isolamento cross-tenant em connections**.
- **Checkpoint:** `/docs` mostra os 3 endpoints; `bun test` verde.

### 5.4 FASE D — UI: fundação de filtros + gráfico (signature)
**Objetivo:** o componente-chave (timeline de bandas) + range picker reutilizável.
- **D1.** `system/time-range-picker.tsx` + `RangeContext` (presets: 1h/24h/7d/30d + custom).
- **D2.** `domain/observability/connection-timeline.tsx`: SVG de bandas, foco por device,
  estados vazio/loading/error, aria-label por faixa.
- **D3.** `lib/api/observability.ts`: client services (`activity()`, `connections()`, `aggregatedCategories()`).
- **Checkpoint:** gráfico renderiza com mock; range controla eixo x e resolução (session vs aggregate).

### 5.5 FASE E — UI: página Empresa observabilidade (pedido central)
**Objetivo:** o fluxo completo "seleciona empresa → vê conectividade + devices + grupos + logs".
- **E1.** `device-connection-list.tsx`: lista lateral ordenada por "visto por último", clicável → foca faixa.
- **E2.** `activity-feed.tsx`: timeline de logs (`Signal` + `Id` + `Time` + metadata).
- **E3.** `group-organizer.tsx`: cards por tipo (garagem/linha/região); expande devices; editar via API.
- **E4.** `company-observability.tsx`: container que orquestra as 3 seções + filtros (RangeContext).
- **E5.** Wire na rota `companies`: seleção → modo observabilidade, mantendo a listagem flat acessível.
- **Checkpoint:** fluxo end-to-end no browser (range re-busca tudo; clique em device foca; edição de grupo persiste).

### 5.6 FASE F — UI: aprimoramentos de domínio
**Objetivo:** fechar os requisitos de grupos e drill de deployments.
- **F1.** `device-category-editor.tsx`: atribuir garagem/linha/região a um device (via API existente).
- **F2.** Deployments: coluna "criado por" + drill-in status-trail por device (abre timeline).
- **F3.** Overview: time range global aplicado aos rollups (opcional).
- **Checkpoint:** edição de grupos funciona em qualquer página; deployments mostram autor + drill.

### 5.7 FASE G — Retenção, config, docs, QA
**Objetivo:** deixar pronto p/ produção com escala.
- **G1.** Job/rota de retenção de `device_connections` (DROP PARTITION mensal); helper
  `createFuturePartitions()` para não quebrar no virar do mês.
- **G2.** Env vars em `env.ts` + `.env.example` + `.env.test`:
  `OBS_CONNECTIONS_RETENTION_DAYS` (90), `OBS_AGGREGATE_THRESHOLD_DAYS` (7). Nenhum `process.env` fora de `env.ts`.
- **G3.** SKILL.md + README + este plano marcados IMPLEMENTADO.
- **G4.** QA responsivo (mobile colapsa faixas em cards) + a11y (aria no gráfico/lista).
- **Checkpoint:** pronto para validação Docker (3 containers healthy, fluxo `/admin`).

### 5.8 Entregáveis por fase (resumo de artefatos)
| Fase | Arquivos novos/alterados | Testes |
|---|---|---|
| A | migration, `db/schema/observability.ts`, 3 services | unit (services) |
| B | mutação em ~10 arquivos de rota, sync-strategies, sync-helpers, enrichment | integração de captura |
| C | `observability/{index,schemas}.ts`, `app.ts` | 403/200, filtros, tenant |
| D | `time-range-picker.tsx`, `connection-timeline.tsx`, `lib/api/observability.ts` | — (UI mock) |
| E | 5 componentes domain/observability, `companies/[id]/page.tsx` | — (manual) |
| F | `device-category-editor.tsx`, deployment-table+drill | — (manual) |
| G | retention job, env (3 arquivos), docs | retenção |

---

## 6. Testes & validação (critérios de conclusão)
- **API:** superAdmin acessa os 3 endpoints; comum → 403; filtros corretos; connections
  respeita tenant; `view=aggregate` em range longo retorna buckets.
- **Volume/escala (assertiva):** steady-state online gera **0** writes em connections
  (teste: 1 device online por 3 ciclos de sync = 1 INSERT "online", 0 adicionais).
- **Robustez append-only:** simular falha de sync entre online e offline → evento "offline"
  posterior ainda é registrado (não fica sessão zumbi).
- **Auditoria:** criar categoria → feed com autor + entidade + metadata; excluir →
  registro de delete; retroatividade ausente documentada.
- **Conexão:** transição online↔offline gera 1 linha cada; endpoint retorna bandas no
  range; gráfico foca device ao clicar na lista.
- **UI:** range picker re-busca todas as seções; edição de grupos persiste via API;
  deploy mostra criador; drill status-trail abre timeline por device.
- **Build:** `bun build` limpo; `bun test` verde; `next build` ok.
- **Docker:** 3 containers healthy; fluxo end-to-end pela rota `/admin`.

## 7. Riscos & mitigações
| Risco | Mitigação |
|---|---|
| Volume de telemetria em escala | eventos só em transição (~140× menor que v1) + particionamento + retenção DROP PARTITION. |
| Eventos "online" órfãos (sem "offline" posterior) | `COALESCE(nextAt, NOW())` fecha a banda em NOW() — sem zumbis. |
| Virada de mês sem partição | helper `createFuturePartitions()` (G1) + job antecipado. |
| `logActivity()` falhar e quebrar mutação | Best-effort (try/catch), loga, nunca propaga. |
| Histórico antigo inexistente | Documentado — feed/sessões começam no deploy. |
| Query de bandas pesada em range longo | `view=aggregate` (bucket temporal) → dezenas de pontos. |
| Manutenção do SVG próprio | Componente isolado, props tipadas, testável; sem dep pesada. |

## 8. Decisões que preciso da sua aprovação antes de começar
1. **Modelo de telemetria:** confirmar **`device_connections` (eventos de transição
   append-only: conectou/desconectou)** — sua sugestão adotada? (§1)
2. **Gráfico:** confirma **timeline de bandas** (meu julgamento, §2.1) ou prefere scatter/heatmap?
3. **Resolução adaptativa:** aprova `view=session` p/ range curto e `view=aggregate`
   p/ longo (auto)? (§3.5)
4. **Retenção:** confirma **90 dias** default p/ `device_connections` (config) e
   **`activity_log` sem expiração**?
5. **Retroatividade:** ciente de que feed/sessões **começam no deploy** (sem histórico anterior)?
6. **Layout Empresa:** aprova as **3 seções** + range picker global? Mantém sidebar?
7. **Ordem & MVP:** começo pela **FASE A (dados)**, MVP = **A→E**, deixando **F+G** na sequência?

> Assim que responder (principalmente #1), inicio pela **FASE A** — migration + schemas,
> **sem commit**, com checkpoint e sua revisão ao fim de cada fase.
