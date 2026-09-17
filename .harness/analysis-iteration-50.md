# Análise — Iteração 50: Firmware Management (Fábrica)

## Hipóteses principais (confiança)

- H1 (alta): o tar-packager.ts JÁ produz o contrato v3 do agente embarcado (header-info/featureidentity.json + data/payload.bin, TAR puro). O upload de release da fábrica pode reusá-lo sem mudanças.
- H2 (alta): dispositivos reportam versões via DDI PUT /{tenant}/controller/v1/{controllerId}/configData com {mode:"merge", data:{"fw.ninbus.version":"…","fw.controller.version":"…"}} → hawkBit persiste como target attributes → Management API GET /rest/v1/targets/{id}/attributes expõe. (Validar empiricamente no Docker.)
- H3 (média): GET /rest/v1/targets NÃO inclui atributos no list — precisa de fetch por target. Mitigação: buscar atributos só p/ devices com deploy ativo (pending) OU firmware_version IS NULL (custo 1-shot por device novo).
- H4 (alta): para "mobile triggar atualização", é preciso um endpoint company-scoped que crie DS a partir do SM do release GLOBAL (fluxo de artifacts da company não o cobre — hawkbitSmId UNIQUE). Refatorar createDeployment extraindo deploySoftwareModuleToTargets(sm, targets, audit) reutilizado por ambos.
- H5 (média): "tag da atualização" = version semântica já documentada nos schemas de artifact (ex. "ninbus-firmware-3.3.0", version "3.3.0"). Upload de firmware torna version OBRIGATÓRIA com pattern semver.

## Plano (minimal, por camadas)

1. **DB (migração 0017)**: tabela `firmware_releases` (catálogo global, sem companyId) + colunas `firmware_version`/`controller_firmware_version` em `devices`.
2. **Módulo firmware** `/api/admin/firmware` (superAdmin): POST upload (reusa packageArtifact + SM), GET lista (DB local, cronológico DESC), GET /latest, DELETE (locked→409). Version obrigatória (semver).
3. **Company-scoped**: GET `/api/companies/:c/devices/firmware/status` (viewer, DB-only: latest + outdated/up_to_date/unknown/error) e POST `/devices/firmware/update` {deviceIds} (operator; cria DS do release global via helper extraído do createDeployment).
4. **Sync**: extractFirmwareVersions() puxa atributos p/ pending + version-null; grava colunas. selectDeviceSchema (drizzle) expõe automaticamente no GET /devices (critério 5).
5. **Admin devices**: colunas firmware no getAllDevices + status computado vs latest (critério 6).
6. **Dashboard**: /deployments/firmware (upload dialog + DataTable com sort/filter/search reutilizados), coluna Firmware na device-table, seção Firmware no detalhe do device.
7. **Docs + testes** + E2E Docker/Neon (upload real, configData DDI, status).
8. **Git**: conventional commits incrementais, SEM push.

## Critérios de aceite mapeados

1. Upload dashboard, seção deployments/firmware, super admin → itens 2+6
2. Lista cronológica, filtro/ordenação, componentes reusados (DataTable/Toolbar/SearchField/Select) → item 6
3. Tag/versão semver obrigatória no upload → item 2
4. GET firmware/status retorna outdated p/ mobile + POST update fecha o loop → itens 3+4
5. DDI configData report + colunas expostas no GET /devices + explicação ao usuário → itens 4+5
6. Admin device views com versões + periféricos + status de atualização → item 6
