# 📱 Mensagem para o Agente Flutter — Sincronização de Estado OTA

> **Assunto**: Backend atualizado — SSE em tempo real + APIs de status OTA + Modelo de dados
> **Data**: 2026-05-21
> **Versão do backend**: 2.0.0 (hawkBit DDI spec v2)

---

## 1. Visão Geral da Arquitetura

```
┌──────────┐  SSE (W3C)  ┌──────────┐  REST/Basic  ┌──────────┐  DDI/Token  ┌──────────┐
│  Flutter │ ◄────────── │ Backend  │ ◄──────────► │ hawkBit  │ ◄────────── │ Firmware │
│    UI    │  push events │  (API)   │  Management  │  Server  │  Device poll│  (Ninbus)│
└──────────┘              └──────────┘              └──────────┘              └──────────┘
     │                         │
     │    GET /api/...         │
     └── pull on demand ◄─────┘
```

**Dois mecanismos de sincronização:**

1. **SSE (push)** — Backend empurra eventos em tempo real. Flutter NÃO precisa polling.
2. **REST (pull)** — Flutter busca dados sob demanda (abrir tela, refresh manual).

---

## 2. Conexão SSE — Como Conectar

```
GET /api/companies/{companyId}/sse
Cookie: auth.session_token={sessionCookie}
```

**Flutter:**
```dart
// Usando o pacote eventsource_client ou equivalente
final eventSource = EventSource(
  uri: Uri.parse('$baseUrl/api/companies/$companyId/sse'),
  headers: {'Cookie': 'auth.session_token=$sessionToken'},
);

eventSource.stream.listen((event) {
  // event.event = tipo do evento (string)
  // event.data = JSON payload
  handleSseEvent(event.event, jsonDecode(event.data));
});
```

**Formato W3C SSE (cada evento):**
```
id: 42
event: device.status
data: {"deviceId":"abc","connectionStatus":"connected","hawkbitUpdateStatus":"pending",...}

```

---

## 3. Dicionário Completo de Eventos SSE

### 3.1 `device.status` — Status do dispositivo atualizado

**Quando:** A cada ciclo de sincronização (30s) quando dados mudam.

```json
{
  "deviceId": "uuid-do-device",
  "connectionStatus": "connected | disconnected",
  "hawkbitUpdateStatus": "unknown | in_sync | pending | registered | error",
  "lastPollAt": "2026-05-21T14:30:00.000Z",
  "ipAddress": "192.168.1.100"
}
```

**Ação Flutter:** Atualizar card do device na lista. Se `hawkbitUpdateStatus = "pending"`, mostrar badge de "Atualização pendente".

---

### 3.2 `device.deployment` — Dispositivo com deployment ativo

**Quando:** Sync detecta `hawkbitUpdateStatus = "pending"` (tem DS atribuído, aguardando poll do device).

```json
{
  "deviceId": "uuid-do-device",
  "controllerId": "255FFFFFFFFFFFF",
  "status": "pending",
  "message": "Update pending — waiting for device poll",
  "timestamp": "2026-05-21T14:30:00.000Z"
}
```

**Ação Flutter:** Se o device está maximizado na tela, buscar status detalhado via GET (seção 5).

---

### 3.3 `device.claimed` — Dispositivo reivindicado por uma empresa

```json
{
  "deviceId": "uuid-do-device",
  "action": "claimed"
}
```

**Ação Flutter:** Remover da lista de "unclaimed". Adicionar à lista de devices da empresa.

---

### 3.4 `device.unclaimed` — Dispositivo removido da empresa

```json
{
  "deviceId": "uuid-do-device",
  "action": "unclaimed"
}
```

**Ação Flutter:** Remover da lista de devices da empresa. O dispositivo continua existindo no hawkBit.

---

### 3.5 `deployment.created` — Novo deployment criado

```json
{
  "deploymentId": 5,
  "name": "Atualização NFX v2.1",
  "artifactType": "configuration-nfx"
}
```

**Ação Flutter:** Adicionar à lista de deployments. Mostrar notificação "Nova atualização criada".

---

### 3.6 `deployment.deleted` — Deployment deletado/parado

**Quando:** Admin deleta um deployment via DELETE /deployments/:id.

```json
{
  "deploymentId": 5,
  "timestamp": "2026-05-21T14:30:00.000Z"
}
```

**Ação Flutter:** Remover da lista de deployments. Limpar status de atualização pendente dos devices afetados (eles recebem `device.status` com `hawkbitUpdateStatus: "in_sync"` automaticamente junto com este evento).

---

### 3.6 `devices.batch` — Lote de devices atualizados

```json
{
  "count": 15
}
```

**Ação Flutter:** Recarregar lista de devices (pelo menos os visíveis).

---

### 3.7 `heartbeat` — Keep-alive (a cada 30s)

```json
{
  "timestamp": "2026-05-21T14:30:30.000Z"
}
```

**Ação Flutter:** Nenhuma ação necessária. Usado para detectar conexão ativa.

---

### 3.8 `connected` — Conexão SSE estabelecida

```json
{
  "companyId": "uuid-da-empresa",
  "timestamp": "2026-05-21T14:30:00.000Z"
}
```

**Ação Flutter:** Marcar como "conectado em tempo real".

---

### 3.9 `device.action.status` — Progresso detalhado do deployment (NOVO)

**Quando:** Durante deploys ativos, a cada sync cycle (5s em fast sync). Pushado para devices com `hawkbitUpdateStatus = "pending"`.

```json
{
  "deviceId": "uuid-do-device",
  "controllerId": "255FFFFFFFFFFFF",
  "actionId": 42,
  "latestStatus": "running",
  "phase": "downloading",
  "progress": 50,
  "message": "downloading 50%",
  "timestamp": "2026-06-11T14:30:00.000Z"
}
```

**Campos:**

| Campo | Tipo | Descrição |
|-------|------|----------|
| `deviceId` | uuid | ID do device |
| `controllerId` | string | hawkBit target ID (serial hex) |
| `actionId` | number | hawkBit action ID |
| `latestStatus` | string | Último hawkBit status type (running, download, finished, error...) |
| `phase` | string | **Campo principal para UI** — fase semântica do deployment |
| `progress` | number | null | Progresso de download (0-100). `null` fora de downloading |
| `message` | string | Mensagem do device para exibição |
| `timestamp` | ISO string | Quando o status foi reportado |

**Phase values:** `assigned` → `pending` → `downloading` → `downloaded` → `installing` → `installed` / `error` / `canceled`

**Ação Flutter:** Atualizar barra de progresso e phase no card do device. Quando `phase` mudar para `installed` ou `error`, mostrar resultado final.

---

### 3.10 `deployment.stats` — Estatísticas agregadas do deployment (NOVO)

**Quando:** Durante deploys ativos, junto com `device.action.status`.

```json
{
  "deploymentId": 5,
  "summary": {
    "totalTargets": 10,
    "finished": 7,
    "failed": 0,
    "inProgress": 2,
    "pending": 1,
    "canceled": 0
  },
  "status": "in_progress"
}
```

**Ação Flutter:** Atualizar card do deployment na lista. Mostrar barra de progresso geral (finished/totalTargets).

---

## 4. Modelo de Dados do Dispositivo

### 4.1 Device (GET /api/companies/{companyId}/devices)

```json
{
  "id": "uuid",
  "companyId": "uuid",
  "hawkbitTargetId": "255FFFFFFFFFFFF",
  "name": "Ninbus 255FFFFFFFFFFFF",
  "serialNumber": "255FFFFFFFFFFFF",
  "serialDisplay": "25.5F.FF.FF.FF.FF.FF.FF",
  "status": "accepted",
  "lastSeenAt": "2026-05-21T14:30:00.000Z",
  "connectionStatus": "connected",
  "hawkbitUpdateStatus": "in_sync",
  "ipAddress": "192.168.1.100",
  "lastPollAt": "2026-05-21T14:30:00.000Z",
  "nextExpectedPollAt": "2026-05-21T14:35:00.000Z",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-05-21T14:30:00.000Z"
}
```

### 4.2 Status do Dispositivo — Enum Values

| Campo | Valores | Significado |
|-------|---------|-------------|
| `status` | `unclaimed` | Sem empresa (disponível para claim) |
| | `pending` | Aguardando link hawkBit |
| | `accepted` | Ativo e operacional |
| `connectionStatus` | `unknown` | Sem dados de poll |
| | `connected` | Poll em dia (não overdue) |
| | `disconnected` | Poll overdue |
| `hawkbitUpdateStatus` | `unknown` | Sem info |
| | `in_sync` | Sem deployment pendente |
| | `pending` | **Deployment ativo — aguardando device poll** |
| | `registered` | Target registrado |
| | `error` | Erro no deployment |

> **IMPORTANTE:** Quando `hawkbitUpdateStatus = "pending"`, o device TEM um deployment ativo. Use as APIs de trail (seção 5) para mostrar progresso detalhado.

---

## 5. APIs de Status Detalhado (pull on demand)

### 5.1 Lista de deployments

```
GET /api/companies/{companyId}/deployments
```

```json
{
  "data": [
    {
      "id": 5,
      "name": "ds-abc123",
      "version": "v-1716300000000",
      "type": "ninbus-configuration-nfx",
      "typeName": "Ninbus Configuração NFX",
      "description": "Atualização NFX v2.1 | artifact: sm-xyz (configuration-nfx) | uuid: abc123",
      "createdAt": 1716300000000,
      "lastModifiedAt": 1716300060000,
      "status": "in_progress",
      "statistics": {
        "totalTargets": 10,
        "finished": 7,
        "failed": 0,
        "inProgress": 2,
        "pending": 1,
        "canceled": 0
      },
      "dsMetadata": {
        "locked": false,
        "complete": true,
        "valid": true
      }
    }
  ],
  "total": 1
}
```

### 4.2 Deployment status values

| `status` | Significado | Cor sugerida |
|----------|-------------|--------------|
| `pending` | Aguardando device poll | 🟡 Amarelo |
| `in_progress` | Devices baixando/instalando | 🔵 Azul |
| `completed` | Todos os devices terminaram com sucesso | 🟢 Verde |
| `failed` | Pelo menos um device falhou | 🔴 Vermelho |
| `canceled` | Deployment cancelado | ⚪ Cinza |
| `no_targets` | Sem devices atribuídos | ⚪ Cinza |

---

### 5.2 Target Statuses — Status por device dentro de um deployment

```
GET /api/companies/{companyId}/deployments/{deploymentId}/target-statuses
```

```json
{
  "data": [
    {
      "controllerId": "255FFFFFFFFFFFF",
      "name": "Ninbus 255FFFFFFFFFFFF",
      "updateStatus": "pending",
      "action": {
        "id": 42,
        "type": "update",
        "active": true,
        "status": "running",
        "createdAt": 1716300030000,
        "phase": "downloading",
        "progress": 50,
        "message": "downloading 50%"
      }
    },
    {
      "controllerId": "AA55FFFFFFFFFFFF",
      "name": "Ninbus AA55FFFFFFFFFFFF",
      "updateStatus": "in_sync",
      "action": null
    }
  ],
  "total": 2
}
```

> **`action` pode ser `null`** — significa que o target foi assignado ao DS mas nunca teve uma ação criada, ou a ação foi force-closeada. Tratar como "sem status disponível".

### 5.3 Phase values (o campo `phase`)

| Phase | Significado | Ícone | Cor | Progresso |
|-------|-------------|-------|-----|-----------|
| `assigned` | Ação criada, aguardando device | ⏳ | Cinza | `null` |
| `retrieved` | Device fez poll, vai começar | 📡 | Azul claro | `null` |
| `downloading` | Baixando artifact | ⬇️ | Azul | `0-100` |
| `downloaded` | Download completo | ✅ | Azul escuro | `100` |
| `installing` | Instalando no controller | 🔧 | Laranja | `null` |
| `success` | Instalado com sucesso | ✅ | Verde | `null` |
| `error` | Falha na instalação | ❌ | Vermelho | `null` |
| `canceled` | Cancelado pelo servidor | 🚫 | Cinza | `null` |
| `unknown` | Sem dados | ❓ | Cinza | `null` |

> **`progress`** só é preenchido durante `phase = "downloading"` (valores: 25, 50, 75, 100). Em todas as outras phases, é `null`.

---

### 5.4 Status Trail — Timeline completa de um device

```
GET /api/companies/{companyId}/deployments/{deploymentId}/targets/{controllerId}/status-trail
```

```json
{
  "data": {
    "controllerId": "255FFFFFFFFFFFF",
    "name": "Ninbus 255FFFFFFFFFFFF",
    "actionId": 42,
    "actionType": "update",
    "actionStatus": "running",
    "active": true,
    "phase": "installing",
    "progress": null,
    "currentMessage": "installing NFX to controller",
    "trail": [
      {
        "id": 1,
        "type": "running",
        "messages": ["Assignment initiated by admin"],
        "reportedAt": 1716300030000,
        "progress": null,
        "phase": "assigned",
        "displayMessage": "Assignment initiated by admin"
      },
      {
        "id": 2,
        "type": "retrieved",
        "messages": ["Target retrieved update action"],
        "reportedAt": 1716300100000,
        "progress": null,
        "phase": "retrieved",
        "displayMessage": "Target retrieved update action"
      },
      {
        "id": 3,
        "type": "running",
        "messages": ["deployment started"],
        "reportedAt": 1716300105000,
        "progress": null,
        "phase": "installing",
        "displayMessage": "deployment started"
      },
      {
        "id": 4,
        "type": "download",
        "messages": ["downloading artifact"],
        "reportedAt": 1716300110000,
        "progress": null,
        "phase": "downloading",
        "displayMessage": "downloading artifact"
      },
      {
        "id": 5,
        "type": "download",
        "messages": ["downloading 25%"],
        "reportedAt": 1716300200000,
        "progress": 25,
        "phase": "downloading",
        "displayMessage": "downloading 25%"
      },
      {
        "id": 6,
        "type": "download",
        "messages": ["downloading 50%"],
        "reportedAt": 1716300300000,
        "progress": 50,
        "phase": "downloading",
        "displayMessage": "downloading 50%"
      },
      {
        "id": 7,
        "type": "download",
        "messages": ["downloading 75%"],
        "reportedAt": 1716300400000,
        "progress": 75,
        "phase": "downloading",
        "displayMessage": "downloading 75%"
      },
      {
        "id": 8,
        "type": "download",
        "messages": ["downloading 100%"],
        "reportedAt": 1716300500000,
        "progress": 100,
        "phase": "downloading",
        "displayMessage": "downloading 100%"
      },
      {
        "id": 9,
        "type": "downloaded",
        "messages": ["download complete"],
        "reportedAt": 1716300510000,
        "progress": 100,
        "phase": "downloaded",
        "displayMessage": "download complete"
      },
      {
        "id": 10,
        "type": "running",
        "messages": ["processing artifact"],
        "reportedAt": 1716300520000,
        "progress": null,
        "phase": "installing",
        "displayMessage": "processing artifact"
      },
      {
        "id": 11,
        "type": "running",
        "messages": ["installing NFX to controller"],
        "reportedAt": 1716300530000,
        "progress": null,
        "phase": "installing",
        "displayMessage": "installing NFX to controller"
      },
      {
        "id": 12,
        "type": "running",
        "messages": ["NFX staged, rebooting to apply to controller"],
        "reportedAt": 1716300600000,
        "progress": null,
        "phase": "installing",
        "displayMessage": "NFX staged, rebooting to apply to controller"
      },
      {
        "id": 13,
        "type": "finished",
        "messages": ["installed successfully, controller verified OK"],
        "reportedAt": 1716300900000,
        "progress": null,
        "phase": "success",
        "displayMessage": "installed successfully, controller verified OK"
      }
    ]
  }
}
```

### 5.5 Fluxo de erro — trail com falha

Quando falha, o último entry tem `type: "error"` e `phase: "error"`:

```json
{
  "id": 8,
  "type": "error",
  "messages": ["E004: controller decompression failed, config invalid"],
  "reportedAt": 1716300900000,
  "progress": null,
  "phase": "error",
  "displayMessage": "E004: controller decompression failed, config invalid"
}
```

### 5.6 Mensagens de erro possíveis

| `displayMessage` | Causa | Texto UI |
|---|---|---|
| `"download failed"` | Download falhou após 3 tentativas | "Falha no download" |
| `"artifact processing failed"` | Erro ao processar tar | "Falha ao processar artefato" |
| `"NFX install failed"` | Falha no envio CAN | "Falha na instalação" |
| `"unknown artifact type"` | Tipo não reconhecido | "Tipo de artefato desconhecido" |
| `"E004: controller decompression failed, config invalid"` | Controller não descomprimiu | "Erro E004: controlador falhou" |
| `"controller unreachable after NFX install"` | Controller não respondeu | "Controlador inacessível" |
| `"NFX configuration could not be verified after reboot"` | Verificação pós-reboot falhou | "Verificação pós-instalação falhou" |

---

## 6. Estratégia de Sincronização Flutter

### 6.1 Quando atualizar o quê

| Gatilho | Buscar | Atualizar |
|---------|--------|-----------|
| SSE `device.status` | Nada (dados já vêm no evento) | Card do device na lista |
| SSE `device.deployment` | GET `target-statuses` se tela aberta | Painel de deployment do device |
| SSE `device.action.status` | Nada (dados já vêm no evento) | **Barra de progresso + phase do device** |
| SSE `deployment.stats` | Nada (dados já vêm no evento) | **Card do deployment na lista** |
| SSE `deployment.deleted` | Remover da lista de deployments |
| SSE `deployment.created` | GET `deployments` | Lista de deployments |
| SSE `devices.batch` | GET `devices` | Lista completa de devices |
| Abrir tela de device | GET `devices/{id}` + GET `status-trail` | Tela de detalhe |
| Abrir tela de deployment | GET `deployments/{id}` + GET `target-statuses` | Tela de deployment |
| Pull-to-refresh | GET endpoints relevantes | Tela atual |

### 6.2 Polling Inteligente (recomendado)

```dart
// NÃO fazer polling de jeito nenhum!
// SSE já pusha em tempo real (a cada ~30s).
// Só buscar via GET quando:
// 1. Tela abre (first load)
// 2. SSE indica mudança (device.deployment com pending)
// 3. Pull-to-refresh manual
// 4. App volta de background (verificar conexão SSE)
```

### 6.3 Fluxo recomendado para a tela de device maximizado

```
1. Device list → SSE device.status → atualiza card
2. Device maximizado → GET status-trail → mostra timeline
3. SSE device.deployment → GET status-trail → atualiza timeline
4. Timeline mostra: phase + progress (barra) + displayMessage
```

### 6.4 Fluxo recomendado para a tela de deployment

```
1. Deployment list → GET deployments → lista com status/statistics
2. Deployment maximizado → GET target-statuses → grid de devices com phase
3. SSE `deployment.deleted` → remover da lista, limpar status dos devices
4. SSE `deployment.created` → GET `deployments` → atualiza lista
4. Clicar em device → GET status-trail → timeline detalhada
```

---

## 7. Labels UX — Todas as Línguas

### 7.1 Phase labels

```json
{
  "pt": {
    "phase_assigned": "Atribuído — aguardando dispositivo",
    "phase_retrieved": "Recebido pelo dispositivo",
    "phase_downloading": "Baixando atualização",
    "phase_downloaded": "Download concluído",
    "phase_installing": "Instalando no controlador",
    "phase_success": "Instalado com sucesso",
    "phase_error": "Falha na instalação",
    "phase_canceled": "Cancelado",
    "phase_unknown": "Status desconhecido"
  },
  "en": {
    "phase_assigned": "Assigned — waiting for device",
    "phase_retrieved": "Received by device",
    "phase_downloading": "Downloading update",
    "phase_downloaded": "Download complete",
    "phase_installing": "Installing to controller",
    "phase_success": "Installed successfully",
    "phase_error": "Installation failed",
    "phase_canceled": "Canceled",
    "phase_unknown": "Unknown status"
  },
  "es": {
    "phase_assigned": "Asignado — esperando dispositivo",
    "phase_retrieved": "Recibido por el dispositivo",
    "phase_downloading": "Descargando actualización",
    "phase_downloaded": "Descarga completa",
    "phase_installing": "Instalando en el controlador",
    "phase_success": "Instalado con éxito",
    "phase_error": "Falló la instalación",
    "phase_canceled": "Cancelado",
    "phase_unknown": "Estado desconocido"
  }
}
```

### 7.2 Deployment status labels

```json
{
  "pt": {
    "deploy_pending": "Pendente — aguardando dispositivos",
    "deploy_in_progress": "Em andamento",
    "deploy_completed": "Concluído com sucesso",
    "deploy_failed": "Falhou",
    "deploy_canceled": "Cancelado",
    "deploy_no_targets": "Sem dispositivos"
  },
  "en": {
    "deploy_pending": "Pending — waiting for devices",
    "deploy_in_progress": "In progress",
    "deploy_completed": "Completed successfully",
    "deploy_failed": "Failed",
    "deploy_canceled": "Canceled",
    "deploy_no_targets": "No devices"
  },
  "es": {
    "deploy_pending": "Pendiente — esperando dispositivos",
    "deploy_in_progress": "En progreso",
    "deploy_completed": "Completado con éxito",
    "deploy_failed": "Falló",
    "deploy_canceled": "Cancelado",
    "deploy_no_targets": "Sin dispositivos"
  }
}
```

### 7.3 Error message labels

```json
{
  "pt": {
    "err_download_failed": "Falha no download",
    "err_artifact_processing": "Falha ao processar artefato",
    "err_nfx_install": "Falha na instalação NFX",
    "err_unknown_type": "Tipo de artefato desconhecido",
    "err_e004": "Erro E004: controlador falhou na descompressão",
    "err_unreachable": "Controlador inacessível após instalação",
    "err_verification": "Verificação pós-instalação falhou"
  },
  "en": {
    "err_download_failed": "Download failed",
    "err_artifact_processing": "Artifact processing failed",
    "err_nfx_install": "NFX install failed",
    "err_unknown_type": "Unknown artifact type",
    "err_e004": "E004: controller decompression failed",
    "err_unreachable": "Controller unreachable after install",
    "err_verification": "Post-install verification failed"
  },
  "es": {
    "err_download_failed": "Falló la descarga",
    "err_artifact_processing": "Falló el procesamiento del artefacto",
    "err_nfx_install": "Falló la instalación NFX",
    "err_unknown_type": "Tipo de artefacto desconocido",
    "err_e004": "E004: falló la descompresión del controlador",
    "err_unreachable": "Controlador inaccesible después de instalar",
    "err_verification": "Falló la verificación post-instalación"
  }
}
```

---

## 8. Exemplos de UI — Wireframe Textual

### 8.1 Card de Device na Lista

```
┌──────────────────────────────────────────────┐
│ 🟢  Ninbus 255FFFFFFFFFFFF                   │
│     25.5F.FF.FF.FF.FF.FF.FF                  │
│     Último poll: há 30s   IP: 192.168.1.100  │
│     📦 Atualização pendente                   │  ← hawkbitUpdateStatus = "pending"
└──────────────────────────────────────────────┘
```

### 8.2 Device Maximizado — Com Deployment Ativo

```
┌─────────────────────────────────────────────────────┐
│  🟢 Ninbus 255FFFFFFFFFFFF                         │
│  Status: Conectado | Último poll: há 5s             │
│                                                     │
│  ┌─ Atualização OTA ──────────────────────────────┐ │
│  │                                                  │ │
│  │  Phase: Instalando no controlador                │ │
│  │  [████████████████░░░░░░░░░░░░░░] N/A            │ │ ← progress = null
│  │                                                  │ │
│  │  Timeline:                                       │ │
│  │  ✅ 14:30:30  Atribuído                          │ │
│  │  ✅ 14:31:00  Recebido pelo dispositivo          │ │
│  │  ✅ 14:31:05  Deployment iniciado                │ │
│  │  ✅ 14:31:10  Baixando artefato                  │ │
│  │  ✅ 14:32:00  Download 25%                       │ │
│  │  ✅ 14:33:00  Download 50%                       │ │
│  │  ✅ 14:34:00  Download 75%                       │ │
│  │  ✅ 14:35:00  Download 100%                      │ │
│  │  ✅ 14:35:10  Download concluído                 │ │
│  │  ✅ 14:35:20  Processando artefato               │ │
│  │  🔵 14:35:30  Instalando NFX no controlador      │ │ ← current
│  │  ⏳           Aguardando reboot...                │ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 8.3 Device Maximizado — Sucesso

```
│  │  Timeline:                                       │ │
│  │  ✅ ...  (todos os passos acima)                 │ │
│  │  ✅ 14:40:00  Instalado com sucesso              │ │ ← phase = "success"
│  │         Controller verificado OK                 │ │
│  └──────────────────────────────────────────────────┘ │
```

### 8.4 Device Maximizado — Erro

```
│  │  Timeline:                                       │ │
│  │  ✅ ...  (download + install)                     │ │
│  │  ❌ 14:40:00  Erro E004: controlador falhou       │ │ ← phase = "error"
│  │         na descompressão                          │ │
│  └──────────────────────────────────────────────────┘ │
```

### 8.5 Tela de Deployment — Grid de Targets

```
┌──────────────────────────────────────────────────────┐
│  Deployment #5: Atualização NFX v2.1                 │
│  Tipo: Configuração NFX | Status: Em andamento       │
│  Progresso: 7/10 concluídos                          │
│                                                      │
│  ┌─ Targets ──────────────────────────────────────┐  │
│  │                                                  │ │
│  │  ✅ 255FFFFFFFFFFFF  success                     │ │
│  │  ✅ AA55FFFFFFFFFFFF  success                    │ │
│  │  🔵 11BBFFFFFFFFFFFF  downloading (50%)          │ │ ← phase + progress
│  │  🔵 22CCFFFFFFFFFFFF  installing                 │ │
│  │  ⏳ 33DDFFFFFFFFFFFF  assigned                   │ │
│  │  ❌ 44EEFFFFFFFFFFFF  error                      │ │
│  │  ✅ 55FFFFFFFFFFFF01  success                    │ │
│  │  ✅ 55FFFFFFFFFFFF02  success                    │ │
│  │  ✅ 55FFFFFFFFFFFF03  success                    │ │
│  │  ✅ 55FFFFFFFFFFFF04  success                    │ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## 9. Resumo das Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/companies/{id}/sse` | **SSE stream** (tempo real) |
| GET | `/api/companies/{id}/devices` | Lista de devices |
| GET | `/api/companies/{id}/devices/{id}` | Detalhe do device |
| GET | `/api/companies/{id}/devices/{id}/actions` | Ações do device |
| GET | `/api/companies/{id}/devices/{id}/ddi-check` | Diagnóstico DDI |
| GET | `/api/companies/{id}/deployments` | Lista de deployments |
| GET | `/api/companies/{id}/deployments/{id}` | Detalhe do deployment |
| GET | `/api/companies/{id}/deployments/{id}/statistics` | Estatísticas |
| GET | `/api/companies/{id}/deployments/{id}/target-statuses` | Status por target |
| GET | `/api/companies/{id}/deployments/{id}/targets/{cid}/status-trail` | Timeline completa |
| GET | `/api/companies/{id}/deployments/{id}/ddi-check/{cid}` | Diagnóstico DDI |
| POST | `/api/companies/{id}/deployments` | Criar deployment |
| DELETE | `/api/companies/{id}/deployments/{id}` | Deletar deployment |
| DELETE | `/api/companies/{id}/deployments/{id}/targets/{cid}/actions/{aid}` | Cancelar ação |

---

## 10. Regras de Ouro

1. **Nunca fazer polling** — SSE já pusha mudanças em tempo real (a cada ~30s do sync cycle, ou ~5s durante deploy ativo)
2. **GET só ao abrir tela ou quando SSE indicar** — não refluxar dados que não mudaram
3. **`action: null` é normal** — target assignado ao DS mas sem ação ativa = aguardando
4. **`progress` só durante download** — nas outras phases é `null`, não mostrar barra
5. **`phase` é o campo principal** — sempre usar `phase` (não `type`) para o estado visual
6. **`type = "finished"` = sucesso SEMPRE** — erro é `type = "error"`, nunca `type = "finished"`
7. **Reconexão SSE** — se `heartbeat` parar de vir por >60s, reconectar
8. **`reportedAt` é epoch ms** — converter com `DateTime.fromMillisecondsSinceEpoch`

---

*Documento para o Flutter agent — sincronizar com o backend Ninbus API v2.0.0.*
