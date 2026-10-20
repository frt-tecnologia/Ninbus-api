# Plano — Correção na RAIZ da inferência Online/Offline (Single Observer, Single Voice)

> **Iteração 56 · Plano para APROVAÇÃO (nada implementado ainda).**
> Continuação de `docs/online-offline-inconsistency-diagnosis.md` (iteração 55).
> Pergunta do usuário: *é possível corrigir diretamente na raiz, sem adicionar mais condições,
> de forma limpa, atômica, como funcionamento base do processo?* **Resposta: sim — e a correção
> SUBTRAI mais do que adiciona.**

---

## 1. A raiz, reafirmada em uma frase

A observação do estado de conexão está **acoplada à atividade de usuário** (modo `hybrid` só
sincroniza empresas com sessão ativa há <5min) e um **segundo juiz local** (sweep de deadline)
compensa essa privação inferindo offline sobre dado congelado. A correção na raiz não é adicionar
guardas ao sweep nem um worker novo: é **devolver a observação de conexão ao processo base do
motor de sync, sempre ligada e para TODOS os devices — e deletar o segundo juiz**.

Prova de que essa é a forma correta e suficiente: **o modo `periodic` nunca teve este bug** — ele
lê `pollStatus.overdue` de todos os targets a cada ciclo e deriva conectado/desconectado de UMA
única fonte (hawkBit) com backdating correto. O bug é exclusivo da privação do `hybrid` +
sweep. A correção = universalizar o comportamento que já é correto.

## 2. Arquitetura alvo — "Single Observer, Single Voice"

```
                        ┌────────────────────────────────────────────────┐
  SEMPRE LIGADO (base)  │  Connection Pass — timer próprio (era o slot do │
  qualquer modo,        │  staleTimer), intervalo = syncIntervalSec (30s) │
  independe de usuário  │  OBSERVADOR ROTATIVO (escala por construção):   │
                        │  1. páginas/tick = f(frota) — rotação completa  │
                        │     ≤ ½ polling interval (fórmula §7, zero cfg) │
                        │  2. por tick: K páginas hawkBit + SELECT IN dos │
                        │     ids da fatia (chunks 500) — custo CONSTANTE │
                        │  3. DIFF → escreve SÓ o que mudou               │
                        │  4. transições → chokepoint ÚNICO existente     │
                        │     (recordConnectionTransition +               │
                        │      transitionOccurredAt — semântica intacta)  │
                        │  5. ausente da ROTAÇÃO COMPLETA → disconnected  │
                        │     (regra do órfão — o WHY original do sweep)  │
                        └────────────────────────────────────────────────┘
                        ┌────────────────────────────────────────────────┐
  Enriquecimento        │  Estratégias atuais INALTERADAS: periodic/hybrid│
  (mode-gated, como     │  (updateStatus, pending, action progress,       │
  hoje)                 │  fast-sync 5s, on-demand de tela)              │
                        └────────────────────────────────────────────────┘
  DELETADO              │  markOverdueDevicesOffline + STALE_SWEEP_GRACE_SEC
                        │  + staleTimer + HAWKBIT_STALE_SWEEP_SEC          │
```

**Uma voz para offline**: hawkBit `pollStatus.overdue` (computado no ato da leitura — prova: é
assim que `periodic` e o fetch por empresa funcionam hoje). O grace de 60s existia SÓ para
reconciliar as duas vozes (sweep × hawkBit) na fronteira do deadline — com uma voz, não há o que
reconciliar: **o hack some junto com o segundo juiz**.

**Latência de detecção offline**: hoje = deadline + 60s grace (sweep 10s). Depois = deadline + ≤
rotação (30s @5k / 150s @50k), `occurredAt` backdated ao deadline exato — precisão idêntica,
sem grace. Janelas de 10s NÃO são necessárias em nenhuma escala (ver §7): cadência só compra
latência de UI, nunca precisão de dado.

**Limite de precisão do online (documentado, teórico)**: `occurredAt(online)=lastPollAt` e
`lastRequestAt` nunca tem mais de 1 polling interval (5 min) enquanto o device está online → com
cadência de pass (30s) ≪ polling interval (5 min), o erro máximo do "online desde" é **≤1 polling
interval** — o mínimo alcançável por inferência poll-based sem evento por poll. (Backdate perfeito
é impossível: a Management API não expõe histórico de polls — validado na it. 55.)

## 3. Por que isso É a raiz (e não um workaround)

| Critério do usuário | Como o plano atende |
|---|---|
| "Sem adicionar mais condições" | Diff-before-write, orphan-rule e orçamento de rotação são semântica do processo base, não guards; o orçamento DERIVA de config já existente (HAWKBIT_POLLING_TIME + syncIntervalSec) — zero vars novas; **remove** grace, sweep, env var, timer e a divergência de vozes. Config final: **net-negativa**. |
| "Por default" | O pass roda em TODOS os modos sempre que `HAWKBIT_ENABLED=true` — inclusive `on_demand` (que hoje só tinha o sweep inferindo local). Sem opt-in, sem flag nova. |
| "Limpa e atômica" | 1 PR: 1 arquivo novo (~150 linhas, metade pura/testável), 3 arquivos tocados, 1 deleção de função+timer+const, 3 arquivos de config/doc. Sem migration de schema, sem mudança de API. |
| "Funcionamento base do processo" | Ocupa exatamente o slot do `staleTimer` (sync.ts:106) — o slot always-on que existia para o trabalho errado (inferir local) passa a fazer o trabalho certo (observar a fonte). |
| "Inferência do online corrigida" | Cenário do bug vira impossível por construção: não existe mais caminho em que o estado de conexão pare de ser observado enquanto o motor vive. |

## 4. Premissas VALIDADAS (evidência)

| # | Premissa | Evidência |
|---|----------|-----------|
| P1 | `pollStatus.overdue` é veredito imediato de offline no ato da leitura | `extractTargetData` (sync-core.ts) deriva `disconnected` de `overdue` — em produção no modo periodic e no fetch por empresa há iteracões |
| P2 | `GET /rest/v1/targets` paginado traz `pollStatus` completo (lastRequestAt, nextExpectedRequestAt, overdue, ip) | `fetchAllHawkBitTargets` → `extractTargetData` — mesmo caminho que o `periodic` usa hoje |
| P3 | O modo `periodic` não exibe o bug (observação always-on de todos) | Código + raciocínio da it. 55: bug exige privação de observação (hybrid) + sweep local |
| P4 | Escala da frota hoje = **5k devices** | `docs/MESSAGE-frontend-connections.md` §4 "Escala (5k devices)" |
| P5 | Semântica de `occurredAt` e chokepoint de transição já estão corretos/centralizados | Iteração 54 (unificação `transitionOccurredAt`); testes existentes (devices.test.ts:774+) permanecem válidos |
| P6 | Semântica do sweep é testada e conhecida (deadline/grace/guard unclaimed) | tests/devices.test.ts:771-847 — substituída 1:1 por testes do pass |
| P7 | hawkBit local acessível só dentro da rede docker (stack down) — drill vivo fica na Fase B | `HAWKBIT_URL=http://hawkbit:8080` (.env), docker ps vazio |

## 5. Diff atômico proposto (file-by-file)

| Arquivo | Mudança | ± |
|---------|---------|---|
| **NOVO** `src/modules/devices/connection-pass.ts` | Núcleo puro `computeConnectionChanges(fleetRows, targetMap)` → `[{device, patch, transition?}]` (diff + orphan-rule + guarda companyId) + `rotationBudget(totalTargets)` (fórmula §7) + invólucro IO `runConnectionPassTick()` (K páginas hawkBit → SELECT IN da fatia → compute → writes → SSE → cursor de rotação p/ orfanato). Núcleo puro = testável com `HAWKBIT_ENABLED=false`. | +~190 |
| `src/modules/devices/sync.ts` | Slot do `staleTimer` vira timer do pass (mesmo ponto sync.ts:106, intervalo `syncIntervalSec`); remove chamada de `markOverdueDevicesOffline` no fim do ciclo; logs de startup atualizados. | ~±20 |
| `src/modules/devices/sync-helpers.ts` | Deleta `markOverdueDevicesOffline` + `STALE_SWEEP_GRACE_SEC` (+ imports). | −~70 |
| `src/modules/devices/sync-core.ts` | `syncSingleDeviceSwr`: gate de frescor `updatedAt` → `lastSeenAt` (ver acoplamento I1). | ~5 |
| `src/common/config/hawkbit.ts` + `src/common/config/env.ts` | Remove `staleSweepSec` / `HAWKBIT_STALE_SWEEP_SEC`. **Nenhuma var nova** (cadência = `syncIntervalSec`). | −~15 |
| `.env.example` + `.env.test` | Remove a var (padrão skill: 3 lugares simultâneos). | −2 |
| `tests/devices.test.ts` | Describe do sweep → describe do pass: (a) regra `transitionOccurredAt` intacta; (b) target overdue no mapa → disconnected@deadline; (c) **regressão do bug**: target pollando + empresa inativa + ciclos rodando → 0 eventos offline, 0 writes (steady state); (d) órfão ausente do mapa → disconnected; (e) unclaimed → sem linha de telemetria (guard preservado); (f) diff: só rows mudadas são escritas. | ±80 |
| `.pi/skills/.../SKILL.md` + `docs/online-offline-inconsistency-diagnosis.md` | Seção Sync Engine: doutrina single-observer/single-voice; link do plano. | ±20 |

**Estratégias (`syncPeriodic`/`syncHybrid`), enrichments, fast-sync, on-demand de tela, SSE,
rotas e schemas: INALTERADOS.** A redundância de campos de conexão no caminho de enrichment é
inofensiva (mesma fonte, mesmo chokepoint, writes idempotentes pelo diff).

## 6. Acoplamentos e riscos endereçados

- **I1 — SWR usa `updatedAt` como frescor** (`syncSingleDeviceSwr`, sync-core.ts): com
  diff-only-write, `updatedAt` para de andar em steady state e o SWR refetchiaria hawkBit a cada
  GET de device. Correção no plano: gate passa a usar `lastSeenAt` (= `lastRequestAt`, avança a
  cada poll observado pelo pass) — sinal honesto de "dado fresco", não de "linha reescrita".
- **I2 — Órfão transitório**: página/falha parcial não deve derrubar device para offline. A
  orphan-rule só se aplica a devices ausentes de uma **rotação COMPLETA bem-sucedida** (erro em
  qualquer página → rotação marcada incompleta → nenhum veredito de ausência). Falha de fetch =
  estado preservado — sem condição nova de runtime.
- **I3 — Fast-sync (5s) durante deploys**: pass permanece a 30s (slot próprio); progresso de
  action vem do caminho de enrichment — sem regressão de UX de deploy.
- **I4 — Rollback**: revert do PR único; sem migration; estado do DB compatível nos dois sentidos
  (eventos de transição têm o mesmo formato).

## 7. Modelo de custo e escala (resposta à preocupação de eficiência computacional)

**Insight central — precisão NÃO depende de cadência alta.** Para um device online,
`lastRequestAt` nunca tem mais de 1 polling interval (5 min) de idade; para um device offline, o
`occurredAt` é backdated ao deadline exato qualquer que seja o momento da leitura. Logo, ler um
device a cada 10s, 30s ou 150s produz o MESMO dado (erro ≤ 1 polling interval); cadência menor
só compra latência de UI (quão rápido o vermelho aparece). **Janelas de 10s são desnecessárias
em nenhuma escala — o pass nunca pede 10s.**

**Observador rotativo (escala por construção, zero config nova).** O pass NÃO lê a frota
inteira a cada tick: lê K páginas por tick, com orçamento derivado de config JÁ existente:

```
páginasPorTick = ceil(totalPáginas / max(1, floor((pollingInterval/2) / syncInterval)))
                 pollingInterval = HAWKBIT_POLLING_TIME     (300s) — já existe, já empurrado ao hawkBit
                 syncInterval    = HAWKBIT_SYNC_INTERVAL_SEC (30s) — já existe
```

Rotação completa ≤ ½ polling interval em QUALQUER escala — auto-adaptativo ao crescimento da
frota, sem variável nova, sem flag.

| Métrica (por tick 30s) | @5k (hoje, P4) | @50k (alvo) | Nota |
|---|---|---|---|
| Páginas hawkBit/tick | 2 | 20 | budget = ceil(10/5) e ceil(100/5) |
| Reqs hawkBit/s (média) | ~0,07 | ~0,67 | paginado, indexado; custo/tick constante |
| Transferência | ~0,07 MB/s | ~0,67 MB/s | rede interna docker |
| Leitura DB | IN (1k ids) | IN (10k ids, chunks 500) | custo/tick constante; nunca frota inteira |
| Writes | só mudança | só mudança | online: 1 write/poll (mín. teórico); offline/idle: 0 |
| Memória | fatia | fatia | nunca a frota inteira residente |

**Contexto de carga (perspectiva)**: @50k com polling de 5 min, os PRÓPRIOS DEVICES geram
~167 req/s DDI no hawkBit. O pass adiciona ~0,67 req/s de leitura Management — ruído (~0,4%).
O gargalo não é o pass; é o tráfego dos devices (inevitável em qualquer arquitetura OTA).

**Comparativo com o custo atual**: o hybrid já faz HOJE este mesmo fetch (mesmas páginas, mesmos
campos) a cada 30s para as empresas ativas + UPDATE do sweep a cada 10s + fast-sync 5s em deploy.
O pass redistribui a mesma classe de custo de "empresas com usuário na tela" para "frota
inteira em rotação diluída", com custo por tick constante e a DELEÇÃO do timer de 10s.

**Escrita mínima teórica**: um device online inevitavelmente gera 1 write por poll observado
(avanço de lastSeenAt/nextExpectedPollAt — fato real que mudou; @50k ≈ 33 writes/s, trivial para
Postgres); device offline gera ZERO writes. Nenhum design baseado em leitura escreve menos que
os fatos que mudaram.

## 8. Protocolo de validação (Fase A/B/C)

**A — Estática**: `bun test --env-file=.env.test` (suíte existente + novos testes do pass),
`bun build`, `tsc`, `biome`.

**B — Drill vivo (docker, protocolo da it. 54)**: subir stack; simulador de device (curl DDI com
TargetToken) pollando a cada 5 min:
- **S1 (o bug)**: device conectado 30 min, ZERO uso de interface → `/connections` deve mostrar
  exatamente **1 evento online** (±1 polling interval) e **0 offline**; banda contínua até `now()`;
- **S2**: parar os polls → 1 evento offline com `occurredAt == deadline`, detectado ≤ ~ciclo;
- **S3**: deletar o target no hawkBit → órfão marcado disconnected no ciclo seguinte;
- logs do pass no docker (contagem de páginas, mudanças, transições).

**C — Fechamento**: skill + docs, conventional commits, sem push.

## 9. Critérios de aceite (contrato)

1. Device conectado N horas sem nenhum uso de interface → exatamente 1 banda online contínua,
   0 eventos offline, erro do `occurredAt` ≤ 1 polling interval (5 min).
2. Queda sem observador → 1 evento offline backdated ao deadline, detecção ≤ ~30s do vencimento
   (sem grace).
3. Suíte completa verde; testes de regressão do bug (S1) no CI.
4. Config net-negativa (nenhuma var nova; uma removida); nenhum schema/migration.
5. Escala: rotação completa da frota ≤ ½ polling interval em QUALQUER escala (fórmula
   adaptativa — @5k: 2 pág/tick; @50k: 20 pág/tick; custo por tick constante).

## 10. Ordem de execução (após aprovação)

1. `connection-pass.ts` (núcleo puro + IO) — 2. rewire do timer em `sync.ts` + delete do sweep —
3. I1 (gate SWR `lastSeenAt`) — 4. config removal — 5. testes — 6. Fase A — 7. Fase B (drill) —
8. Fase C (docs/commits).
