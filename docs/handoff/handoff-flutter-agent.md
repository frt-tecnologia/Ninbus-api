# Handoff — Agente Flutter (app mobile)

> Estado em 2026-09-17 · Branch `feat/firmware-management` ·
> Tudo validado em E2E contra o Docker local. Doc completa:
> `docs/firmware-release-flow.md`. OpenAPI: `/docs` (Scalar).

## 1. Estado atual

- Gestão de firmware completa no backend + dashboard (catálogo da fábrica,
  upload com tag semver, lista cronológica, versões por dispositivo).
- Dois caminhos de atualização (a execução no device é idêntica):
  - **Mobile (opt-in):** o app consulta o status e o CLIENTE aprova.
  - **Console (force):** a fábrica empurra direto pela dashboard —
    ⚠️ o app deve estar preparado para o `firmwareStatus` do dispositivo
    mudar para `pending`/`up_to_date` SEM nenhuma ação do usuário.

## 2. Endpoint novo para o app — status de firmware da company

```http
GET /api/companies/{companyId}/devices/firmware/status      (viewer)
Cookie/Bearer de sessão
```

Resposta:

```json
{
  "latest": {
    "ninbus":     { "version": "4.0.3", "name": "wifi3", "artifactType": "firmware-ninbus", ... },
    "controller": null
  },
  "devices": [
    {
      "deviceId": "0ec18161-...",
      "name": "E2E-Ninbus-01",
      "serialDisplay": "E2.E0.00.00.00.00.00.01",
      "firmwareVersion": "4.0.2",
      "controllerFirmwareVersion": "1.2.0",
      "connectionStatus": "connected",
      "hawkbitUpdateStatus": "in_sync",
      "firmwareStatus": "update_available"
    }
  ],
  "summary": { "total": 1, "upToDate": 0, "outdated": 1, "unknown": 0, "error": 0 }
}
```

- `firmwareStatus` por dispositivo:
  `up_to_date` | `update_available` | `unknown` (nunca reportou via DDI) |
  `error` (último OTA falhou) | `no_release` (fábrica não publicou nada).
- `summary` pronto para badge/donut. `latest.controller` = release do
  firmware do periférico (por enquanto só `firmware-ninbus` é publicado).

## 3. Disparar a atualização (opt-in do cliente)

```http
POST /api/companies/{companyId}/devices/firmware/update     (operator)
{ "deviceIds": ["0ec18161-..."] }
```

- Envia a **última release publicada** para os dispositivos escolhidos.
- Device ids de outra company são silenciosamente descartados (cross-tenant
  safe). IDs inválidos → 404/400.
- Resposta traz `dsId`, `targetsAssigned`, `verified` — útil para feedback
  imediato na UI ("atualização agendada para N dispositivo(s)").
- Após o POST, o dispositivo instala no próximo polling DDI (segundos).
  O status acompanha via `hawkbitUpdateStatus`: `pending` → `in_sync`
  (sucesso) ou `error` (falha).

## 4. Versões na listagem de dispositivos (já disponível)

`GET /api/companies/{companyId}/devices` agora inclui por dispositivo:

- `firmwareVersion` — versão do firmware Ninbus reportada via DDI
  (null = nunca reportou);
- `controllerFirmwareVersion` — versão do controlador/periférico.

## 5. Dicas de UX

- Consulte `/devices/firmware/status` ao abrir a tela de dispositivos
  (o endpoint já faz refresh on-demand das versões, com rate-limit de 60 s
  por dispositivo no servidor — pode chamar à vontade).
- O dispositivo pode ser atualizado pela fábrica a qualquer momento
  (force do console): ao ver `hawkbitUpdateStatus: pending`, mostre
  "atualizando…"; `in_sync` → "atualizado"; `error` → alerta.
- `unknown` geralmente significa dispositivo recém-provisionado que ainda
  não fez boot com o agente novo.
