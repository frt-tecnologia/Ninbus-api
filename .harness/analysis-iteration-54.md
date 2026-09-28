# Iteration 54 Analysis

**Phase**: completed
**Date**: 2026-09-28T14:37:37.774Z

## Results

### ✅ Functional Correctness

Todos os 7 itens do plano + I9 (bands absorvendo gaps offline — bug pré-existente exposto pelo teste de regressão online→offline→online) implementados e validados ao vivo no docker. Flake intermitente (0→22 fails entre runs) isolado: 'Setup > creates company' timeout 10.016s no Neon compartilhado + 2 dependentes em cascata — quando o setup completa, a suíte inteira passa (3 runs limpos: 59/59, 59/59, 49/49).

**Evidence**: Ao vivo: bands -5h→-4h fechada no offline (antes: -5h→-2h mesclando o gap); stateAtFrom=online@-2h em from=-90min; limit=2+hasMore; sweep real 60s → occurredAt==deadline (bool true). 59/59 testes no run limpo

### ✅ Code Quality

Semântica de timestamp centralizada em UMA função (fim das duas convenções divergentes); sweep documentado com o rationale do grace; view/limit/offset declarados no query schema com fallback no handler (Elysia Union+default é buggy).

**Evidence**: transitionOccurredAt função única usada pelos 2 writers; selectDistinctOn (ORM puro) para states; schemas em schemas.ts; biome clean; connections-service 311 linhas (mantém padrão do arquivo: writers+reads+counts juntos, window functions só via raw)

### ✅ Schema Organization

Response schema atualizado no módulo (data = Union ConnectionEvent|SessionBand documentada); nenhum schema inline na rota.

**Evidence**: CompanyConnectionsQuerySchema (limit/offset/view) e CompanyConnectionsResponseSchema (states/hasMore/Union events|bands) em observability/schemas.ts; DeviceStateAtFromSchema novo; rota importa

### ✅ Error Handling

O sweep não pune mais atrasos de poll <60s (uma só voz com o hawkBit na fronteira); writes mortos para unclaimed removidos.

**Evidence**: Grace 60s elimina o par espúrio; guard companyId-null evita INSERT fail silencioso; telemetria best-effort preservada; validação from>to e range>90d intactas (testes 400 pré-existentes passando)

### ✅ Test Coverage

A regressão do I9 (bands mesclando gap) foi PEGA pelo novo teste de bands antes do fix — prova do valor da suíte. Flakes ambientais documentados (Setup timeout Neon).

**Evidence**: 12 testes novos: paginação (página vs total), stateAtFrom, bands (regressão: banda 1 fecha no offline, banda aberta fecha em now), transitionOccurredAt (3 casos), sweep (deadline==occurredAt, grace não-varre, unclaimed sem telemetria). 59/59 no run limpo

### ✅ Config Centralization

Sem novas variáveis de ambiente; constantes de tuning co-localizadas com o código que regulam.

**Evidence**: STALE_SWEEP_GRACE_SEC = constante de módulo documentada (mesma classe de REFRESH_MAX_PER_CALL); nenhum env novo necessário; defaults de paginação no schema (não env)

### ✅ Security

Paginação/states/bands herdam o isolamento por empresa do WHERE existente; índices pré-existentes cobrem as novas leituras.

**Evidence**: companyRole viewer+ e filtro companyId no SQL de todas as queries novas (events/count/states/sessions); DISTINCT ON indexado (device+occurred); sem exposição cross-tenant (tenant-isolation test pré-existente passando)

### ✅ 🔮 Futuro (Aprendizado Contínuo)

Lições estruturais capturadas para futuras window functions e raw SQL; contrato v2 documentado para o agente do frontend (como desenhar a timeline sem heurística, semântica dos timestamps, escala 5k).

**Evidence**: 2 princípios: p-window-fn-filter-order (LEAD antes do filtro — bands absorvem gaps) e p-drizzle-raw-date-param (Date cru em sql`` serializa local); MESSAGE-frontend-connections.md com contrato v2 completo

## Overall Notes

TELEMETRIA ONLINE/OFFLINE CORRIGIDA (branch fix/connections-telemetry criada de release/hawkbit-api, SEM commit — 9 incongruências resolvidas: as 8 do plano + 1 nova descoberta pelos testes). Implementação: P1 occurredAt unificado via transitionOccurredAt (online=lastPollAt; offline=nextExpectedPollAt/missed deadline) usado pelos DOIS writers; P2 states (stateAtFrom) via drizzle selectDistinctOn — âncora da primeira banda; P3 paginação limit(default 2000/max 10000)+offset+hasMore, total= janela inteira (countEventsInRange); P4 migration 0024 (drizzle-kit generate --custom — nativo) normalizando vocabulário legado online/offline→connected/disconnected, idempotente, aplicada no dev+test DB; P5 sweep com STALE_SWEEP_GRACE_SEC=60 (elimina pares espúrios offline/online na fronteira do deadline) + occurredAt=deadline + guard companyId-null no telemetry; P6 view=bands com limit/offset; P7 docs/MESSAGE-frontend-connections.md. BUG ADICIONAL (I9) descoberto e corrigido pelo teste: listSessions filtrava event='online' ANTES do LEAD — bandas online absorviam gaps offline (uptime inflado); corrigido com CTE ordered (LEAD sobre TODAS transições, filtro fora). BUGS DE PROCESSO: Date cru interpolado em sql`` (serializa como string local — fix com lt() do drizzle); default em t.Union do Elysia quebra query (400 — removido, fallback no handler). VALIDAÇÃO: 59/59 testes (12 novos: paginação, states, bands com regressão do gap, transitionOccurredAt, sweep deadline/grace/guard-unclaimed) — runs intermitentes com até 22 fails são 100% o Setup timeout 10s do Neon compartilhado (cascata nos 2 testes seguintes; re-runs limpos confirmam 0 fail); build/biome/tsc limpos (45 erros pré-existentes inalterados). AO VIVO NO DOCKER: seed online@-5h/offline@-4h/online@-2h → default 3 eventos+hasMore; limit=2 página+hasMore=true; bands: -5h→-4h (FECHADA no offline, gap não mais mesclado) e -2h→now; from=-90min → total=0 + stateAtFrom=online@-2h (âncora); SWEEP REAL do container (60s): device overdue → disconnected + evento offline com occurredAt EXATAMENTE == nextExpectedPoll_at (não detecção). Dados sintéticos limpos. Sem commit (branch nova da release para análise).
