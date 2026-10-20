# Diagnóstico — Inconsistência dos status Online/Offline dos dispositivos

> **Iteração 55 · Análise somente-leitura (nenhuma alteração de código).**
> Objeto: telemetria de conexões (`device_connections`), sync engine e sweep de staleness.
> Sintoma relatado: dispositivo conectado por longo período, sem uso de interface → período sem
> registro (ou registrado como offline); registro de offline "parece certo" (vermelho nas últimas
> datas), registro de online fica incorreto.

---

## 1. TL;DR — Root cause

**O sistema não possui detector de "online" sempre ativo. A detecção de offline roda em timer
próprio (sweep a cada 10s, lendo só o banco local); a detecção de online depende de um ciclo de
sync com o hawkBit que, no modo `hybrid` (produção), só roda para empresas com sessão de usuário
ativa nos últimos 5 minutos.** Sem usuário usando a interface, a observação para; o prazo local
(`nextExpectedPollAt`) congela; o sweep marca o dispositivo como `disconnected` com um evento
**offline FALSO** (backdated ao prazo congelado); quando alguém reabre a interface, o sync lê o
hawkBit, vê o dispositivo conectado e grava um evento **online ATRASADO** datado no momento da
detecção (último poll), não no momento da reconexão. Resultado: todo o período conectado sem
observação aparece como offline/sem registro, e a banda online começa tarde demais.

Três defeitos compostos:

| ID | Defeito | Efeito |
|----|---------|--------|
| D1 | Sweep age sobre prazo local possivelmente congelado (não valida frescor do dado) | Offline **falso** ~6 min após a observação parar, mesmo com o device pollando normalmente |
| D2 | Detecção de online é gated em atividade humana (`syncActiveWindowSec=300`) | Device conectado sem observador fica invisível por horas |
| D3 | `occurredAt` de online = `lastPollAt` na hora da detecção — hawkBit só expõe o **último** poll (sem histórico) | Uma vez perdida a janela da transição, o "conectou-se às" é irrecuperável; o período online é truncado |

Dois gaps de expectativa (o que o usuário pediu vs. o que existe):

- **G1 — Logs**: transições não geram log por dispositivo. `recordConnectionTransition` só loga
  falha (debug); o sweep loga apenas contagem agregada. Nenhuma linha INFO `device X online@ts`.
- **G2 — hawkBit**: nada é escrito de volta no hawkBit (ex.: Target Attributes). Nota conceitual:
  **o hawkBit já registra cada poll** — é a própria natureza dele; o que falta é o Ninbus
  **observar** continuamente, não o hawkBit armazenar.

---

## 2. O modelo mental vs. o modelo real

O relato pressupõe sessão tipo login/logout: *"quando cada dispositivo loga e fica online e
desloga, fica offline"*. **O modelo real é poll-based:**

- Device nunca "loga" — ele **polla** o DDI (`GET /{tenant}/controller/v1/{controllerId}`) a cada
  intervalo (`HAWKBIT_POLLING_TIME`, default `00:05:00` = 5 min, empurrado ao hawkBit em runtime —
  `sync.ts:applyPollingTimeConfigRetried`).
- "Online" é **inferido**: hawkBit considera o target conectado enquanto `pollStatus.overdue=false`
  (`lastRequestAt + intervalo > agora`). Não existe evento de conexão, logout ou push.
- O único caminho público do DDI é `nginx → hawkBit` (`hb.ninbus…`) — **a API Ninbus NÃO está no
  caminho do poll**, não vê polls individuais em tempo real. Só descobre estado lendo a Management
  API (`/rest/v1/targets` → `pollStatus { lastRequestAt, nextExpectedRequestAt, overdue }`).
- A Management API **não expõe histórico de polls** — apenas o último. (Eventos por poll existiriam
  via DMF/RabbitMQ, não implantado.)

Portanto: online/offline no Ninbus é **reconstrução por amostragem**, e a qualidade do registro é
limitada por (a) a frequência de amostragem e (b) o que cada amostra consegue datar. O bug é uma
assimetria nesses dois eixos entre os dois writers.

---

## 3. Panorama — quem escreve o quê, quando (evidências por arquivo)

### Writer OFFLINE — `markOverdueDevicesOffline()` (`src/modules/devices/sync-helpers.ts`)

- Timer **próprio e sempre ligado**: `staleTimer` é criado em `sync.ts:startBackgroundSync` ANTES do
  early-return de `on_demand` — roda em qualquer modo, a cada `staleSweepSec` = **10s**
  (`hawkbit.ts:66`).
- Lê **só o banco local**: `connectionStatus IN ('connected','online') AND nextExpectedPollAt < now
  − 60s (STALE_SWEEP_GRACE_SEC)`.
- Grava evento `offline` com `occurredAt = nextExpectedPollAt` (prazo perdido — **backdating
  correto** via `transitionOccurredAt('offline', …)`).

### Writer ONLINE — `batchUpdateDevicesFromTargets()` (`src/modules/devices/sync-helpers.ts`)

- Só executa dentro de um **ciclo de sync** que leu targets do hawkBit:
  - `syncPeriodic()` — todos os targets (modo periodic).
  - `syncHybrid()` — **apenas empresas ativas**: `getActiveCompanyIds()` =
    `session.updatedAt > now − syncActiveWindowSec(300s)` (`sync-strategies.ts:29-45`). Sem sessão
    ativa → `"no active companies — skipping"` → **retorna sem olhar o hawkBit**.
  - On-demand: `GET /companies/:companyId/devices` dispara `syncCompanyDevices` bounded a 2s
    (`devices/index.ts:53`) e single-device SWR com cache 60s.
- Grava evento `online` com `occurredAt = lastPollAt` (poll mais recente **na hora da detecção**) —
  `transitionOccurredAt('online', …)` em `connections-service.ts`.

### Leitores — `connections-routes.ts` (`/connections?view=events|bands`) + `listStateAtFrom`

- Eventos brutos / bandas (LEAD window) / âncora de estado no início da janela. A UI desenha a
  timeline a partir disso; banda online aberta fecha em `NOW()`.

### Config relevante (`src/common/config/hawkbit.ts`)

| Var | Default | Papel |
|-----|---------|-------|
| `HAWKBIT_SYNC_MODE` | `hybrid` | produção: só empresas ativas recebem sync |
| `HAWKBIT_SYNC_INTERVAL_SEC` | 30 | período do ciclo de sync |
| `HAWKBIT_SYNC_ACTIVE_WINDOW_SEC` | 300 | janela de "empresa ativa" |
| `HAWKBIT_STALE_SWEEP_SEC` | 10 | período do sweep offline (sempre-on) |
| `HAWKBIT_POLLING_TIME` | 00:05:00 | intervalo de poll dos devices |

---

## 4. A sequência de falha (o sintoma relatado, decomposto)

```
T+0     Último usuário fecha o app (session.updatedAt para de andar).
        Sync hybrid ainda roda ~5 min (janela de atividade 300s) — depois: "skipping".
T+~5min Última atualização local de nextExpectedPollAt (≈ last poll + 5 min). Dado congela.
D       = prazo congelado. Device CONTINUA pollando o hawkBit a cada 5 min (hawkBit sabe:
        overdue=false), mas ninguém pergunta ao hawkBit.
D+60s   Sweep: nextExpectedPollAt < now−60s → set disconnected +
        EVENTO OFFLINE FALSO, occurredAt = D (backdated "certo" para um prazo errado).
D+60s … Horas: device conectado de verdade, registro diz offline. Sem novas transições
        locais → banda offline (ou "sem registro") cobre TODO o período conectado.
T_open  Usuário reabre a interface → GET /devices dispara sync on-demand (2s) + empresa
        volta a ser "ativa" → próximo ciclo ≤30s lê o hawkBit → connected +
        EVENTO ONLINE ATRASADO, occurredAt = lastPollAt ≈ T_open (não a reconexão real).
```

Por que o registro de offline **parece** certo: quando o device sai do ar de verdade, o sweep
sempre-on pega em ≤10s com backdating correto ao prazo perdido — independe de interface. Estável e
vermelho. ✓ (Mas note: no cenário acima os offlines também estão **errados** — são falsos; a
vermelhidão "plausível" das últimas datas mascara o erro.)

Por que o registro de online **está** errado: D1 + D2 + D3 compostos — offline falso no meio da
conexão + online datado na detecção + impossibilidade de backdate após perder a janela. Erro
médio = `T_open − D` (horas, tipicamente).

---

## 5. Solução sistemática (proposta — a implementar em iteração própria)

Princípio: **separar observação de conexão de atividade de usuário**, e dar ao online o mesmo
tratamento self-healing que o offline já tem.

### Fix 1 — Connection Watcher sempre-on (mata D2 e D1 na origem)

Novo worker leve (`connection-watcher.ts`, módulo devices) que independe de `syncActiveWindowSec`:

- A cada tick, busca **somente pollStatus** dos targets (paginado/staggered — ex.: N páginas por
  tick, rotação completa ≤ um intervalo de poll ≈ 5 min; em 50k devices ~ mesmo custo de um ciclo
  periodic, diluído). Reusa `hawkbitTargets.list` (já traz `pollStatus`).
- Aplica **apenas** campos de conexão (`connectionStatus`, `lastPollAt`, `nextExpectedPollAt`,
  `lastSeenAt`, `ipAddress`) + telemetria pelo chokepoint existente (`recordConnectionTransition`).
  `hawkbitUpdateStatus`/firmware continuam no sync normal (hybrid preservado).
- Efeitos: prazos locais sempre frescos (sweep nunca mais age sobre dado congelado); transição
  online detectada em ≤ rotação; erro de `occurredAt` online limitado a ~1 intervalo de poll
  (5 min), não horas.
- Guardas: `hawkbitConfig.enabled`; novas vars `HAWKBIT_CONNECTION_WATCHER_*` (enabled/interval/
  pageSize) via `env.ts` + `.env.example` + `.env.test`.

### Fix 2 — Guard de frescor no sweep (defesa em profundidade; mata D1 formalmente)

O sweep só pode agir sobre prazo **acionável**: `devices.updatedAt > nextExpectedPollAt` (observamos
o hawkBit DEPOIS de o prazo ter sido estabelecido/atualizado). Se nossa última observação é mais
velha que o prazo que estamos julgando, **o stale somos nós** → skip. Provavelmente elimina a
possibilidade de offline falso por construção.

- Gap aberto: órfãos (target deletado no hawkBit some do targetMap e `batchUpdate` hoje o pula —
  era o WHY original do sweep). Com o guard, o órfão precisa de regra própria no watcher:
  "ausente do hawkBit por K rotações consecutivas → disconnected" (K≥2 para não falso-offline em
  falha transitória de paginação; ou GET direto 404 antes de marcar).

### Fix 3 — Honestidade do `occurredAt` online (mitiga D3 residual)

Com rotação ≤ intervalo de poll, `lastPollAt` fica ≤5 min velho na detecção — bound documentado.
Registrar `detectedAt`/latência na linha de log (não na tabela) para observabilidade. (Backdate
perfeito da reconexão é impossível via Management API — sem histórico de polls.)

### Fix 4 — Logs estruturados por transição (atende G1)

Chokepoint único `recordConnectionTransition` passa a emitir pino INFO:

```
[CONN] event=online device=%s company=%s occurredAt=%s detectedAt=%s latencyMs=%d source=%s(sweep|sync|watcher)
```

Sweep mantém o log agregado; transições ganham linha própria — "registrar em logs" ✓.

### Fix 5 (opcional, baixa prioridade) — Write-back no hawkBit (atende G2)

Por transição, best-effort `PUT` de Target Attribute (ex.: `connectionState=online`,
`lastTransitionAt=<ts>`) — visível no inventário hawkBit. É display-sugar: o hawkBit já é a fonte
dos polls; o valor real está em Fix 1.

### Alternativa arquitetural (documentada, não recomendada agora)

Proxy do DDI **através** da API Ninbus (nginx → API → hawkBit) daria evento por poll (precisão
máxima, zero amostragem), ao custo de colocar a API no caminho crítico de poll dos devices
(latência/failure point). Guardar para escala/precisão futuras; o watcher resolve 95% por fração
do risco.

---

## 6. Minitasks & Achievements

| MT | Escopo | Achievement (verificável) |
|----|--------|---------------------------|
| **MT-1** | **Diagnóstico & panorama** (este doc) | ✅ A1.1 root cause identificado com evidência arquivo:linha · ✅ A1.2 mapa writers/readers/timers documentado |
| **MT-2** | **Connection Watcher** (Fix 1) | A2.1 rotação cobre 100% dos devices claimed em ≤ polling interval · A2.2 transição online detectada SEM uso de interface (teste c/ relógio fake + drill docker) · A2.3 zero chamadas hawkBit com `HAWKBIT_ENABLED=false` · A2.4 `occurredAt` online com erro ≤ 1 polling interval |
| **MT-3** | **Guard de frescor do sweep** (Fix 2) | A3.1 sweep NUNCA dispara com observação mais velha que o prazo (teste) · A3.2 offline-falso = 0 no drill "30 min conectado sem interface" · A3.3 órfão (target deletado) ainda curado dentro da rotação (K-misses) |
| **MT-4** | **Logs de transição** (Fix 4) | A4.1 toda transição → 1 linha INFO com device/event/occurredAt/detectedAt/source · A4.2 latência de detecção mensurável nos logs |
| **MT-5** | **Write-back hawkBit** (Fix 5, opcional) | A5.1 attribute visível no hawkBit UI após transição · A5.2 best-effort (falha não quebra sync) |
| **MT-6** | **Validação & drill ao vivo** (Fix 6) | A6.1 suíte existente verde + novos testes de regressão (falso-offline, guarda do sweep, rotação do watcher) · A6.2 drill docker documentado: device conectado 30 min sem interface → exatamente 1 banda online contínua; kill do poll → 1 offline backdated dentro de rotação+grace+sweep · A6.3 dashboard (bands + states) renderiza o período conectado corretamente |

### Critérios de aceite (contrato do usuário)

1. Device conectado N horas **sem nenhum uso de interface** → exatamente **1** evento online
   (±1 polling interval do instante real) e **0** eventos offline.
2. Device que cai **sem observador** → 1 evento offline backdated ao prazo perdido, detectado em
   ≤ rotação + grace + sweep.
3. Toda transição logada (INFO) com `occurredAt`, `detectedAt` e fonte.
4. Sem regressão na suíte atual; novos testes cobrem os cenários 1–2.

---

## 7. Notas de implementação (para a iteração de fix)

- Ordem recomendada: MT-3 (guard, barato, mata o sintoma mais grave) → MT-2 (watcher, resolve a
  raiz) → MT-4 → MT-6 → MT-5 opcional.
- `transitionOccurredAt` e o chokepoint `recordConnectionTransition` JÁ estão corretos e centralizados
  (iteração 54) — o fix não mexe neles, apenas em **quem observa e quando**.
- Novas vars de config: `env.ts` + `.env.example` + `.env.test` simultaneamente (padrão skill).
- O watcher é um 3º writer de `devices.connection_status` — manter a invariante "uma voz por
  fronteira" (o guard do sweep + grace já estabelecem isso entre sweep e hawkBit; o watcher entra
  com o MESMO veredito do hawkBit, não um terceiro critério).
