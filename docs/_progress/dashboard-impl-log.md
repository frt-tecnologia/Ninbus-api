# Dashboard Implementation Log (rastreabilidade)

> Branch: `feat/admin-dashboard`. Commit por fase. Progresso rastreado aqui.

## Fase 0 — Branch ✅
- [x] Criada `feat/admin-dashboard` a partir de `release/hawkbit-api`.

## Fase 1 — Monorepo + scaffold + auth + guard ✅
- [x] `apps/dashboard/` criado com estrutura DDD/Clean (app/components/lib/hooks/types).
- [x] `package.json`, `next.config.ts` (basePath '/admin', standalone), tsconfig, tailwind.
- [x] **Proxy Route Handler** (`app/api/[...path]/route.ts`) → toda comunicação via API (service name `http://api:8081`).
- [x] **Domain types** (`types/domain.ts`) espelhando schemas da API (Company, User, Device, Deployment, etc.).
- [x] **API clients** por domínio (`lib/api/{http,companies,devices,members,users,deployments}.ts`).
- [x] **Auth** (`lib/auth/{client,session}.ts`) — Better Auth client + guard server-side `requireAdmin`.
- [x] **Utils** (cn, date pt-BR, status→badge).
- [x] **Export** (jsPDF + SheetJS client-side).
- [x] **UI components** (Button, Input, Badge, Card, Modal, State/Spinner/Error/Empty).
- [x] **DataTable** genérica + SearchToolbar (sort/filter client-side).
- [x] **Layout** (Sidebar, PageHeader) + admin layout com guard.
- [x] **Página de login** (todos os casos: credencial inválida, forbidden, loading).
- [x] **Overview** (cards de contagem).
- [x] **Middleware** (cookie check).

## Fase 2 — Dispositivos ✅
- [x] `DevicesTable` (listar, buscar por serial/nome, filtrar por empresa, ordenar last-seen/created).
- [x] `ProvisionDeviceDialog` (cadastrar por serial — trata 409 conflito).
- [x] Export PDF/Excel dos devices filtrados.

## Fase 3 — Empresas ✅
- [x] `CompaniesTable` (CRUD + precadastro + suspend/ativar + excluir).
- [x] `CreateCompanyDialog` (nome + ownerEmail → designa owner / pendência).
- [x] Confirm dialogs para ações destrutivas.

## Fase 4 — Observabilidade (parcial) ✅
- [x] Deployments page (seleção de empresa + lista com status agregado por device).
- [ ] Timeline detalhada por device (status-trail) — próxima iteração.

## Fase 5 — Export ✅
- [x] PDF (jsPDF) e Excel (SheetJS) implementados no devices (extensível a outros).

## Fase 6 — Outras telas ✅
- [x] Users (read-only, com isSuperAdmin badge).
- [x] Designations (pendentes + cancelar).

## Fase 7 — Docker + nginx + testes locais
- [x] `apps/dashboard/Dockerfile` (multi-stage standalone ~120MB).
- [x] `docker-compose.yml` serviço `dashboard` (porta interna 3001, não publica host).
- [x] nginx vhost `ninbus.frt.com.br` → `location /admin/ → dashboard:3001`.
- [ ] Testes locais (docker compose up + login + CRUD) — **PRÓXIMO**.

## Validações pendentes (próximo turno)
- [ ] `docker compose build dashboard` sem erro.
- [ ] Login admin (cookie) → redirect /admin/overview.
- [ ] Não-admin → redirect login?error=forbidden.
- [ ] CRUD devices/companies/deployments funcional.
- [ ] `docker exec ninbus-dashboard wget -qO- http://api:8081/health` → 200.

## Trabalho futuro na API (roadmap — não bloqueia Fase 1)
- F-A: `GET /api/admin/sessions` (usuários logados).
- F-B: `GET /api/admin/categories` (categorias agregadas).
- F-C: ordenação "last deploy" no device.
- F-D: `GET /api/admin/reports/audit-feed`.
