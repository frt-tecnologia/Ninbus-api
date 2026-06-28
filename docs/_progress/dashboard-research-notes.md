# Notas de Pesquisa — Dashboard Admin (rastreabilidade + hipóteses)

> Investigação sistemática dos 8 requisitos do usuário contra o código real da API.
> Hipóteses concorrentes + níveis de confiança. Atualizado conforme investigo.

## Metodologia
Para cada requisito: (1) investigar código/schema, (2) formar hipóteses concorrentes,
(3) atribuir confiança, (4) classificar: ✅ viável agora / 🟡 parcial / 🔴 precisa API nova.

---

## Requisito 1 — Cadastro de dispositivo por número de série
**Investigação:** `POST /api/devices/provision` (superAdmin), body `{ serialNumber, deviceKey, name }`.
`provision-routes.ts:8-27`.
**Conclusão:** ✅ **VIÁVEL AGORA.** Confiança ALTA.
- Endpoint existe, exige superAdmin (dashboard admin usa).
- Gera hawkBit target com deviceKey.
- Body: serialNumber (formato hex), deviceKey (chave de fábrica), name (opcional).
- Erro 409 se serial já existe.

## Requisito 2 — Listar devices + buscar/filtrar por serial e company
**Investigação:**
- `GET /api/admin/devices` (`getAllDevices`) → retorna TODOS os devices com companyId, serialNumber, serialDisplay, status, connectionStatus, lastSeenAt, createdAt.
- **NÃO há query params** de filtro/paginação — `getAllDevices()` retorna tudo, ordenado por createdAt.
**Hipótese A (client-side):** dashboard busca tudo e filtra/ordena no browser. Dataset ~10k devices cabe em memória. ✅ simples.
**Hipótese B (server-side):** criar `GET /api/admin/devices?company=&serial=&sort=&limit=` novo.
**Decisão:** A para MVP (rápido); B se volume explodir (>50k). Confiança ALTA.

**Conclusão:** ✅ **VIÁVEL AGORA** (filtragem client-side). Campos: serialNumber, serialDisplay, companyId (p/ filtrar por empresa), lastSeenAt, createdAt. Confiança ALTA.

## Requisito 3 — Ordenar por last-seen, last added, last deploy
**Investigação:**
- last-seen: `lastSeenAt` ✅ no schema.
- last added: `createdAt` ✅ no schema.
- **last deploy:** NÃO há campo "último deploy" no device. Precisa JOIN com deployments (targetIds JSONB contém o controllerId). Complexo.
**Hipótese:** ordenação por lastSeenAt/createdAt = client-side (campos existem). Ordenação por "last deploy" precisa de query nova (JOIN deployments).
**Conclusão:** 🟡 **PARCIAL.** last-seen + last-added = ✅ agora (client-side). last-deploy = 🔴 precisa endpoint/query nova. Confiança ALTA.

## Requisito 4 — Visualizar usuários logados (geral e específico)
**Investigação:**
- Tabela `session` EXISTE (`auth.ts:19`): id, expiresAt, token, ipAddress, userAgent, userId, createdAt, updatedAt.
- "Logado agora" = sessions WHERE expiresAt > NOW() (não expiradas).
- **NÃO há endpoint admin** que liste sessions. `getAllUsersWithCounts` (admin/users) lista usuários mas NÃO sessions.
**Hipótese A:** criar `GET /api/admin/sessions` (lista sessions ativas c/ user join).
**Hipótese B:** adicionar `activeSessionCount`/`lastSessionAt` ao `AdminUserSchema` via JOIN session.
**Conclusão:** 🔴 **PRECISA ENDPOINT NOVO** (na API). Dados existem (tabela session), mas não há rota que os exponha. Confiança ALTA. Trabalho pequeno (~1 endpoint + JOIN).

## Requisito 5 — Filtros (categorias) criados por usuários de cada company
**Investigação:**
- `GET /api/companies/:companyId/categories` (companyRole viewer, superAdmin bypass).
- **NÃO há listagem admin agregada** (todas categorias de todas empresas).
**Hipótese A:** dashboard itera empresas → chama `/api/companies/:id/categories` p/ cada uma (N requisições). Lento p/ muitas empresas.
**Hipótese B:** criar `GET /api/admin/categories` (agregado, JOIN company).
**Decisão:** B é melhor (1 requisição). Mas A funciona como fallback.
**Conclusão:** 🟡 **PARCIAL.** Dados existem; rota agregada admin precisa ser criada OU usar N chamadas. Confiança ALTA.

## Requisito 6 — Precadastro de company + atribuir/remover usuários + gerenciar atividades
**Investigação (confirmado no plano anterior):**
- POST `/api/companies` { name, ownerEmail } → cria empresa + designa owner (ou pending se não existe conta).
- POST/PUT/DELETE `/api/companies/:id/members` → add/promover/remover.
- POST/DELETE `/api/companies/:id/designations` → designar/cancelar (precadastro por email).
- PUT `/api/admin/companies/:id/status` → suspender/ativar.
- GET `/api/admin/pending-designations` → ver pendências.
**Conclusão:** ✅ **VIÁVEL AGORA.** Precadastro completo (company + designação por email + gestão de membros). Confiança ALTA. "Gerenciar atividades" = suspender/ativar (existe); atividades detalhadas de um user = ver requisito 4 (sessions).

## Requisito 7 — Observabilidade + export PDF/Excel (download, success/falha, quem aplicou)
**Investigação (a mais complexa):**
- **Quem aplicou a atualização:** `deployments.createdBy` (FK user.id) ✅ existe.
- **Data/hora baixou + success/falha:** `GET /api/companies/:id/deployments/:dsId/targets/:targetId/status-trail` → timeline COMPLETA (phase: downloading→downloaded→installing→installed/error, progress, reportedAt, message). ✅ DADOS EXISTEM.
- **Snapshot canônico:** `deployments.targetStatusSnapshot` JSONB — fase final por device (preserva histórico mesmo após cancel). ✅ existe.
- **Logou na rede (device):** `devices.lastSeenAt` ✅ (última vez que o device polou = "logou na rede").
- **Logou na rede (usuário):** session.createdAt/expiresAt ✅ (ver requisito 4).

**HIPÓTESE EXPORT:**
- 🔴 **NÃO há geração de PDF/Excel na API.** Zero dependências (sem pdfkit, sem exceljs). Confiança ALTA.
- **Hipótese A (dashboard client-side):** dashboard busca dados (status-trail + snapshots) e gera **PDF/Excel no BROWSER** (lib jsPDF / SheetJS/xlsx). ✅ não toca na API além de ler dados.
- **Hipótese B (API server-side):** criar `GET /api/admin/reports/deployments.xlsx` (gera no servidor).
**Decisão:** A — geração client-side no Next.js. Mais flexível (preview, customização), não pesa a API, sem novas deps server. Dados já vêm via endpoints existentes (status-trail).

**Conclusão:** ✅ **DADOS VIÁVEIS AGORA** (status-trail + createdBy + lastSeenAt + snapshots). 🔴 **EXPORT precisa ser feito no dashboard** (lib client-side). 🔴 **relatório agregado cross-company** precisa endpoint novo (status-trail é por deployment/target; admin quer visão agregada). Confiança ALTA.

## Requisito 8 — Demais relatórios de eventos da plataforma
**Investigação:** não há tabela de `audit_log`/`event_log` própria. Eventos derivam de:
- deployments (createdBy, createdAt, snapshots) → "quem aplicou, quando, resultado"
- session → "quem logou, quando"
- devices (lastSeenAt) → "quando o device conectou"
- pending_designations → "designações"
- hawkBit actions/status (via status-trail) → "download/install events"
**Conclusão:** 🟡 **PARCIAL.** Eventos existem espalhados; falta um endpoint agregado de "audit feed" + export. Confiança ALTA.

---

## RESUMO DE CLASSIFICAÇÃO

| # | Requisito | Status | Ação |
|---|---|---|---|
| 1 | Cadastrar device por serial | ✅ agora | usar POST /api/devices/provision |
| 2 | Listar/filtrar/buscar devices | ✅ agora | getAllDevices + filtro client-side |
| 3 | Ordenar (last-seen/added) | 🟡 parcial | client-side; last-deploy precisa query nova |
| 4 | Usuários logados | 🔴 API nova | criar GET /api/admin/sessions (dados existem) |
| 5 | Categorias por company | 🟡 parcial | criar GET /api/admin/categories OU N chamadas |
| 6 | Precadastro company + gestão users | ✅ agora | usar rotas companies/members/designations |
| 7 | Observabilidade + export | 🟡 parcial | dados existem; export no dashboard (client); relatório agregado = API nova |
| 8 | Demais relatórios eventos | 🟡 parcial | criar audit feed agregado + export |

### Trabalho futuro na API (endpoint novos — plano separado)
1. `GET /api/admin/sessions` — usuários logados agora (+ JOIN user).
2. `GET /api/admin/categories` — categorias agregadas cross-company.
3. `GET /api/admin/devices?company=&serial=&sort=` — lista paginada/filtrada (se volume crescer).
4. `GET /api/admin/reports/audit-feed` — timeline agregada de eventos (deploy + session + designation).
5. `GET /api/admin/reports/deployments/export` (opcional) — export server-side (se client não bastar).
6. Campo/ordenção "last deploy" no device (JOIN deployments.targetIds).

### O dashboard faz agora (client-side, sem mexer na API)
1. ✅ Provisionar device (requisito 1).
2. ✅ Listar/buscar/filtrar/ordenar devices por serial/company/lastSeen/createdAt (requisito 2, 3 parcial).
3. ✅ Precadastro company + designar + gestão membros (requisito 6).
4. ✅ Visualizar snapshots de deployment + status-trail por device (observabilidade de dados, requisito 7).
5. ✅ Export PDF/Excel no browser (lib jsPDF/SheetJS) dos dados que já têm endpoint.
6. 🟡 Categorias por empresa (via N chamadas até criar endpoint agregado).
7. 🔴 Usuários logados: **placeholder "em breve"** até criar /api/admin/sessions.
