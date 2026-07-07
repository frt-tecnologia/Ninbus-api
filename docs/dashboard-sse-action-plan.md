# Plano de Ação — SSE no Dashboard (para avaliação)

Status: **PROPOSTA — não implementada**. Este documento descreve o plano para
conectar o dashboard Next.js ao stream SSE já existente no backend. Avalie antes
de prosseguir.

---

## 1. Situação atual

### Backend (PRONTO, sem mudanças necessárias)
O backend **já tem** um sistema SSE completo e funcionando (usado pelo app Flutter):

- **`src/common/sse/emitter.ts`** — singleton `sseEmitter` (conexões por empresa +
  listeners globais, heartbeat a 30s, max 50 conn/empresa, cleanup de stale).
- **Endpoints** (`src/modules/sse/index.ts`):
  - `GET /api/sse/global` — auth-only, recebe TODOS os eventos de TODAS as empresas
    (perfeito para o dashboard admin/super-admin).
  - `GET /api/companies/:id/sse` — escopo por empresa (auth + `companyRole: viewer`).
- **Eventos já emitidos** em pontos de mutação reais:
  | Evento | Quando | Origem |
  |--------|--------|--------|
  | `device.claimed` / `device.unclaimed` | claim/unclaim de device | `devices/index.ts` |
  | `device.status` | sync atualiza conexão | `sync-strategies.ts` |
  | `device.deployment` | target recebe deployment | `sync-strategies.ts` |
  | `device.action.status` | progresso detalhado (phase + progress %) | `sync-progress.ts` |
  | `deployment.stats` | estatísticas agregadas do deployment | `sync-progress-helpers.ts` |
  | `deployment.created` / `deployment.deleted` | CRUD de deployment | `deployments/index.ts`, `delete.ts` |

> **O conteúdo enviado ao dashboard será DIFERENTE do Flutter** (como o usuário
> pediu): o Flutter consome eventos por empresa para um operador; o dashboard
> (super-admin) consumirá o **stream global** e usará os eventos para
> **atualizar tabelas/KPIs/charts em tempo real**, não para detalhe de device.

### Frontend (HOJE: zero SSE)
- `rg "EventSource|text/event-stream" apps/dashboard/src` → **sem resultados**.
- A reatividade atual é por **polling indireto**: mutações chamam
  `notifyDataChanged()` → hooks refetch. Isso cobre ações PRÓPRIAS do dashboard,
  mas **não** reage a mudanças externas (device sync do hawkBit, rollout
  progredindo, outro admin agindo).
- O fix de reatividade desta iteração (inscrever `useAllDeployments` no bus)
  resolve o caso "ação minha", mas o SSE resolve o caso "mudança externa".

---

## 2. Objetivo

Dashboards (overview, deployments, devices, company detail) reagem em tempo real a:
1. Progresso de rollout (`device.action.status`, `deployment.stats`) — os charts
   se atualizam sem refresh.
2. Status de conexão de devices (`device.status`) — KPI "online" muda ao vivo.
3. CRUD de deployments (`deployment.created/deleted`) — tabela aparece/desaparece.
4. Claim/unclaim de devices — contagens atualizam.

---

## 3. Arquitetura proposta (frontend)

### Camada 1 — hook de conexão (`apps/dashboard/src/hooks/use-sse.ts`, novo, ~80 linhas)
```ts
// Abre UMA conexão global no mount do AppShell, reconecta com backoff,
// expõe um subscribe(eventType, handler). Usa a sessão cookie (same-origin).
export function useGlobalSSE(): { subscribe: (type: string, h: (d: any) => void) => () => void }
```
- Endpoint: `GET /console/api/sse/global` (via Route Handler proxy — o cookie
  `auth.session_token` viaja same-origin, igual a todo o resto do dashboard).
- `EventSource` nativo do browser (sem lib). Reconnect automático do EventSource
  + heartbeat do backend (30s) mantém vivo.
- Guarda handlers em um `Map<eventType, Set<handler>>`.

### Camada 2 — integração com o bus de dados (`data-events.ts`)
Os handlers SSE chamam `notifyDataChanged()` (o bus existente). Assim, **todos os
hooks `useFetch`/`useAllDeployments` já subscritos refetch automaticamente** —
zero mudança por página. O SSE vira uma *fonte* de eventos de mutação, igual a um
clique de botão.

```ts
// em AppShell (ou layout), uma vez:
useGlobalSSE().subscribe('deployment.created', () => notifyDataChanged());
useGlobalSSE().subscribe('deployment.stats',  () => notifyDataChanged());
useGlobalSSE().subscribe('device.status',     () => notifyDataChanged());
useGlobalSSE().subscribe('device.claimed',    () => notifyDataChanged());
// ...
```

### Camada 3 (opcional, futuro) — atualização granular sem refetch
Para charts de progresso, em vez de refetch, injetar o payload `deployment.stats`
direto no estado (atualização otimista). Evita N fetches por segundo durante um
rollout ativo. **Deixar para depois** — o bus refetch já resolve o MVP.

---

## 4. Por que o Route Handler proxy (não conexão direta)

O dashboard **nunca** chama a API externa direto do browser (cookie cross-origin
não viaja). Hoje tudo passa por `/console/api/*` (Route Handler em
`app/api/[...path]/route.ts`). O SSE seguirá o mesmo caminho: `EventSource('/console/api/sse/global')`.

**Ponto de atenção:** o Route Handler precisa fazer **streaming pass-through**
(não `await res.json()`). Verificar se o handler atual repassa o stream bruto;
se não, adicionar um caso especial para `/sse/*` que pipe o `response.body` →
`Response(stream, {headers})`. **Esta é a única mudança backend-adjacente** e
fica no proxy Next.js, não no Ninbus API.

---

## 5. Escopo de implementação (3 arquivos novos/alterados)

| Arquivo | Ação | Linhas |
|---------|-------|--------|
| `apps/dashboard/src/hooks/use-sse.ts` | **NOVO** — hook de conexão + subscribe | ~80 |
| `apps/dashboard/src/components/layout/app-shell.tsx` | **EDIT** — montar `useGlobalSSE` + subs do bus | +15 |
| `apps/dashboard/src/app/api/[...path]/route.ts` | **VERIFICAR/EDIT** — streaming pass-through p/ `/sse/*` | ~10 |

Nenhuma mudança no backend Ninbus. Nenhuma mudança nos hooks de dados (já
subscritos ao bus após o fix desta iteração).

---

## 6. Riscos & mitigações

| Risco | Mitigação |
|-------|-----------|
| Muitos refetchs durante rollout ativo (1/5s) | Throttle/debounce no `notifyDataChanged` por tipo de evento (ex.: `deployment.stats` no máx 1 refetch/3s) |
| Conexão SSE derrubada pelo nginx buffering | já há `X-Accel-Buffering: no` no header do backend; confirmar no vhost nginx |
| `EventSource` não envia headers custom | OK — SSE usa cookie same-origin (não precisa de Bearer); auth já funciona por cookie |
| SSE desabilitado (`SSE_ENABLED=false`) | hook detecta 503 e desliga graciosamente (fallback puro ao bus de mutação local) |

---

## 7. Como validar (após implementar)

1. Abrir o dashboard → Network → ver `eventsource` 200 para `/console/api/sse/global`.
2. Disparar um rollout real (ou simular via `sse/test-routes`) → KPI "Atualizações
   em andamento" e o donut de deployments mudam **sem refresh manual**.
3. Suspendê-lo via outro admin → tabela de empresas atualiza sozinha.

---

## Decisão pendente do usuário
- [ ] Aprovar a implementação (camadas 1+2, MVP com refetch via bus)?
- [ ] Ou preferir a camada 3 (atualização otimista granular) desde já?
