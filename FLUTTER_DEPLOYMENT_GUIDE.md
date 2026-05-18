# Flutter — Guia de Deployments

Integração do app Flutter com a API Ninbus para gerenciar deployments OTA.

---

## Fluxo Completo

```
1. Upload artefato   → POST /artifacts
2. Criar deployment  → POST /deployments
3. Monitorar         → GET /deployments (status inline)
4. Ver dispositivos   → GET /deployments/:id/targets
5. Cancelar por device → DELETE .../targets/:t/actions/:a
6. Deletar deployment  → DELETE /deployments/:id
```

---

## 1. Upload Firmware

```http
POST /api/companies/{cid}/artifacts/
Content-Type: multipart/form-data

file: <binary>  artifactName: "fw-3.3.0"  artifactType: "firmware-ninbus"
version: "3.3.0"  (opcional)
```

**201:** `{ "data": { "smId": 42, "name": "fw-3.3.0", "size": 262144 } }`
**409:** Nome+versão já existe.

---

## 2. Criar Deployment

```http
POST /api/companies/{cid}/deployments/
{ "name": "Atualização Q3", "artifactName": "fw-3.3.0", "artifactType": "firmware-ninbus", "allDevices": true }
```

Alvos (escolha UM): `"deviceIds": [...]` | `"categoryIds": [...]` | `"allDevices": true`

**201:** `{ "data": { "dsId": 15, "name": "Atualização Q3", "targetsAssigned": 25 } }`
**422:** Artefato não encontrado. Faça upload primeiro.

---

## 3. Listar Deployments (com status real)

```http
GET /api/companies/{cid}/deployments/
```

```json
{
  "data": [{
    "id": 15, "name": "ds-uuid...", "version": "v-1747132000000",
    "type": "ninbus-configuration-nfx", "typeName": "Ninbus Configuração NFX",
    "status": "in_progress",
    "statistics": { "totalTargets": 1, "finished": 0, "inProgress": 1, "pending": 0, "failed": 0, "canceled": 0 },
    "dsMetadata": { "locked": true, "complete": true, "valid": true }
  }],
  "total": 1
}
```

### Campo `status` — Status REAL

| Status | Significado | Cor |
|--------|-------------|-----|
| `pending` | Atribuído, dispositivo não consultou | 🔵 |
| `in_progress` | Baixando ou instalando | 🟡 |
| `completed` | Todos finalizaram com sucesso | 🟢 |
| `failed` | Pelo menos um erro | 🔴 |
| `canceled` | Todos cancelados | 🟠 |
| `no_targets` | Sem dispositivos | ⚪ |

**⚠️ `dsMetadata.complete` NÃO é status de deployment.** Use `status`.

---

## 4. Detalhes + Estatísticas

```http
GET /api/companies/{cid}/deployments/:id            # mesmo formato do item
GET /api/companies/{cid}/deployments/:id/statistics  # { raw, summary, status }
GET /api/companies/{cid}/deployments/:id/targets     # dispositivos
```

** hawkBit → status mapping:**
`RUNNING`→pending · `RETRIEVED/DOWNLOAD/DOWNLOADED`→in_progress · `FINISHED`→completed · `ERROR/WARNING`→failed · `CANCELED/CANCELING`→canceled

---

## 5. Ações por Device

```http
GET  /api/companies/{cid}/deployments/devices/:deviceId/actions
```

```json
{ "data": [{ "id": 101, "type": "update", "active": true, "status": "retrieved" }], "total": 1 }
```

### Histórico de status
```http
GET /deployments/:id/targets/:t/actions/:a/status
```

---

## 6. Cancelar / Deletar

```http
# Cancelar por device (ação individual)
DELETE /api/companies/{cid}/deployments/:id/targets/:t/actions/:a

# Deletar deployment inteiro (cancela ações ativas + remove DS)
DELETE /api/companies/{cid}/deployments/:id
```

---

## 7. Artefatos

```http
GET  /artifacts/          # Listar (com size + hashes)
GET  /artifacts/types     # Tipos: firmware-ninbus, firmware-controller, configuration-nfx
GET  /artifacts/:id       # Detalhes
POST /artifacts/          # Upload (multipart, 409 se duplicado)
```

---

## Estratégia de Monitoramento

1. Polling `GET /deployments/` a cada 5-10s
2. Usar `status` (não `dsMetadata`) para estado real
3. Progresso = `statistics.finished / statistics.totalTargets * 100`
4. Parar polling quando terminal: `completed` / `failed` / `canceled` / `no_targets`

### Erros

| HTTP | Ação |
|------|------|
| 409 | Nome+versão duplicado → pedir outro |
| 422 | Artefato não encontrado → upload primeiro |
| 502/503 | hawkBit indisponível → retry |

---

## Rotas Resumo

| Rota | Método | Descrição |
|------|--------|-----------|
| `/artifacts/` | POST | Upload |
| `/artifacts/` | GET | Listar |
| `/artifacts/types` | GET | Tipos |
| `/deployments/` | POST | Criar |
| `/deployments/` | GET | Listar (status real) |
| `/deployments/:id` | GET | Detalhes |
| `/deployments/:id/statistics` | GET | Estatísticas |
| `/deployments/:id/targets` | GET | Devices |
| `/deployments/:id/targets/:t/actions/:a/status` | GET | Histórico |
| `/deployments/:id/targets/:t/actions/:a` | DELETE | Cancelar |
| `/deployments/:id` | DELETE | Deletar |
| `/deployments/devices/:id/actions` | GET | Ações do device |
