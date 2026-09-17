# Iteração 51 — Admin force firmware update (console)

## Objetivo
Admin (super admin) dispara atualização de firmware direto do console, sem
interação do usuário final. O deployment hawkBit já é download/update FORCED
(o device instala no próximo polling) — o que falta é o caminho admin.

## Design

### API — POST /api/admin/firmware/deploy (superAdmin)
Body: { deviceIds: string[], artifactType?: 'firmware-ninbus' | 'firmware-controller' }
- Service `deployFirmwareToDevices(userId, deviceIds, artifactType)`:
  1. Busca devices (accepted, hawkBit-linked, com companyId) pelos IDs
  2. Agrupa por companyId (tabela global permite seleção multi-company)
  3. Para cada company: reusa triggerFirmwareUpdate (mesma execução de
     deployment compartilhada: DS + assignment + verify + audit)
  4. Agrega resultado por company
- Rota em firmware/routes.ts; schemas em schemas.ts (padrão do módulo)

### UI — Dashboard
- lib/api/firmware.ts: deployFirmwareToDevices()
- components/domain/firmware/firmware-force-dialog.tsx (client): confirmação
  com versão alvo + lista de dispositivos; reutilizável nos dois pontos
- Device table (admin): badge "Atualização disponível" clicável → dialog
- Device detail: botão "Forçar atualização" na seção Firmware

### Testes
403 não-super-admin, 400 HAWKBIT_NOT_ENABLED, NOT_FOUND sem elegíveis.

### E2E (Docker local)
Publicar release 4.0.3 → POST admin deploy → device polling → deploymentBase
→ instala → up_to_date.

## Entregas
- commits convencionais, SEM push
