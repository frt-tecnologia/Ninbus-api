# Firmware — Protocolo DDI hawkBit

Guia para o firmware embarcado (ESP32) comunicar com hawkBit via DDI.

---

## Endpoint de Polling

```
GET /DEFAULT/controller/v1/{controllerId}
Authorization: TargetToken {securityToken}
```

## Respostas Possíveis

**1. Idle (sem ações):**
```json
{"config":{"polling":{"sleep":"00:05:00"}}}
```

**2. Deployment disponível:**
```json
{"config":{"polling":{"sleep":"00:05:00"}},"_links":{"deploymentBase":{"href":"...deploymentBase/{actionId}?c={hash}"}}}
```

**3. Cancelamento pendente:** ⚠️ PRIORIDADE MAIOR que deploymentBase
```json
{"config":{"polling":{"sleep":"00:05:00"}},"_links":{"cancelAction":{"href":"...cancelAction/{actionId}"}}}
```

---

## Fluxo Principal

```
POLL
├─ cancelAction?  → POST cancelFeedback → POLL novamente
├─ deploymentBase? → GET details → POST feedback "retrieved" → download → POST feedback "downloaded"
│                   → instalar → POST feedback "closed+success" → reboot (se necessário)
└─ nenhum link?   → idle, aguardar próximo poll
```

**⚠️ SEMPRE verificar `cancelAction` ANTES de `deploymentBase`.**
Se existir cancel pendente, hawkBit NÃO oferece deployment até o cancel ser confirmado.

---

## Feedback DDI — Formato OBRIGATÓRIO

```
POST /DEFAULT/controller/v1/{controllerId}/deploymentBase/{actionId}/feedback
Authorization: TargetToken {securityToken}
Content-Type: application/json
```

### Progresso (proceeding)
```json
{"id":"3","time":"2026-01-01T00:00:00Z","status":{"execution":"proceeding","result":{"finished":"none"},"details":["Downloading 50%"]}}
```

### Sucesso (closed)
```json
{"id":"3","time":"2026-01-01T00:00:00Z","status":{"execution":"closed","result":{"finished":"success"},"details":["Installed OK"]}}
```

### Falha (closed + failure)
```json
{"id":"3","time":"2026-01-01T00:00:00Z","status":{"execution":"closed","result":{"finished":"failure"},"details":["Flash error"]}}
```

### Cancel feedback (obrigatório ao receber cancelAction)
```json
{"id":"3","time":"2026-01-01T00:00:00Z","status":{"execution":"closed","result":{"finished":"success"},"details":[]}}
```

---

## ⚠️ Regras Críticas do Formato

| Regra | ❌ Errado | ✅ Correto |
|-------|----------|-----------|
| `id` | `3` (número) | `"3"` (string) |
| `details` | `[{"message":"ok"}]` | `["ok"]` |
| `time` | qualquer formato | ISO 8601 |

**Se enviado errado: hawkBit retorna 400 "request body is not well formed"**

---

## Cancel Feedback (ESP32)

```c
void handleCancelAction(const char* cancelUrl, const char* actionId) {
    char url[256];
    snprintf(url, sizeof(url), "%s/feedback", cancelUrl);
    char body[256];
    snprintf(body, sizeof(body),
        "{\"id\":\"%s\",\"time\":\"%s\",\"status\":"
        "{\"execution\":\"closed\",\"result\":{\"finished\":\"success\"},\"details\":[]}}",
        actionId, getISOTime());
    httpPost(url, body, "Authorization: TargetToken " DEVICE_KEY);
}
```

---

## Tipos de Artefato

O tipo vem em `deployment.deployment.chunks[].part`:

| Tipo | Extensão | Destino | Reboot |
|------|----------|---------|--------|
| `firmware-ninbus` | `.fir` `.bin` | NAND → STM32F407 | ✅ |
| `firmware-controller` | `.fir` `.bin` | CAN → LightDot | ❌ |
| `configuration-nfx` | `.nfx` `.frz` | NAND NFX → CAN | ❌ |

---

## Formato do deploymentBase

```json
{
  "id": 3,
  "deployment": {
    "download": "forced",
    "update": "forced",
    "chunks": [{
      "part": "configuration-nfx",
      "name": "express2",
      "version": "1.0",
      "artifacts": [{
        "filename": "express.frz",
        "hashes": {"sha256":"abc123","md5":"def456"},
        "size": 1024,
        "_links": {"download":{"href":"http://hawkbit:8080/DEFAULT/controller/v1/.../download"}}
      }]
    }]
  }
}
```

---

## Checklist do Firmware

1. **Corrigir formato do feedback** — `id` como string, `details` como array de strings
2. **Verificar `cancelAction`** antes de `deploymentBase` no poll
3. **Enviar cancel feedback** quando receber cancelAction
4. **Enviar progresso** durante download/install (retrieved → downloaded → installed)
5. **Sem feedback**, hawkBit mantém ação em "running" indefinidamente
