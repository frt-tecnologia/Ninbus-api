# MESSAGE — Timeline de Conectividade para o Frontend (contrato v2)

`GET /api/companies/:companyId/devices/connections` — validado ao vivo no docker.
Mudanças: **paginado**, **estado inicial por device (`states`)**, **view=bands corrigida**
(bandas não mesclam mais gaps offline) e **timestamp do offline = deadline perdido**.

---

## 1. Contrato

```http
GET /api/companies/{companyId}/devices/connections
    ?from=...&to=...          (ISO 8601 Z; default últimas 24h; máx 90 dias)
    ?deviceId=...             (filtro por device)
    ?limit=2000&offset=0      (default 2000, máx 10000 — PÁGINA)
    ?view=events|bands        (default events)
```

```ts
interface ConnectionsResponse {
  range: { from: string; to: string };          // UTC ISO-8601 com Z (garantido)
  data: ConnectionEvent[] | SessionBand[];      // PÁGINA (view=events|bands)
  total: number;                                // eventos na janela INTEIRA
  states: { deviceId: string;                   // âncora da PRIMEIRA banda
            stateAtFrom: 'online'|'offline'|null;
            since: string|null }[];
  hasMore: boolean;                             // itere ?offset += data.length
}
interface ConnectionEvent { deviceId; deviceName; hawkbitTargetId;
  event: 'online'|'offline'; occurredAt; ipAddress }   // oldest-first
interface SessionBand  { deviceId; deviceName; start; end; ipAddress } // online sessions
```

## 2. Como desenhar a timeline (sem heurística)

1. **Primeira banda**: procure o device em `states`. `stateAtFrom='online'` →
   banda online de `from` até o primeiro evento; `'offline'` → banda offline de
   `from`; `null` → sem histórico (comece no primeiro evento).
2. **Eventos**: cada `event` alterna a banda a partir de `occurredAt`.
3. **Última banda** (aberta): feche em `to`, ou no `connectionStatus` atual do
   device (`GET /devices` / SSE `devices.batch`).
4. **view=bands** (alternativa): o servidor já devolve as sessões online prontas
   (`start`→`end`, abertas fecham em NOW) — útil para relatórios de tempo
   conectado sem computar no client.

## 3. Semântica dos timestamps (importante para relatórios)

- **online** = `lastPollAt` (o poll DDI que restabeleceu a conexão).
- **offline** = **`nextExpectedPollAt`** — o deadline que o device perdeu
  (não o último poll, não o momento da detecção). A banda offline começa no
  instante em que a conexão foi dada como perdida.
- Detecção de offline tem latência inerente de ~1 janela de polling (5 min) +
  grace de 60s (evita pares espúrios offline/online na fronteira do deadline).
- Flaps contidos num ciclo de sync (30s) não geram eventos (granularidade real
  = intervalo de polling do device). O smoothing <10min do app continua sendo
  complementar — o backend NÃO faz merge de blips.

## 4. Escala (5k devices)

- Sempre pagine (`hasMore`); `total` cobre a janela inteira (badge correto com 1 chamada).
- Timeline de um device: use `?deviceId=` (página menor, índice dedicado).
- Steady state gera ZERO writes de telemetria (transições apenas).

## 5. Vocabulário (unificado)

- `devices.connectionStatus` / SSE `s`: `connected|disconnected|unknown` (público, inalterado).
- Eventos/bandas: `online|offline`. Legados `online/offline` em `connectionStatus`
  foram normalizados (migration 0024).
