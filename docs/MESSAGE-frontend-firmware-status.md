# MESSAGE — Firmware Status/Update para o Frontend (company)

Guia de integração dos endpoints que o frontend (mobile/dashboard de empresa) usa
para saber se os devices estão atualizados após uma publicação de firmware e para
disparar a atualização. Valores validados ao vivo no docker local (api:8081).

---

## 1. Autenticação (todas as rotas)

- **Cookie de sessão** Better Auth (`better-auth.session_token`, enviado
  automaticamente pelo browser) **ou** header `Authorization: Bearer <token>`
  (token vem do campo `token` da resposta de sign-in).
- `401` = não logado/sessão expirada → re-autenticar.
- `403` = logado mas sem vínculo com a empresa (ou empresa suspensa).

---

## 2. GET `/api/companies/:companyId/devices/firmware/status`

**"Quais devices da minha empresa estão desatualizados?"** — leitura DB-only
(zero chamadas hawkBit, segura para polling; ideal chamar ao abrir a tela e
após eventos SSE, não em loop agressivo).

- Method: `GET` · Role: **viewer+** · `companyId` = UUID da empresa do usuário.
- **PAGINADO** (otimizado para frotas grandes): query `?limit` (default **1000**,
  max 5000) e `?offset` (default 0). **`summary` sempre cobre a frota INTEIRA**
  (contadores corretos p/ badge); `devices` é só a página. Itere com `?offset`
  enquanto `hasMore === true`. Frota de 50k sem paginar = payload de 14 MB —
  nunca faça isso.

### Resposta `200` (TypeScript)

```ts
interface FirmwareStatusResponse {
  latest: {
    ninbus: FirmwareRelease | null;      // última release PUBLICADA firmware-ninbus
    controller: FirmwareRelease | null;  // última PUBLICADA firmware-controller
  };
  devices: DeviceFirmwareStatus[];        // PÁGINA (limit/offset) — não a frota toda
  summary: {                              // contagens da frota COMPLETA
    total: number; upToDate: number; outdated: number; unknown: number; error: number;
  };
  hasMore: boolean;                       // true → busque a próxima página (?offset += limit)
}

interface DeviceFirmwareStatus {
  deviceId: string;                       // UUID (use no POST /update)
  name: string;                           // nome de exibição
  serialDisplay: string | null;
  controllerId: string | null;            // hawkBit controllerId (serial hex)
  firmwareVersion: string | null;         // versão reportada pelo device via DDI (null = nunca)
  controllerFirmwareVersion: string | null;
  connectionStatus: string | null;        // online/offline
  hawkbitUpdateStatus: string | null;     // pending | in_sync | error | unknown
  firmwareStatus: 'up_to_date' | 'update_available' | 'unknown' | 'error' | 'no_release';
}

interface FirmwareRelease {
  id: string;                 // UUID — o "id da atualização" (só informativo; o trigger não o usa)
  name: string;
  version: string;            // ex. "4.0.1"
  artifactType: string;       // 'firmware-ninbus' | 'firmware-controller'
  status: 'draft' | 'published';  // aqui SEMPRE 'published' (draft nunca vaza p/ empresa)
  description: string | null;
  counter: number | null;     // contador anti-replay do manifesto
  payloadSize: number | null;
  packageSize: number | null;
  createdAt: string;          // ISO date-time
  // ... campos de gate/manifesto (ignoráveis no UI da empresa)
}
```

### Como o servidor classifica (`firmwareStatus`)

O servidor resolve a **latest published** por semver (`latest.ninbus`) e compara
com a versão que cada device reportou via DDI (sincronizada em
`devices.firmwareVersion`); antes disso há um refresh on-demand das versões
stale — **limitado a 100 pulls hawkBit por request** (convergência progressiva
entre chamadas + sync de background; frota em dia = zero chamadas hawkBit).

| `firmwareStatus` | Condição | O que o UI deve fazer |
|---|---|---|
| `update_available` | versão do device **<** latest publicada | exibir "atualização disponível" + botão de atualizar (POST /update) |
| `up_to_date` | versão **≥** latest | "já está atualizado" — nada a fazer |
| `unknown` | device nunca reportou versão (novo/offline) | "versão desconhecida" (pode ser incluído no trigger, com cautela) |
| `error` | `hawkbitUpdateStatus === 'error'` (último OTA falhou) | exibir falha + permitir re-tentar |
| `no_release` | **`latest.ninbus === null`** — a fábrica nunca publicou | "não há atualizações disponíveis" (estado por device quando não há latest) |

### Casos especiais

- **"Não há atualizações"** → `latest.ninbus === null` OU
  `summary.outdated === 0 && summary.error === 0` (todos up_to_date/unknown).
- `devices: []` → empresa sem devices accepted.
- O objeto `latest.ninbus` é a **fonte do id/versão da atualização** para
  exibição ("Atualizar para 4.0.1") — mas o **trigger não precisa de releaseId**.

### Erros

- `401` sem sessão · `403` não é membro/empresa suspensa. (Não há 404/503 —
  leitura é só DB.)

### Uso otimizado (REGRA DE OURO — frotas grandes)

O servidor valida até 50k devices por empresa, mas o payload é **paginado**:
`devices` é SEMPRE uma página (default 1000, máx 5000) — **nunca assuma que
`devices` é a frota completa**. Os contadores (`summary`) já vêm da frota
inteira em toda resposta.

**Padrões recomendados:**

1. **Badge/resumo da tela** → 1 chamada default (`?limit=1000` implícito) já
   basta: use `summary` + `latest.ninbus`. Ignore `devices` se só precisa do
   panorama — é a chamada mais barata (~290 KB @ 50k devices).
2. **Lista de devices no UI** → use UMA página por vez (scroll/"carregar mais"
   com `?offset += limit`). Não pré-carregue tudo.
3. **Selecionar TODOS os outdated para atualizar** → busque as páginas até
   `hasMore === false` acumulando `deviceId`s **filtrando por
   `firmwareStatus === 'update_available'`** (o `POST /update` aceita até 500
   ids por chamada — divida em lotes de 500):

```ts
// Coleta os deviceIds desatualizados paginando (respeita o contrato otimizado)
async function collectOutdated(companyId: string): Promise<string[]> {
  const LIMIT = 5000;                       // máx permitido por página
  const ids: string[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await fetch(
      `/api/companies/${companyId}/devices/firmware/status?limit=${LIMIT}&offset=${offset}`,
      { credentials: 'include' },
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const page: FirmwareStatusResponse = await res.json();
    ids.push(
      ...page.devices
        .filter((d) => d.firmwareStatus === 'update_available')
        .map((d) => d.deviceId),
    );
    offset += page.devices.length;          // avance pelo que VEIO (não pelo limit)
    hasMore = page.hasMore;
  }
  return ids;
}

// Lotes de 500 (limite do POST /update)
for (let i = 0; i < allIds.length; i += 500) {
  await triggerUpdate(companyId, allIds.slice(i, i + 500));
}
```

4. **Frescor sem spam**: o servidor atualiza versões stale de até 100 devices
   por chamada (convergência progressiva). Após um deploy, prefira refazer o
   `GET /status` quando chegar evento SSE (`device.action.status` terminal /
   `devices.batch`) em vez de polling em loop — os estados migram para
   `up_to_date` conforme os devices reportam.
5. **Offer/dedup**: se `summary.outdated === 0`, desabilite o botão de
   atualizar — não percorra páginas à toa.

---

## 3. POST `/api/companies/:companyId/devices/firmware/update`

**Atribuir a atualização aos devices.** O servidor **resolve sozinho a última
release PUBLISHED** (`firmware-ninbus`) — não envie releaseId/versão.

- Method: `POST` · Content-Type: `application/json` · Role: **operator+**
- Body (1–500 ids):

```json
{ "deviceIds": ["<uuid>", "<uuid>"] }
```

Envie os `deviceId` dos devices com `firmwareStatus === 'update_available'`
(subset recomendado; `unknown` também é aceito — o device recebe e reporta).

### Resposta `200`

```json
{
  "message": "Firmware update queued for 3 device(s)",
  "data": {
    "dsId": 49,                    // id do deployment (hawkBit DS) — referência de rastreio
    "name": "Firmware firmware-ninbus 4.0.1",
    "version": "4.0.1",            // versão efetivamente deployada
    "targetsAssigned": 3,          // targets que receberam a atribuição
    "artifactType": "firmware-ninbus",
    "smId": 21, "smName": "sm-...", // artefato servido
    "verified": 3, "failed": 0
  }
}
```

### Erros possíveis (corpo: `{ error, message, code }`)

| HTTP | `code` | Quando | Ação do frontend |
|---|---|---|---|
| 400 | `HAWKBIT_NOT_ENABLED` | backend sem hawkBit | mensagem de serviço indisponível |
| 404 | `NOT_FOUND` | nenhuma release publicada ainda; **ou nenhum deviceIds é elegível** (não é da empresa/não linked) | revalidar lista com GET /status |
| 409 | `REJECTED_ARTIFACT` | a última deployment dessa versão terminou 100% em error — devices rejeitaram o artefato (anti-replay) | não re-tentar em loop; acionar fábrica/admin (não há escape `force` na rota de empresa) |
| 503 | — | hawkBit inacessível | retry com backoff |

### ⚠️ A atribuição é ASSÍNCRONA

O `200` confirma a criação do deployment no hawkBit, **não** a instalação. O
status dos devices muda quando o sync engine rodar (~30 s; modo rápido 5 s
durante deploy ativo). Não faça polling do /status esperando flip imediato —
**assine o SSE**:

---

## 4. SSE — progresso em tempo real

`GET /api/companies/:companyId/sse` (EventSource, cookie auth, `text/event-stream`):

```ts
const es = new EventSource(`/api/companies/${companyId}/sse`);
es.addEventListener('device.action.status', (e) => {
  const d = JSON.parse(e.data); // progresso detalhado por device
});
es.addEventListener('deployment.stats', (e) => { /* agregado do deployment */ });
es.addEventListener('devices.batch', () => refetchStatus()); // ciclo de sync completo
```

- **`device.action.status`** (por device): `{ deviceId, controllerId, actionId,
  latestStatus, phase, progress, message, timestamp }`
  - `phase`: `assigned → pending → downloading → downloaded → installing → installed | error | canceled`
  - `progress`: 0–100 durante download (`null` nas demais)
  - Em `installed`/`error`/`canceled` → refetch do `/status` (device passa a
    `up_to_date` quando reporta a nova versão, ou `error`).
- **`deployment.stats`**: `{ deploymentId, summary: { totalTargets, finished,
  failed, inProgress, pending, canceled }, status }` — barra de progresso geral.
- Heartbeat a cada 30 s; reconectar em `onerror` (EventSource já reconecta).

---

## 5. Fluxo recomendado (state machine)

```
abrir tela ─▶ GET /status (1 página) ─▶ render: latest + summary (frota inteira) + página 1
      │                                        │
      │ lista longa? ─▶ "carregar mais" (offset += limit)
      │                                        │
      └─ summary.outdated > 0 → habilita "Atualizar"
                                   │
                 user confirma atualização → coletar ids update_available
                 (páginas até hasMore=false, se necessário)
                                   │
                                   ▼
              POST /update { deviceIds } (lotes ≤500) ── 200 ─▶ SSE aberto
                                   │                      │
                                   │              device.action.status → progresso
                                   │              deployment.stats     → agregado
                                   │                      │
                                   │              phase terminal ─▶ GET /status (refetch)
                                   │                      │
                                   ▼                      ▼
                        device vira up_to_date  ✅  (ou error → re-tentar p/ ele)
```

**Anti-padrões (evite):**
- Assumir `devices` = frota completa (contrato é página; use `hasMore`).
- Loop de polling do `/status` aguardando flip pós-trigger (é assíncrono → SSE).
- Buscar TODAS as páginas quando só o `summary` é necessário.
- Reenviar `deviceIds` já `up_to_date`/`error-stable` em re-trigger cego.

## 6. Notas para o console ADMIN (super admin) — endpoints relacionados

- `POST /api/admin/firmware/:releaseId/publish` / `unpublish` são **idempotentes**:
  repetir retorna `200` com `"was already published — nothing to do"` (não é erro).
  `409 GATE_FAILED` ainda pode ocorrer para downgrade real (mensagem lista o
  check falho).
- Foi corrigido o bloqueio de publicação após piloto: o device de teste na mesma
  versão da release **não** bloqueia mais o publish (igualdade ≠ downgrade).
