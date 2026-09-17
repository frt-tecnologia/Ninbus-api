# Handoff — Agente do Sistema Embarcado (firmware Ninbus)

> Estado em 2026-09-17 · Branch `feat/firmware-management` · hawkBit 1.0.3 ·
> Tudo abaixo foi **validado em E2E real** contra o stack Docker (API :8081,
> DDI :8180, Neon). Doc completa: `docs/firmware-release-flow.md`.

## 1. Estado atual do sistema (o que já funciona de ponta a ponta)

- Catálogo global de firmware na fábrica (upload com tag semver obrigatória,
  ex. `4.0.3`) — o backend empacota o TAR do contrato v3 automaticamente.
- Deployment OTA funcionando: mobile (opt-in do cliente) **e** console admin
  (force, sem interação do usuário). Em ambos os casos o deployment hawkBit é
  `download=forced, update=forced` → **o device instala no próximo polling**.
- Report de versões via DDI funcionando e visível no backend/dashboard/mobile.
- Ciclo validado: poll → deploymentBase → download TAR → feedback →
  configData da nova versão → status `up_to_date` no servidor.

## 2. CONTRATO PRINCIPAL — como reportar suas versões (DDI)

O device informa a versão do firmware **próprio** e do **controlador
(periférico)** como atributos de target, via `configData`:

```http
PUT /{tenant}/controller/v1/{controllerId}/configData
Authorization: TargetToken {securityToken}     ← deviceKey de fábrica (modo B)
Content-Type: application/json

{
  "mode": "merge",
  "data": {
    "fw.ninbus.version":     "4.0.3",   ← versão do firmware do próprio Ninbus
    "fw.controller.version": "1.2.0"    ← versão do firmware do controlador/periférico
  }
}
```

- Chaves EXATAS (o backend lê literalmente essas duas): `fw.ninbus.version`
  e `fw.controller.version`. Formato: string semver.
- **Quando reportar:** (a) no boot, logo após inicializar; (b)
  **imediatamente após concluir uma instalação** (feedback `closed/success` →
  configData com a versão nova). Isso faz o status virar `up_to_date` na hora.
- Alternativa aceita: o mesmo payload `{mode, data}` no **corpo do GET de
  polling** (`GET /{tenant}/controller/v1/{controllerId}`).

O servidor puxa esses atributos (Management API) quando: existe deployment
ativo (`pending`), a versão é desconhecida, ou alguém consulta o status
(rate-limit 60 s/device). Não é preciso reportar em todo poll — só no boot e
pós-instalação.

## 3. Feedback de deployment — FORMATO hawkBit 1.0.3 (⚠️ mudou)

O corpo legado `{"id":..,"report":{"execution","finished"}}` retorna
**400 body.notReadable** no 1.0.3. O formato correto (validado via
`/v3/api-docs` + E2E):

```http
POST /{tenant}/controller/v1/{controllerId}/deploymentBase/{actionId}/feedback?c={etag-da-URL}
Authorization: TargetToken {securityToken}

// início do processamento
{ "status": { "execution": "proceeding", "result": { "finished": "none" } },
  "timestamp": 1627997501890 }              // ms de época do device

// conclusão
{ "status": { "execution": "closed", "result": { "finished": "success" } },
  "timestamp": 1627997600123 }
```

- `execution`: `proceeding|downloaded|download|closed|canceled|scheduled|rejected|resumed`
- `result.finished`: `none|success|failure` (`failure` → dashboard marca erro)
- Sempre use a URL completa do `_links.deploymentBase.href` (ela já traz o
  `?c=` obrigatório).

## 4. Pacote OTA — contrato TAR v3 (inalterado, já produzido pelo servidor)

```
firmware.tar (TAR PURO — NÃO gzipar)
├── header-info/featureidentity.json   {"type":"firmware-ninbus"}   ← decide a bifurcação
└── data/payload.bin                   binário pós-CalcCRC (CRC16 bootloader @ offset 1047)
```

- `firmware-ninbus` → self-update + reboot; `firmware-controller` /
  `configuration-nfx` → CAN, sem reboot.
- Manifesto assinado com **counter > piso do bootloader** (anti-downgrade).
  Counter ≤ piso → bootloader não aplica → o servidor verá ROLLED_BACK —
  comportamento correto; seguir o runbook de counter na geração do binário.
- Hashes sha1/md5/sha256 vêm no deploymentBase (`artifacts[].hashes`) —
  validar após o download.

## 5. Sequência completa esperada do device (referência)

1. Boot → GET polling (TargetToken) → PUT configData com as versões atuais.
2. Poll retorna `_links.deploymentBase` quando há update (mobile opt-in OU
   force do console — para o device é idêntico).
3. GET deploymentBase → baixar `download-http` → validar hashes → validar TAR
   (header-info + data) → aplicar conforme o `type`.
4. POST feedback `proceeding/none` → (instalar/reboot) → POST feedback
   `closed/success` (ou `failure` com detalhes).
5. Após o boot com a versão nova → PUT configData com a versão nova
   (`fw.ninbus.version` e, se o periférico também atualizou,
   `fw.controller.version`).
