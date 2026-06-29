# 📨 TASK para o Frontend — Timeline de Notificações do Deployment Sumiu

## Situação

Você reportou: a timeline de eventos/notificações durante uma atualização de firmware (que aparecia no app antes) **sumiu**. Queremos confirmar se foi o backend ou o frontend.

## Diagnóstico do backend — NÃO é problema do backend

Após análise estática completa do código (commit `bf6395b`) + validação dos testes do snapshot (6/6 passam), confirmo:

### O que NÃO mudou no backend

Estes endpoints continuam **idênticos em formato e comportamento** para dispositivos em atualização:

| Endpoint | Função | Estado |
|----------|--------|--------|
| `GET /api/companies/:companyId/deployments/:deploymentId/targets/:targetId/status-trail` | **Timeline completa** (lista cronológica de status entries) | ✅ **Intacto** — `getTargetStatusTrail` não foi tocado |
| `GET /api/companies/:companyId/devices/:deviceId/actions` | Lista de actions do device | ✅ **Intacto** — `getHawkbitTargetActions` não foi tocado |
| `GET /api/companies/:companyId/deployments/:deploymentId/targets/:targetId/actions/:actionId/status` | Status entries de uma action | ✅ **Intacto** |
| SSE event `device.action.status` | Push em tempo real durante deploy | ✅ **Intacto** — mesma emissão no `sync-progress.ts` |

### O que mudou (mas NÃO afeta atualizações em andamento)

A única mudança relevante foi no endpoint `GET /target-statuses` — adicionei um "frozen short-circuit" que retorna do snapshot local **APENAS quando o target está em estado terminal** (installed/canceled/error). Para dispositivos em processo de atualização (downloading/pending/assigned), o snapshot **não está frozen** e o endpoint continua buscando o hawkBit normalmente.

**Prova:** a função `freezeOnTerminalPhase` em `src/modules/deployments/snapshot.ts` só age nas fases `installed`/`canceled`/`error`. Nunca em `downloading`/`pending`/`retrieved`/`assigned`. Então durante uma atualização ativa, o comportamento é 100% o mesmo de antes.

## Como confirmar no frontend

### 1. Verifique qual endpoint o app está chamando para a timeline

A timeline de eventos durante atualização deve vir de **um destes**:

```dart
// Opção A (recomendada): timeline cronológica completa
GET /api/companies/{companyId}/deployments/{deploymentId}/targets/{targetId}/status-trail

// Resposta:
{
  "controllerId": "...",
  "name": "Onibus 1",
  "actionId": 42,
  "phase": "downloading",
  "progress": 50,
  "currentMessage": "downloading 50%",
  "trail": [
    { "phase": "assigned", "reportedAt": "...", "displayMessage": "..." },
    { "phase": "pending", "reportedAt": "...", "displayMessage": "..." },
    { "phase": "downloading", "reportedAt": "...", "displayMessage": "downloading 50%" }
  ]
}
```

### 2. Verifique a assinatura do SSE

```dart
// O app deve estar ouvindo o evento SSE:
sse.on('device.action.status', (event) {
  // event.phase, event.progress, event.message, event.timestamp
  // Adiciona à timeline local
});
```

### 3. Possíveis causas no frontend

- **Model `TargetStatusTrail` ou `ActionStatus` quebrou?** O formato JSON do backend não mudou, mas se o model do Flutter foi refatorado, pode ter parado de desserializar `trail` (array) ou `phase`.
- **Endpoint mudou na URL?** Confirmar se o path exato é `/status-trail` (com hífen) e não `/status_trail` ou `/trail`.
- **Listener SSE foi removido?** Se a tela de detalhe do deployment parou de abrir a conexão SSE, a timeline para de receber eventos em tempo real.
- **Filtro novo no Flutter?** Algo como `if (status == 'canceled') skip` pode estar escondendo entries que antes apareciam.

## Como reproduzir e debugar

1. **Criar um deployment ativo** no app (ou via API).
2. **Acessar a tela de detalhe** do deployment → clicar num device.
3. **Abrir DevTools/network** do Flutter e verificar:
   - Chamou `GET .../status-trail`? Resposta veio com `trail: [...]`?
   - Conexão SSE está ativa? Eventos `device.action.status` chegando?
4. **Curl direto para confirmar backend:**
   ```bash
   curl -H "Authorization: Bearer <token>" \
     http://localhost:8081/api/companies/{companyId}/deployments/{deploymentId}/targets/{targetId}/status-trail
   ```
   Se voltar JSON com `trail: [...]` → backend OK, problema é o Flutter não consumindo.

## Contrato dos endpoints relacionados (referência)

### `GET /deployments/:deploymentId/targets/:targetId/status-trail`
**Retorna a timeline completa (o que você provavelmente quer):**
```json
{
  "controllerId": "FF32FF51FFF1FFFF",
  "name": "Onibus 1",
  "actionId": 42,
  "actionType": "update",
  "actionStatus": "running",
  "active": true,
  "phase": "downloading",
  "progress": 50,
  "currentMessage": "downloading 50%",
  "trail": [
    { "id": 101, "type": "scheduled", "reportedAt": 1782000000000, "messages": ["..."], "phase": "assigned", "displayMessage": "Assignment initiated" },
    { "id": 102, "type": "retrieved", "reportedAt": 1782000010000, "messages": ["..."], "phase": "pending", "displayMessage": "Device acknowledged" },
    { "id": 103, "type": "download",  "reportedAt": 1782000020000, "messages": ["..."], "phase": "downloading", "displayMessage": "downloading 50%" }
  ]
}
```

### SSE `device.action.status` (tempo real)
```json
{
  "deviceId": "uuid",
  "controllerId": "FF32FF51FFF1FFFF",
  "actionId": 42,
  "latestStatus": "download",
  "phase": "downloading",
  "progress": 50,
  "message": "downloading 50%",
  "timestamp": "2026-06-22T18:30:00.000Z"
}
```

### `GET /deployments/:deploymentId/target-statuses` (resumo por target, não é timeline)
Retorna UM item por target com a phase atual + progress. Não contém a lista cronológica. **Não use isso para a timeline** — use `/status-trail`.

## Conclusão

**Backend está funcionando.** A timeline durante atualização não foi afetada pelas mudanças do commit `bf6395b` (essas mudanças só atuam em estados terminais: installed/canceled/error). A regressão está provavelmente no Flutter — verifique item por item da seção "Possíveis causas no frontend".

Se after debugar você confirmar que o endpoint está sendo chamado e voltando vazio (`trail: []`), me avise com o `deploymentId` e `targetId` que eu investigo o lado hawkBit.
