# Firmware Release Flow — Fábrica → Frota

Este documento descreve o fluxo completo de atualização de firmware do
Ninbus: publicação pela fábrica, descoberta de dispositivos desatualizados
pelo mobile e o contrato DDI de report de versões do dispositivo.

## Visão geral

```
Fábrica (super admin)                    Mobile (empresa)                Dispositivo
─────────────────────                    ────────────────                ───────────
POST /api/admin/firmware ──► hawkBit SM  GET /devices/firmware/status     PUT DDI configData
(versão/tag semver obrigatória)          (quem está desatualizado)        (report versões)
                                         POST /devices/firmware/update    GET DDI deploymentBase
                                         (quando o cliente aprovar)       (baixa + instala)
```

## 1. Publicação de release (fábrica)

**Endpoint:** `POST /api/admin/firmware` — multipart/form-data, **super admin
somente** (email em `SUPER_ADMIN_EMAILS`; a dashboard `/deployments/firmware`
já é protegida pelo guard server-side `requireAdmin`).

Campos:

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `file` | ✅ | Firmware raw (.fir/.frz/.bin) — o **binário pós-CalcCRC** para firmware-ninbus |
| `name` | ✅ | Nome de exibição (ex.: "wifi3 — estabilidade CAN") |
| `version` | ✅ | **Tag semver da atualização** (ex.: `4.0.1`, `4.1.0-rc.2`) — única por tipo |
| `artifactType` | ✅ | `firmware-ninbus` \| `firmware-controller` |
| `description` | — | Notas da release (≤1000 chars) |

O servidor empacota o `.tar` do contrato do dispositivo (ver §5), cria o
Software Module no hawkBit, faz upload do binário e registra na tabela
`firmware_releases` (catálogo **global** — sem companyId).

Outras rotas: `GET /api/admin/firmware` (lista cronológica), `GET
/api/admin/firmware/latest?type=`, `DELETE /api/admin/firmware/:releaseId`
(409 enquanto houver DS referenciando o SM).

## 2. Consulta do mobile — quem está desatualizado

**Endpoint:** `GET /api/companies/:companyId/devices/firmware/status` (viewer).

Resposta (100% do DB local — zero chamadas hawkBit):

```json
{
  "latest": {
    "ninbus":  { "version": "4.0.1", "name": "wifi3 — estabilidade CAN", ... },
    "controller": null
  },
  "devices": [
    {
      "deviceId": "uuid",
      "name": "Ninbus-veiculo-06",
      "serialDisplay": "26.6.15.001.00031",
      "firmwareVersion": "3.9.0",
      "controllerFirmwareVersion": "1.2.0",
      "connectionStatus": "connected",
      "hawkbitUpdateStatus": "in_sync",
      "firmwareStatus": "update_available"
    }
  ],
  "summary": { "total": 4, "upToDate": 1, "outdated": 1, "unknown": 1, "error": 1 }
}
```

`firmwareStatus` por dispositivo:

| Valor | Significado |
|-------|-------------|
| `up_to_date` | versão reportada ≥ última release |
| `update_available` | desatualizado — o mobile pode ofertar a atualização |
| `unknown` | o dispositivo nunca reportou a versão via DDI |
| `error` | a última tentativa OTA falhou (`hawkbitUpdateStatus=error`) |
| `no_release` | a fábrica ainda não publicou nenhuma release |

**Trigger da atualização (quando o cliente aprovar):**

```
POST /api/companies/:companyId/devices/firmware/update   (operator)
{ "deviceIds": ["uuid1", "uuid2"] }
```

Cria um deployment da **última release global** para os dispositivos
selecionados (mesma execução compartilhada dos deployments: DS + assign +
verificação DDI + registro local). Devices de outra empresa são descartados
silenciosamente. O progresso segue o fluxo SSE existente
(`device.action.status`, `deployment.stats`).

## 3. Report de versões via DDI (lado do dispositivo)

O dispositivo informa as versões do seu firmware e do controlador
(periférico) como **atributos de target** no hawkBit, via DDI. Duas formas
equivalentes:

### Forma A — configData (recomendada)

```http
PUT /{tenant}/controller/v1/{controllerId}/configData
Authorization: TargetToken {securityToken}
Content-Type: application/json

{
  "mode": "merge",
  "data": {
    "fw.ninbus.version": "4.0.1",
    "fw.controller.version": "1.2.0"
  }
}
```

### Forma B — corpo do polling (GET root)

O mesmo payload `{mode, data}` pode ser enviado no corpo do GET de polling
(`GET /{tenant}/controller/v1/{controllerId}`) — o hawkBit aplica como
atualização de atributos. Útil para reportar a versão logo após o boot sem
request extra.

**Chaves de atributo (contrato):**

| Atributo | Descrição |
|----------|-----------|
| `fw.ninbus.version` | Versão do firmware do próprio Ninbus |
| `fw.controller.version` | Versão do firmware do controlador/periférico (LightDot) |

**Quando reportar:** no boot (após inicialização), e imediatamente após
concluir uma instalação (`closed/success` no feedback do deploymentBase) —
assim o status do dispositivo muda para `up_to_date` sem esperar o próximo
boot.

### Feedback de deployment (hawkBit 1.0.3 — formato VALIDADO em E2E)

> **Atenção:** o hawkBit 1.0.3 mudou o contrato do feedback DDI em relação
> à documentação antiga (v1). O corpo legado `{"id","report":{...}}` retorna
> `400 body.notReadable`. O formato correto (confirmado via
> `/v3/api-docs` + E2E):

```http
POST /{tenant}/controller/v1/{controllerId}/deploymentBase/{actionId}/feedback?c={etag}
Authorization: TargetToken {securityToken}
Content-Type: application/json

{ "status": { "execution": "proceeding", "result": { "finished": "none" } },
  "timestamp": 1627997501890 }

{ "status": { "execution": "closed", "result": { "finished": "success" } },
  "timestamp": 1627997600123 }
```

- `status.execution`: `proceeding` | `downloaded` | `download` | `closed` |
  `canceled` | `scheduled` | `rejected` | `resumed`
- `status.result.finished`: `none` | `success` | `failure`
- `timestamp` em milissegundos (época do device)
- O parâmetro `?c=` (etag do deploymentBase) acompanha a URL do `_links`

### Como o servidor descobre

O **sync engine** chama `GET /rest/v1/targets/{controllerId}/attributes`
(Management API) a cada ciclo para dispositivos que:

- estão com `hawkbitUpdateStatus=pending` (deploy ativo — a versão acabou de
  mudar), **ou**
- nunca reportaram versão (`devices.firmware_version IS NULL`) — uma consulta
  única por dispositivo novo.

Frota em estado estável gera **zero** chamadas extras de atributos.

**Gap coberto — refresh on-demand:** a transição `pending → in_sync` pode
acontecer no mesmo ciclo de sync, *antes* do report pós-instalação ser
puxado, deixando a versão local uma release atrás sem caminho de fundo para
corrigir. Por isso os endpoints de status
(`GET /companies/:id/devices/firmware/status` e as views admin de devices)
rodam um **refresh on-demand** (`refreshStaleFirmwareVersions`): puxa os
atributos dos dispositivos cuja versão local está atrás da última release,
com rate-limit em memória de 60s por dispositivo. Auto-limitante: quando o
report iguala a última release, o dispositivo sai da seleção.

> Nota: o sync de fundo só roda para companies com sessão ativa (janela de
> 300s — ver `getActiveCompanyIds`). O status `hawkbitUpdateStatus` final
> (`in_sync`/`error`) propaga no próximo ciclo após atividade, ou imediatamente
> via o refresh manual (botão "Atualizar status" → `POST /api/admin/devices/sync`).

As versões ficam disponíveis em:

- `GET /api/companies/:companyId/devices` (mobile — colunas
  `firmwareVersion` / `controllerFirmwareVersion` em cada dispositivo);
- `GET /api/admin/devices` e
  `GET /api/admin/companies/:companyId/devices` (dashboard admin — com
  `latestFirmwareVersion` + `firmwareStatus` computados).

### Quem dispara a atualização (mobile opt-in × console force)

Antes de TUDO isso, porém, existe um **gate de publicação**: a release só
chega ao cliente quando explicitamente publicada.

| Estado | Visível no mobile? | `latest` (end-user)? | Force deploy (console)? |
|---|---|---|---|
| `draft` | NÃO (`update_available` não considera) | NÃO | SIM (releaseId explícito → pilotos) |
| `published` | SIM | SIM | SIM (omissão → latest published) |

- Upload cria a release como **draft** (`POST /api/admin/firmware`).
- `POST /api/admin/firmware/:id/publish` (super admin) a torna a versão
  disponível; `.../unpublish` é o freio de emergência (esconde dos endpoints
  de cliente; deployments já atribuídos seguem no hawkBit).
- Ciclo de testes da fábrica: sobe draft → **Testar em dispositivos piloto**
  (dashboard, deploy com releaseId) → valida → **Publicar**.
- Migrations 0019 (coluna `status`, retrocompat: existentes = published) e
  0020 (activity_action += `firmware.unpublished`).

Há DOIS caminhos para iniciar a atualização — a execução no hawkBit é
idêntica (deployment `download=forced`, `update=forced`; o dispositivo
instala no próximo polling DDI):

| Caminho | Endpoint | Quem decide | RBAC |
|---|---|---|---|
| **Mobile (opt-in)** | `POST /companies/:companyId/devices/firmware/update` | o CLIENTE aprova no app | `companyRole: operator` |
| **Console (force)** | `POST /api/admin/firmware/deploy` | a FÁBRICA empurra direto | `superAdmin` |

O deploy do console aceita `deviceIds` globais (qualquer company): o backend
agrupa por company e cria um deployment POR company (DS isolado, verificação
de atribuição e auditoria próprias — action `firmware.deploy_forced`).
Na dashboard, o force aparece como badge clicável na tabela de dispositivos
(dispositivos `update_available`) e como botão na página de detalhe, sempre
com dialog de confirmação mostrando `versão atual → versão alvo`.

## 4. Visualização na dashboard (admin)

- **Dispositivos (tabela):** coluna *Firmware* com a versão reportada + sinal
  de situação (Atualizado / Atualização disponível / Versão desconhecida /
  Erro). Filtro por situação e export PDF/Excel incluem as versões.
- **Dispositivo (detalhe):** seção *Firmware* com a versão do Ninbus, a
  versão do **controlador (periférico)**, a última release da fábrica e o
  estado do último update hawkBit (erro destacado).
- **Deployments → Firmware:** catálogo cronológico de releases com busca,
  filtro por tipo, ordenação por coluna, export e publicação via dialog
  (arquivo + tag semver obrigatória).

## 5. Contrato de empacotamento (v3/v4 — paridade com o legado)

O backend empacota automaticamente (ver `src/modules/artifacts/tar-packager.ts`):

```
firmware.tar
├── header-info/featureidentity.json   {"type": "firmware-ninbus"}
└── data/payload.bin                   binário do firmware
```

Regras críticas (do agente do sistema embarcado):

1. **TAR puro, sem gzip** — v4 não implementa inflate; comprimir quebra o parse.
2. Diretórios exatamente `header-info/` e `data/`; payload nomeado `payload.bin`.
3. O `type` do `featureidentity.json` é o que decide a bifurcação no device:
   `firmware-ninbus` → self-update + reboot; `firmware-controller` /
   `configuration-nfx` → CAN, sem reboot.
4. **firmware-ninbus: o binário deve ser o pós-CalcCRC** (CRC16 do bootloader
   no offset 1047). O backend faz upload VERBATIM — nenhum estágio recalcula
   o CRC.
5. **Manifesto assinado com counter > piso do bootloader** (anti-downgrade).
   Counter ≤ piso → o bootloader NÃO aplica → restore → o servidor verá
   ROLLED_BACK / "firmware was not applied by bootloader". É comportamento
   correto do anti-downgrade — o runbook de counter deve ser seguido na
   geração do binário pela fábrica.

## 6. Modelo de dados

| Tabela | Papel |
|--------|-------|
| `firmware_releases` | Catálogo global (sem companyId). UNIQUE(`artifactType`,`version`), UNIQUE(`hawkbitSmId`) |
| `devices.firmware_version` | Versão do Ninbus reportada via DDI |
| `devices.controller_firmware_version` | Versão do controlador reportada via DDI |

"Latest" = maior **semver** do tipo (com desempate por recência), resolvido
por `compareVersions()` (testado unitariamente).
