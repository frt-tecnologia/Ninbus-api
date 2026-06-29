# Device Name → hawkBit Sync

**Status:** ✅ Implementado e validado empiricamente no Docker (2026-06-22)
**Bug corrigido:** o nome do dispositivo informado pelo usuário no cadastro não propagava para o hawkBit, fazendo a lista de targets em atualização mostrar o nome de fábrica.

## Causa raiz

O `claimDevice()` e o `updateDevice()` atualizavam o `name` apenas no DB local (`devices.name`).
A lista de targets de um deployment (`GET /deployments/:id/targets`) lê o `name` diretamente do hawkBit
(`target.name`), que mantinha o nome de fábrica/provisionamento para sempre.

## Solução (Opção A — fonte de verdade única)

O DB local continua canônico, mas TODA mutação de `name` propaga ao hawkBit via
`PUT /rest/v1/targets/{controllerId} { name }` (validado empiricamente: retorna 200 + atualiza o target).

### Helper compartilhado

`src/modules/devices/name-sync.ts` exporta `syncTargetName(controllerId, name, operation)`:

- Guard `hawkbitConfig.enabled` → no-op em testes/local-dev (HAWKBIT_ENABLED=false)
- Best-effort: erros são logados (warn) mas **nunca** bloqueiam a mutação local
- Two-level error protection: o helper checa `enabled`; o route handler já captura erros de rede

### Pontos de integração

| Mutação | Arquivo | Comportamento |
|---------|---------|---------------|
| `claimDevice` (cadastro do usuário) | `provisioning.ts` | após o `UPDATE devices`, chama `syncTargetName(hawkbitTargetId, displayName, 'claim')` |
| `updateDevice` (renomeação) | `service.ts` | se `data.name` mudou, chama `syncDeviceNameToHawkbit(hawkbitTargetId, name)` |
| `linkDevice` (legacy) | `provisioning.ts` | após criar o target, chama `syncTargetName(controllerId, name, 'link')` |

## Validação empírica (Docker, hawkBit habilitado)

| Etapa | DB local | hawkBit (target.name) |
|-------|----------|----------------------|
| PROVISION `FABRICA-FINAL` | `FABRICA-FINAL` | `FABRICA-FINAL` |
| CLAIM `NOME-USUARIO-FINAL` | `NOME-USUARIO-FINAL` ✅ | `NOME-USUARIO-FINAL` ✅ (antes: ficava `FABRICA-FINAL`) |
| RENAME `NOME-RENOMEADO` | `NOME-RENOMEADO` ✅ | `NOME-RENOMEADO` ✅ |

## Testes

- **Unitários** (`src/modules/devices/name-sync.test.ts`): 5 testes cobrem chamada correta, swallow de erros (best-effort), no-op em entradas vazias, guard de hawkBit desabilitado.
- **Integração** (`tests/devices.test.ts > PUT /:deviceId updates device`): continua passando (o rename não bloqueia).

## Limitações conhecidas

1. **Sem reconciliação automática:** devices cujo nome divergiu ANTES do fix não são retroativamente sincronizados. Solução futura: job de background que periodicamente lê `devices.name` e faz PUT no hawkBit para targets divergentes. Por ora, qualquer rename ou re-claim resolve o dispositivo.

2. **Race condition em `claim` imediatamente após `provision`:** se o hawkBit ainda estiver criando o target quando o `syncTargetName` chegar, o PUT pode falhar com 404. O helper loga warn e segue — o nome local fica correto e será sincronizado no próximo rename. Em prática isso é raríssimo porque o `provision` é async e o `claim` vem minutos/horas depois.
