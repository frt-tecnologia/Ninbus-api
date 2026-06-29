# Ninbus — Provisionamento de Dispositivos & DDI

> Fluxo completo device-to-cloud: provisionamento, hawkBit DDI,
> segurança TargetToken e auto-provisionamento.

---

## 1. Visão Geral do Fluxo

```
┌─────────────┐    POST /api/devices/provision     ┌──────────────┐
│  Admin       │───────────────────────────────────>│  Ninbus API   │
│  (Fábrica)   │  {serialNumber, deviceKey, name}  │              │
└─────────────┘                                    │  1. Normaliza  │
                                                   │     serial → hex│
                                                   │  2. Cria target │
                                                   │     no hawkBit  │
                                                   │     (securityTok│
                                                   │     en=deviceKey│
                                                   │  3. Insere DB   │
                                                   │     status=uncl │
                                                   └──────┬────────┘
                                                          │
┌─────────────┐    GET /DEFAULT/controller/v1/{hex}       │
│  Dispositivo │    Authorization: TargetToken {deviceKey} │
│  (Ninbus v3) │──────────────────────────────────────────>│ hawkBit
│              │                                            │
│              │    200 OK {"config":{"polling":{"sleep":"00:05:00"}}}
│              │<──────────────────────────────────────────│
│              │                                            │
│              │    (polling a cada 5 min)                  │
│              │──────────────────────────────────────────>│
└─────────────┘                                            │
```

---

## 2. Formato do Serial Number

### 2.1 Formatos Aceitos

O dispositivo pode ter o serial em diferentes formatos:

| Formato | Exemplo | Descrição |
|---------|---------|-----------|
| Hex puro | `2100280018513531` | Bytes lidos diretamente da E2PROM |
| Dotted | `21.00.28.00.18.51.35.31` | Exibição humana, 2 chars por byte |
| Mixed case | `21002800` | Hex maiúsculo ou minúsculo |

### 2.2 Normalização

```typescript
// src/common/utils/serial-number.ts
normalizeSerial("25.5F.FF.FFF.FFFFF.F")
// → { hex: "255FFFFFFFFFFFF", display: "25.5F.FF.FF.FF.FF.FF.F" }

normalizeSerial("2100280018513531")
// → { hex: "2100280018513531", display: "21.00.28.00.18.51.35.31" }
```

### 2.3 Armazenamento no Banco

| Coluna | Formato | Uso |
|--------|---------|-----|
| `serial_number` | Hex maiúsculo (`255FFFFFFFFFFFF`) | hawkBit controllerId, busca |
| `serial_display` | Dotted (`25.5F.FF.FF.FF.FF.FF.F`) | Exibição no frontend |

### 2.4 Regras por Operação

| Operação | Formato obrigatório | Validação |
|----------|---------------------|-----------|
| `provisionDevice()` | Hex (4-32 chars) | Rejeita não-hex — precisa criar hawkBit target |
| `claimDevice()` | Flexível (hex ou outro) | Aceita qualquer formato |

---

## 3. hawkBit DDI — Autenticação TargetToken

### 3.1 Requisitos Obrigatórios do hawkBit Server

O hawkBit 1.0.3 vem com TargetToken auth **DESABILITADO** por padrão.
Sem isso, TODOS os polls DDI retornam 401.

**Configuração obrigatória no docker-compose.yml:**

```yaml
hawkbit:
  environment:
    # CRITICAL: Enable TargetToken auth (default=false!)
    HAWKBIT_SERVER_DDI_SECURITY_AUTHENTICATION_TARGETTOKEN_ENABLED: true
    # Auto-create targets on first DDI poll
    HAWKBIT_SERVER_DDI_AUTOPROVISIONING_ENABLED: true
```

**Ou via Management API (sem restart):**

```bash
curl -X PUT http://localhost:8080/rest/v1/system/configs/authentication.targettoken.enabled \
  -H "Authorization: Basic $(echo -n admin:admin | base64)" \
  -H "Content-Type: application/json" \
  -d '{"value": true}'
```

### 3.2 Formato da Requisição DDI

```
GET /{tenant}/controller/v1/{controllerId} HTTP/1.1
Host: <hawkbit-host>:8080
Authorization: TargetToken <securityToken>
```

| Campo | Valor | Observação |
|-------|-------|------------|
| `tenant` | `DEFAULT` ou `default` | Case-insensitive |
| `controllerId` | Serial em hex (`2100280018513531`) | Sem pontos, sem espaços |
| `Authorization` | `TargetToken key-test` | Header com prefixo "TargetToken" |

### 3.3 Respostas Possíveis

| HTTP | Significado | Próxima Ação |
|------|-------------|-------------|
| `200` | Config + links | Polling normal |
| `204` | Sem deployment | Polling normal |
| `401` | Token inválido ou auth desabilitada | Verificar deviceKey + config hawkBit |
| `404` | Target não existe | Provisionar via API |

---

## 4. Provisionamento — Passo a Passo

### 4.1 Criar Target via Ninbus API

```bash
curl -X POST http://localhost:8081/api/devices/provision \
  -H "Content-Type: application/json" \
  -H "Cookie: auth.session_token=YOUR_TOKEN" \
  -d '{
    "serialNumber": "2100280018513531",
    "deviceKey": "key-test",
    "name": "Ninbus-veiculo-210028"
  }'
```

**Resposta:**
```json
{
  "message": "Device provisioned successfully",
  "data": {
    "id": "uuid",
    "companyId": null,
    "hawkbitTargetId": "2100280018513531",
    "serialNumber": "2100280018513531",
    "serialDisplay": "21.00.28.00.18.51.35.31",
    "status": "unclaimed"
  }
}
```

### 4.2 O que acontece internamente

```
1. normalizeSerial("2100280018513531") → hex="2100280018513531"
2. hawkbitTargets.create({
     controllerId: "2100280018513531",
     name: "Ninbus-veiculo-210028",
     securityToken: "key-test"
   })
3. db.insert(devices).values({
     serialNumber: "2100280018513531",
     serialDisplay: "21.00.28.00.18.51.35.31",
     hawkbitTargetId: "2100280018513531",
     status: "unclaimed",
     companyId: null
   })
```

### 4.3 Gravar Token no Dispositivo

Via serial/UART:
```
//ZZkey-test          → grava o securityToken na E2PROM
//UUDEFAULT           → grava o tenant (opcional, DEFAULT é padrão)
```

### 4.4 Verificar Conexão

O device faz polling e recebe:
```json
{
  "config": {
    "polling": {
      "sleep": "00:05:00"
    }
  },
  "_links": {
    "configData": {
      "href": "http://hawkbit:8080/DEFAULT/controller/v1/2100280018513531/configData"
    }
  }
}
```

---

## 5. Background Sync & Device Status

O Ninbus API usa um **background sync worker** que atualiza o DB local com dados do hawkBit periodicamente (a cada 30s por padrão). Isto significa:

- **GET /devices** retorna dados hawkBit atualizados SEM fazer chamadas hawkBit na hora
- O background worker busca TODOS os targets do hawkBit (com paginação correta)
- Dados sincronizados: `connectionStatus`, `hawkbitUpdateStatus`, `ipAddress`, `lastPollAt`

### Colunas de Sync no DB Local

| Coluna | Tipo | Origem hawkBit |
|--------|------|---------------|
| `connectionStatus` | varchar(20) | `!target.pollStatus.overdue` → connected/disconnected |
| `hawkbitUpdateStatus` | enum | `target.updateStatus` |
| `ipAddress` | text | `target.ipAddress` |
| `lastPollAt` | timestamp | `target.pollStatus.lastRequestAt` |
| `nextExpectedPollAt` | timestamp | `target.pollStatus.nextExpectedRequestAt` |

### Verificação via Health Check

```bash
curl http://localhost:8081/health
# → {"sync":{"lastSyncAt":"...","devicesSynced":1,"errors":0}}
```

---

## 6. Ciclo de Vida do Dispositivo

```
┌─────────────┐     ┌────────────┐     ┌──────────┐     ┌───────────┐
│ unclaimed   │────>│ accepted   │────>│ online   │────>│ deploying │
│ (sem company│     │ (claim por │     │ (polling │     │ (DS       │
│  no DB)     │     │  empresa)  │     │  hawkBit)│     │  assigned)│
└─────────────┘     └────────────┘     └──────────┘     └───────────┘
       │                                      │
       │         ┌──────────┐                 │
       └────────>│ pending  │<────────────────┘
                  │ (hawkBit │     (sync engine
                  │  offline)│      update)
                  └──────────┘
```

| Status | Significado | hawkBit Target | Company |
|--------|-------------|----------------|---------|
| `unclaimed` | Provisionado, sem empresa | ✅ Existe | `null` |
| `pending` | Claim sem hawkBit link | ❌ Não existe | Atribuída |
| `accepted` | Claim com hawkBit link | ✅ Existe | Atribuída |

---

## 7. Variáveis de Ambiente — hawkBit DDI

| Variável | Default | Obrigatória | Descrição |
|----------|---------|-------------|-----------|
| `HAWKBIT_ENABLED` | `false` | — | Habilita integração hawkBit |
| `HAWKBIT_URL` | — | Sim (quando enabled) | URL do Management API |
| `HAWKBIT_USERNAME` | — | Sim (quando enabled) | Basic Auth username |
| `HAWKBIT_PASSWORD` | — | Sim (quando enabled) | Basic Auth password |
| `HAWKBIT_TIMEOUT_MS` | `30000` | — | Timeout das requisições |
| `HAWKBIT_SKIP_TLS` | `false` | — | Ignora cert TLS (dev) |
| `HAWKBIT_AUTOPROVISIONING` | `false` | — | Auto-criar target no primeiro DDI poll (OFF por padrão em produção) |
| `HAWKBIT_SYNC_INTERVAL_SEC` | `30` | — | Background sync interval em segundos |
| `HAWKBIT_SYNC_STALE_SEC` | `60` | — | Stale threshold para on-demand refresh (segundos) |
| `HAWKBIT_DDI_TARGET_TOKEN_AUTH` | `true` | **Sim** | Habilita TargetToken auth no DDI |

> **⚠️ CRÍTICO**: `HAWKBIT_DDI_TARGET_TOKEN_AUTH=true` é obrigatório para dispositivos
> se autenticarem via DDI. Sem isso, TODOS os polls retornam 401.

---

## 8. Troubleshooting DDI 401

### Diagnóstico em 4 passos:

```
1. TargetToken auth habilitado?
   GET /rest/v1/system/configs/authentication.targettoken.enabled
   → {"value": true}   ← deve ser true

2. Target existe no hawkBit?
   GET /rest/v1/targets/{controllerId}
   → 200 + {"controllerId": "...", "securityToken": "..."}   ← deve existir

3. SecurityToken confere?
   hawkBit securityToken == device E2PROM deviceKey?
   → Devem ser idênticos

4. Tenant correto?
   Device envia /DEFAULT/ ou /default/ → ambos funcionam (case-insensitive)
```

### Erros comuns:

| Sintoma | Causa | Correção |
|---------|-------|----------|
| 401 para TODOS os devices | TargetToken auth desabilitado | Habilitar config no hawkBit |
| 401 para UM device | SecurityToken mismatch | Conferir E2PROM vs hawkBit |
| 404 no DDI | Target não existe | Provisionar via API |
| Conexão recusada | hawkBit offline | Verificar Docker container |

---

## 9. Comandos Seriais do Dispositivo

| Comando | Descrição | Exemplo |
|---------|-----------|---------|
| `//ZZ<token>` | Gravar securityToken na E2PROM | `//ZZkey-test` |
| `//UU<tenant>` | Gravar tenant | `//UUDEFAULT` |
| `//HB` | Iniciar polling manual | — |

### Após gravar o token:

1. Reiniciar polling (ou aguardar próximo ciclo)
2. Primeiro poll deve retornar 200 (config) ou 204 (sem deployment)
3. hawkBit registra `lastRequestAt`, `ipAddress`, `pollStatus`
