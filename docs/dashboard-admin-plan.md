# Plano Final: Dashboard Admin Next.js — branch `feat/admin-dashboard`

> **Status:** ⏳ AGUARDANDO APROVAÇÃO — nada implementado.
> **Pesquisa completa** (8 requisitos × código real): `docs/_progress/dashboard-research-notes.md`.

---

## 0. Resumo executivo — o que dá pra fazer AGORA vs. futuro

Investiguei cada um dos seus 8 requisitos contra o código real da API. **3 já estão
prontos, 3 são parciais (faz no dashboard), 2 precisam de endpoint novo na API.**

| # | Requisito | Status | Como |
|---|---|---|---|
| 1 | Cadastrar device por serial | ✅ **AGORA** | `POST /api/devices/provision` |
| 2 | Listar/buscar/filtrar devices (serial, company) | ✅ **AGORA** | `GET /api/admin/devices` + filtro client-side |
| 3 | Ordenar por last-seen / last-added / last-deploy | 🟡 **2 de 3 agora** | last-seen/added = client-side; last-deploy precisa query nova (§Futuro) |
| 4 | Visualizar usuários logados | 🔴 **PRECISA API** | tabela `session` existe, falta endpoint `GET /api/admin/sessions` |
| 5 | Filtros (categorias) por company | 🟡 **PARCIAL** | via N chamadas `/api/companies/:id/categories`; ideal: endpoint agregado (§Futuro) |
| 6 | Precadastro company + atribuir/remover users + gerenciar | ✅ **AGORA** | `POST /api/companies` + members + designations + suspend |
| 7 | Observabilidade (download, success/falha, quem aplicou) + export | 🟡 **DADOS AGORA, EXPORT NO DASHBOARD** | status-trail + createdBy existem; PDF/Excel no browser |
| 8 | Demais relatórios de eventos | 🟡 **PARCIAL** | eventos existem espalhados; falta audit-feed agregado (§Futuro) |

---

## 1. O que o dashboard entrega NA FASE 1 (sem mexer na API)

Todas essas funcionalidades usam **endpoints que já existem** — nada por baixo dos panos:

### 📱 Dispositivos (requisitos 1, 2, 3-parcial)
- **Cadastrar novo device** por número de série → `POST /api/devices/provision { serialNumber, deviceKey, name }`.
- **Listar TODOS os devices** (tabela + blocos) com: serial, serialDisplay, status, connectionStatus, empresa, lastSeenAt, createdAt.
- **Busca** por número de série (texto livre, client-side).
- **Filtro** por empresa (dropdown).
- **Ordenação**: last-seen, last-added (client-side). *(last-deploy: §2 Futuro)*

### 🏢 Empresas + onboarding (requisito 6)
- **Precadastrar empresa** + designar owner por email → `POST /api/companies { name, ownerEmail }`.
- **Atribuir membros** → `POST /api/companies/:id/members`.
- **Promover/rebaixar role** → `PUT /api/companies/:id/members/:userId`.
- **Remover membro** → `DELETE /api/companies/:id/members/:userId`.
- **Designar por email (pendente)** → `POST /api/companies/:id/designations`.
- **Cancelar designação** → `DELETE /api/companies/:id/designations/:id`.
- **Suspender/ativar empresa** → `PUT /api/admin/companies/:id/status`.
- **Ver pendências** → `GET /api/admin/pending-designations`.

### 📊 Observabilidade de deployment (requisito 7 — dados)
- **Quem aplicou a atualização**: `deployments.createdBy` (FK user) — já vem no deployment.
- **Data/hora que baixou + success/falha**: `GET /api/companies/:id/deployments/:dsId/targets/:targetId/status-trail` → timeline completa (downloading → downloaded → installing → installed/error, com progress e reportedAt).
- **Quando o device "logou na rede"**: `devices.lastSeenAt`.
- **Snapshot histórico canônico**: `deployments.targetStatusSnapshot` (preserva status final mesmo após cancel).

### 📤 Export PDF/Excel (requisito 7 — feito no dashboard)
- **Geração no browser** (Next.js client-side) com **jsPDF** (PDF) e **SheetJS/xlsx** (Excel).
- Dados vindos dos endpoints acima (devices, deployments, status-trail).
- Colunas exportáveis: device, serial, data/hora login rede (lastSeenAt), data/hora download, success/falha, quem aplicou (createdBy), versão artifact.
- **Não pesa a API** — só le os dados que já existem.

### 👥 Usuários (parcial — requisito 4, 5)
- **Listar todos usuários** (com isSuperAdmin, companyCount) → `GET /api/admin/users`.
- **Categorias por empresa** → via chamadas a `/api/companies/:id/categories` por empresa (funciona; ideal é endpoint agregado §Futuro).

---

## 2. 🔴 Plano de trabalho futuro na API (endpoints novos — outro escopo)

Estes **NÃO bloqueiam a Fase 1 do dashboard**, mas são necessários para fechar 100% dos
seus requisitos. Crio como **roadmap documentado** (plano separado), para implementar
depois (ou em paralelo, se preferir):

### F-A. `GET /api/admin/sessions` — usuários logados agora (requisito 4)
- **Gap:** tabela `session` existe (`expiresAt`, `ipAddress`, `userAgent`, `userId`), mas
  não há rota que liste sessions ativas.
- **Trabalho:** 1 endpoint admin + JOIN user (sessions WHERE expiresAt > NOW()).
- **Pequeno (~1h).** Dá pra incluir na Fase 1 da API se quiser.

### F-B. `GET /api/admin/categories` — categorias agregadas cross-company (requisito 5)
- **Gap:** categorias só listam por empresa. Admin quer visão agregada.
- **Trabalho:** 1 endpoint + JOIN companies (conta devices por categoria).
- **Pequeno.** Alternativa imediata: dashboard faz N chamadas (1 por empresa).

### F-C. Ordenação "last deploy" no device (requisito 3)
- **Gap:** não há campo "último deploy" no device. Precisa JOIN com `deployments.targetIds` (JSONB contém controllerId).
- **Trabalho:** query nova em `getAllDevices` OU campo denormalizado `lastDeployedAt` atualizado em `createDeployment`.
- **Médio.**

### F-D. `GET /api/admin/reports/audit-feed` — timeline agregada de eventos (requisito 8)
- **Gap:** eventos estão espalhados (deployments, sessions, designations). Falta um "feed" unificado.
- **Trabalho:** endpoint que UNION de eventos (deploy created, session created, designation created, device provisioned) ordenado por timestamp.
- **Médio.** (opcional: pode começar com tabs separadas no dashboard).

### F-E. (Opcional) Export server-side
- Se o client-side (jsPDF/SheetJS) não bastar (relatórios muito grandes, cron jobs), criar endpoints de export no servidor.
- **Não recomendado p/ MVP** — client resolve.

> **Recomendação:** Fase 1 do dashboard usa só endpoints existentes. **F-A e F-B são
> pequenos** — posso implementá-los na API **antes** da Fase 1 do dashboard se você quiser
> (aí requisitos 4 e 5 fecham 100%). F-C/F-D ficam p/ iteração seguinte.

---

## 3. Arquitetura (mantém — confirmada pela pesquisa)

```
Browser → ninbus.frt.com.br/admin/api/*  (same-origin, cookie session)
       → Next.js Route Handler (proxy — repassa Cookie)
       → http://api:8081/api/*  (service name interno do compose)
       → Ninbus API (Better Auth + guard superAdmin + DB Neon + hawkBit)
```
- **Tudo via API**, nada por fora.
- Cookie cross-origin resolvido pelo proxy (não mexo no auth central).
- Comunicação interna `http://api:8081` (DNS do compose).

## 4. Branch + estrutura (mantém)

```
git checkout -b feat/admin-dashboard   (de release/hawkbit-api)
Ninbus-api/
├── src/                          ← API INTACTA (+ F-A/F-B se aprovar)
├── docker-compose.yml            ← + serviço dashboard (porta interna 3001)
├── docker/nginx/...              ← vhost: location /admin/ → dashboard:3001
└── apps/dashboard/               ← Next.js (basePath '/admin')
    ├── app/(admin)/
    │   ├── devices/              ← listar, filtrar, ordenar, provisionar, export
    │   ├── companies/            ← CRUD + precadastro + members + designations
    │   ├── users/                ← lista (logados: depende de F-A)
    │   ├── categories/           ← por empresa (agregado depende de F-B)
    │   ├── deployments/          ← observabilidade (status-trail, snapshots)
    │   └── reports/              ← export PDF/Excel (client-side)
    ├── app/api/[...path]/route.ts ← proxy → api:8081
    ├── lib/auth.ts, lib/api.ts, lib/export.ts (jsPDF + SheetJS)
    └── middleware.ts             ← guard isSuperAdmin
```

## 5. Testes locais (docker compose + Neon)

Checklist por requisito (validação local via `/etc/hosts` → `http://ninbus.frt.com.br/admin`):
1. Login admin (cookie) + não-admin bloqueado (403).
2. **R1:** provisionar device por serial → 201; serial duplicado → 409.
3. **R2:** buscar device por serial → filtra; filtrar por empresa → filtra.
4. **R3:** ordenar por last-seen / last-added → ordena.
5. **R6:** criar empresa + designar owner → ver pendente; add membro; promover; remover; suspender empresa.
6. **R7:** abrir deployment → ver status-trail (download/install/success/falha + timestamps); ver createdBy; exportar PDF/Excel.
7. **Interno:** `docker exec ninbus-dashboard wget -qO- http://api:8081/health` → 200.

---

## 6. Cronograma (após aprovação)

| Fase | O quê | Commit |
|---|---|---|
| 0 | Branch `feat/admin-dashboard` | sim |
| 1 | Monorepo + scaffold Next.js + TailAdmin + proxy + auth + guard | sim |
| 2 | **Devices**: lista + busca + filtro + ordenar + provisionar | sim |
| 3 | **Companies**: CRUD + precadastro + members + designations + suspend | sim |
| 4 | **Observabilidade**: deployments + status-trail + snapshots | sim |
| 5 | **Export**: PDF (jsPDF) + Excel (SheetJS) no dashboard | sim |
| 6 | Users + Categories (com o que existe; logados depende de F-A) | sim |
| 7 | Docker (service dashboard + nginx `/admin`) + testes locais | sim |

**Commit por fase** — não deixo trabalho sem commit. Progresso em `docs/_progress/dashboard-impl-log.md`.

---

## 7. Decisões que preciso (últimas)

1. **F-A e F-B (API) agora ou depois?**
   - **(a) Agora** → fecho requisitos 4 (logados) e 5 (categorias agregadas) 100% na Fase 1.
     Trabalho ~2h na API antes do dashboard.
   - **(b) Depois** → dashboard mostra "em breve" nas telas de logados/categorias agregadas;
     implemento F-A/F-B em iteração seguinte.
   - **Recomendo (a)** — é pouco trabalho e fecha mais requisitos.

2. **Template:** TailAdmin FREE (login mock a integrar) ou shadcn/ui?

3. **Aprova o escopo da Fase 1** (requisitos 1, 2, 3-parcial, 6, 7-dados, 7-export no §1)?

Assim que você responder (especialmente #1 e #3), inicio pela **Fase 0** (branch) e sigo
até a Fase 7, commitando por fase.
```
