# Plano — Arc Dashboard v2: performance, CRUD, SSE e consolidação

> **Status: AGUARDANDO APROVAÇÃO — nenhuma alteração de código foi feita.**
> **Escopo desta versão: 100% DASHBOARD (`apps/dashboard`). ZERO alterações na API.**
> Itens que exigiriam a API foram movidos para a **Fase 2 — API (aprovação futura e separada)** no §8.
> Continuação de `docs/arc-adaptation-plan.md` (adaptação Arc concluída e auditada: 37 checks × 4 larguras, 0 erros de console, 0 overflow).

---

## 0. Método

Cada eixo foi verificado contra o código real (backend + camada arc-app + componentes Arc instalados) antes de propor solução. Hipótese → evidência → proposta → critério de aceite. Fases independentes; a ordem prioriza a dor declarada principal (lentidão), tudo dentro do dashboard.

---

## 1. Diagnóstico (hipóteses verificadas no código)

### H1 — Carregamento lento: listas ilimitadas + render bloqueante (CONFIRMADO)
- **Backend (fato, sem alterar agora)**: endpoints admin retornam a coleção completa (`{data: [...tudo], total}`) sem `?page&limit&search`; `admin/companies/:id/devices` enriquece cada item com firmware-status.
- **Frontend (aqui mora o que podemos consertar sem API)**:
  1. Páginas esperam `Promise.all` de 4–8 coleções e **só renderizam após a última resolver** (Guard único);
  2. `Collection` renderiza/busca/filtra/ordena/pagina sobre a coleção inteira a cada interação;
  3. Aba de detalhe de empresa busca dados de **todas as abas de uma vez**, mesmo as não visitadas;
  4. Overview faz 5–8 chamadas sobrepondo os mesmos dados (empresas, dispositivos, rollouts) sem compartilhar resultados;
  5. Navegar Companies → Empresa → Voltar refaz **todas** as requisições (zero cache).
- **Consequência**: TTI multiplicado pela requisição mais lenta; render de milhares de nós; tráfego repetido a cada navegação. O app mobile não sofre porque é escopado por empresa.

### H2 — Refresh manual (CONFIRMADO)
- A API **já expõe** os streams: `/api/companies/:companyId/sse` (viewer) e `/api/sse/global` (auth-only, todos os eventos — ideal p/ admin). O dashboard **não assina nenhum**. (Consumir um endpoint existente não é alterar a API.)

### H3 — CRUD ausente (CONFIRMADO)
- Camada arc-app só tem forms de **criação**. As rotas de mutação **já existem** na API: `PUT /companies/:id`, `PUT /devices/:id`, `PUT|DELETE /categories/:id`, `PUT|DELETE members/:userId`, `PUT|DELETE /deployments/:id`, `DELETE /firmware/:releaseId`, `DELETE /artifacts/:artifactId`. Ou seja: **lacuna 100% de UI**.

### H4 — Linhas não-clicáveis (CONFIRMADO)
- Só o nome (link) navega; a linha inteira não. No mobile, alvo de toque pequeno.

### H5 — Excesso de telas / profundidade 1 (CONFIRMADO)
- 10 rotas nível 1; `deployments`×`deployments/firmware` são o mesmo domínio; `groups` é global apesar de categoria ser conceito **de empresa**; sem breadcrumb multi-nível.

---

## 2. Eixo A — Performance de carregamento (FOCO PRINCIPAL · só dashboard)

### A1. Render progressivo (fim do bloqueio `Promise.all`)
Cada painel/aba com fetch próprio + Guard + skeleton no layout final. A página pinta o shell imediatamente; cada coleção preenche ao chegar. O primeiro paint deixa de depender da requisição mais lenta.

### A2. Páginação/rendição por janela no cliente
A `Collection` passa a **renderizar apenas a página atual** (25–50 linhas) com o componente Arc `pagination` (desktop) e scroll infinito no mobile. Busca/filtro/sort rodam sobre os dados em cache (sem refetch). O payload continua vindo completo — a limitação real de bytes-em-rede fica registrada na Fase 2 (§8) — mas o **custo de render** cai de O(N) para O(página) e as interações ficam instantâneas.

### A3. Abas lazy no detalhe de empresa
Cada aba (Dispositivos/Membros/Grupos/Configurações/Conectividade/Atividade) só busca ao ser **visitada** (ou prefetch on-hover). Hoje as 6 abas são buscadas juntas.

### A4. Overview com dados compartilhados (menos chamadas sobrepostas)
Overview deixa de fazer 5–8 chamadas independentes e passa a derivar KPIs de **2–3 coleções compartilhadas** pelo cache (A5): `companies` (já traz `deviceCount/pendingCount`), `devices` (status de conexão) e `deployments` (status). Sem duplicar as mesmas listas 3×.

### A5. Cache + revalidação (`useFetch` v2)
Cache em memória por chave (serviço+params), revalidado por: (a) foco de janela, (b) retorno de navegação (bfcache-friendly), (c) **evento SSE** (Eixo C). Navegação ida-e-volta deixa de refazer requisições.

### A6. Virtualização (condicional)
Se após A1–A3 alguma lista mantiver >100 linhas visíveis (ex.: timeline), virtualizar o range visível. Só entra se a medição mostrar necessidade.

**Meta de aceite A (com o frota atual + seed de teste no banco do docker):** primeiro paint < 1,5s; troca de aba sem espera extra; busca/sort < 300ms (dados já em cache); zero refetch ao voltar de um detalhe.
**Limite honesto declarado:** bytes por listagem continuam crescendo com a frota enquanto a paginação server-side não existir — resolvido na Fase 2 (§8), com sua aprovação.

---

## 3. Eixo B — CRUD completo (só dashboard · padrões nativos Arc)

Skill Arc (`components.md`): `inline-edit` = "Rename in place"; `hold-to-confirm` = ação destrutiva; menu de linha via `Ellipsis`/hover-card. Regras transversais:
- **Confirmação pelo servidor**: editor fecha otimista, comete após 200 do PUT; erro reverte + toast (sem estado fantasma).
- **RBAC visível**: viewer sem ações; operator edita sem excluir; admin/owner tudo (mesma hierarquia do `companyRole`).
- **Mobile**: linha inteira abre o Surface; ações no botão ⋯ e dentro do Surface — evita conflito de toque entre "abrir detalhe" e "ação destrutiva".

| Entidade | Editar (inline) | Excluir (hold-to-confirm) | Endpoint existente |
|---|---|---|---|
| Empresa | nome | excluir (owner) | `PUT /companies/:id` ✅ |
| Dispositivo | nome | unlink/desprovisionar | `PUT /devices/:id` ✅ |
| Grupo (categoria) | nome | excluir | `PUT\|DELETE /categories/:id` ✅ |
| Membro | papel (Select) | remover | `PUT\|DELETE members/:userId` ✅ |
| Convite | reenviar | revogar* | *a confirmar na rota — se ausente, fica desabilitado com tooltip "pendente de API" |
| Rollout | abortar (ação) | — | `PUT /deployments/:id` ✅ |
| Release/artefato | — | excluir | `DELETE /firmware\|/artifacts` ✅ |

---

## 4. Eixo C — SSE live updates (só dashboard · streams já existem)

- Assinar `GET /api/sse/global` (telas admin globais) e `/api/companies/:id/sse` (dentro da empresa) via EventSource `withCredentials` (cookie same-origin pelo proxy `/console/api`).
- **Revalidação seletiva**: evento `data-changed` invalida **só** a chave de cache correspondente (A5) — 1 request na coleção afetada, nunca refetch total.
- Badge de conexão no topbar ("Ao vivo" / "Reconectando…") com backoff exponencial + reconexão em foco. RefreshButton permanece como fallback.

---

## 5. Eixo D — Consolidação de telas (só dashboard)

| Antes | Depois | Ganho |
|---|---|---|
| `/deployments` + `/deployments/firmware` | `/deployments` com abas **Rollouts \| Firmware** | −1 rota; mesmo domínio |
| `/groups` (global) | aba **Grupos** em `companies/[id]`; `/groups` vira redirect | −1 rota; contexto correto |
| detalhe de rollout navega p/ fora | Surface com abas internas (Resumo \| Alvos \| Histórico) | sem perder contexto |
| filtro de auditoria por navegação | Select de empresa inline na tela | menos saltos |

Resultado: **10 → 7-8 rotas nível 1**. Breadcrumb multi-nível no PageHead (instalar `@uiarc/breadcrumb` no **dashboard**): `Empresas / {Empresa} / Dispositivos / {Serial}`.

---

## 6. Lacunas registradas (não simular, não implementar agora)

1. **Paginação/filtro server-side** nos endpoints admin → Fase 2 (§8).
2. **`GET /api/admin/overview` agregado** → Fase 2 (§8).
3. **Revogação de convite** → confirmar existência; se ausente, UI desabilitada com explicação.
4. SSE global: **sem lacuna** (existe).

---

## 7. Medição e validação

- Seed de dispositivos de teste no banco do docker (somente dados, via API existente — sem alterá-la) para medir com volume.
- Puppeteer: FCP/TTI, nº de requests e bytes por rota — antes/depois anexados.
- Regras de regressão: build/tsc/biome limpos; re-auditar rotas × 4 larguras (0 console errors, 0 overflow); CRUD testado no sucesso **e** no erro (reversão otimista); SSE validado com evento real (claim de dispositivo durante sessão aberta).
- Docker: compose up completo e drill documentado.

## 8. Fases

| Fase | Escopo | Conteúdo | Aprovação |
|---|---|---|---|
| **1 (agora)** | **100% dashboard** | A1–A6 + B (CRUD) + C (SSE) + D (consolidação) — nesta ordem de sub-entrega | **esta aprovação** |
| **2 (posterior)** | **API** | `?page&limit&search&sort` retrocompatível em `admin/devices\|companies\|users`; `GET /api/admin/overview` agregado; (se faltar) revoke de convite | **aprovação futura e separada** — plano detalhado será re-submetido antes |

A Fase 1 resolve na dashboard: paint progressivo, abas lazy, cache, rendição por página, CRUD inline/hold-to-confirm, SSE e consolidação — tudo sobre endpoints já existentes. A Fase 2 ataca o teto estrutural de escala (payload por listagem) quando você aprovar.
