# Iteration 58 Analysis

**Phase**: completed
**Date**: 2026-10-22T18:12:19.533Z

## Results

### ✅ Functional Correctness

Builds limpos (API docker bun build; dashboard next build). Suíte completa 538/538 (24 arquivos, incl. matriz RBAC 7/7 e regressões). Funcional ao vivo no docker: endpoints role-policies, aba Permissões com PUT por célula aplicando/revertendo override, breadcrumb, labels novos. hawkBit e provisioning intocados e auditados (32/32).

**Evidence**: docker compose build api dashboard OK; health 200; live: role-policies GET/PUT 200 com override aplicado (members.manage:false → effective sem a capability) e reversão; enforcement drill 6/6 (observer lê 200/403 em criar; operator 201/403 em excluir; manager 200; super 200); arc-v2-audit 32/32 (8 rotas × 4 larguras, 0 erros console, redirects, badge Ao vivo)

### ✅ Code Quality

Rotas RBAC extraídas para src/modules/admin/rbac-routes.ts (admin/index.ts de 375→279 linhas). Comentários da iteração reduzidos a ≤1 linha/seção; documentação viva em docs/rbac-roles-and-permissions.md. auth-guard.ts (303) permanece acima de 250 — pré-existente, contém macros centrais; dívida registrada, não ampliada (split das macros seria refactor separado).

**Evidence**: wc -l: admin/index.ts 279, rbac-routes.ts 105, capabilities.ts 107, auth-guard.ts 303 (pré-existente, cresceu +20 p/ requireCapability+normalize). biome check nos 10+ arquivos da iteração: 0 findings

### ✅ Schema Organization

rbac-routes.ts importa ErrorResponseSchema e GenericActionResponseSchema de @common/schemas (re-export do padrão); params e body ficam locais (permitido para rotas simples); nenhuma response schema inline fora do padrão. t.Date() não aplicável (tabela nova sem timestamps em respostas).

**Evidence**: head rbac-routes.ts: imports ErrorResponseSchema/GenericActionResponseSchema de @common/schemas; body/params t.Object locais (rotas simples, conforme regra); response schemas importados

### ✅ Error Handling

RBAC não toca hawkBit (guards de 2 níveis intocados e testados na suíte). Erros de autorização padronizados: 401 login, 403 'Role insufficient' (companyRole) e 'Missing capability' (requireCapability), 400 em capability desconhecida no PUT. pino inalterado.

**Evidence**: drill: 403 {"Role 'observer' is insufficient. Minimum required: 'operator'"}; 403 role-policies para comum; PUT com capability inválida → 400 Unknown capability

### ✅ Test Coverage

Nova suíte tests/rbac-capabilities.test.ts (7): defaults por cargo, override grant/deny, company.delete negável, aliases legados, tabela mínima total, consistência dos conjuntos. +2 testes NEGATIVOS de hierarquia em companies.test.ts (regressão do bug real: mapa antigo deixava todos passarem). Base de testes Neon migrada (enum verificado).

**Evidence**: bun test: 538 pass / 0 fail / 994 expect calls em 24 arquivos; tests/rbac-capabilities.test.ts 7/7; tests/companies.test.ts 25/25 com 'observer is blocked on operator-required routes (403)' e 'manager passes where observer is blocked'

### ✅ Config Centralization

Nenhuma variável nova: papéis/capabilities são código-versionado (capabilities.ts), não configuração. SUPER_ADMIN_EMAILS existente reaproveitado. Os 3 hits fora de env.ts são comentário e scripts de build/teste (padrão pré-existente).

**Evidence**: grep process.env src: apenas env.ts + hawkbit.ts (comentário) + 2 scripts (migrate/sse-test, pré-existentes); SEM novas variáveis de ambiente nesta fase

### ✅ Security

Correção estrutural: hierarquia duplicada (auth-guard + company-guard) divergiu no renome — unificada nos nomes novos com aliases normalizando admin→manager/viewer→observer na entrada. Overrides por empresa editáveis apenas por super admin (macro superAdmin nos 2 endpoints). requireCapability resolve membership→policy→merge→403. Sem segredos em código; deviceKey nunca em DB (RBAC não altera).

**Evidence**: curl drill: comum → role-policies 403; global SSE 403 (F1); observer → categories POST 403, GET 200; operator → DELETE 403; manager → DELETE 200; super bypass 200; bug: ROLE_HIERARCHY antiga em auth-guard.ts dava undefined<level=false (qualquer cargo passava) — corrigido + testes de regressão

### ✅ 🔮 Futuro (Aprendizado Contínuo)

Princípio novo p-single-source-domain-maps (constantes de domínio com fonte única + testes negativos obrigatórios em RBAC) aprendido do bug real. SKILL.md atualizado (companyRole:'manager', requireCapability, aliases, link para a doc). Docs/ contém plano + doc final; planos de fases anteriores intactos.

**Evidence**: docs/rbac-roles-and-permissions.md (3027B: cargos, matriz 13×4, overrides, uso API, guia mobile p/ 403); SKILL.md seção Autorização agora lista 4 camadas + aliases; principle p-single-source-domain-maps registrado (164→165)

## Overall Notes

RBAC v2 completo (plano docs/rbac-roles-and-permissions-plan.md) executado nas 4 fases, validado ao vivo no docker. F1: SSE com wire correta (new Response(stream)) + superAdmin no global (comum=403); claim→SSE→revalidação sem reload confirmado no browser. F2: enum renomeado via migration 0025 RENAME VALUE (dados preservados; aplicada e verificada em dev/docker e test), company_role_policies, capabilities (13 chaves, matriz padrão, merge override, aliases legados), macros companyRole+requireCapability. F3: aba Permissões (matriz 4×13 tri-estado, PUT por célula, validada 14/14 em 4 larguras via browser), breadcrumb Arc-native sem dependência nova, labels Titular/Gestor/Operador/Observador, CompanyRole client. F4: docs/rbac-roles-and-permissions.md (matriz, overrides, guia mobile), cabeçalhos ≤1 linha, split rbac-routes.ts (admin/index 279 linhas), SKILL.md com 4 camadas de autorização. ACHADO CRÍTICO corrigido no caminho: ROLE_HIERARCHY duplicada em auth-guard.ts mantinha nomes antigos — undefined<level=false deixaria qualquer cargo passar em rotas manager+; corrigido, com 2 testes de regressão NEGATIVOS (observer→403) e drill ao vivo 6/6 (observer lê/403 cria; operator cria/403 exclui; manager exclui; super bypass). Final: 538/538 bun test (24 arquivos), tsc API com apenas erros pré-existentes (app.ts swagger, distribution-sets, scripts ec2), tsc dashboard limpo, biome limpo, docker api+dashboard rebuilt, arc-v2-audit 32/32, live badge OK. Pendências documentadas: usuários/dispositivos de drill (plain.user membership removida no cleanup; frt.arc.audit@ninbus.dev em SUPER_ADMIN_EMAILS do .env local para revisão — remover antes de produção), antiga Fase 2 API (paginação) aguarda aprovação. Sem commits nesta fase (working tree).