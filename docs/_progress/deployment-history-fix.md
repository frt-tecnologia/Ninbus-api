# Deployment History Fix — Notas de Progresso e Hipóteses

**Iniciado:** 2026-06-19
**Objetivo:** Garantir que o histórico de deployments retorne dispositivos + versão + info de atualização de forma consistente e otimizada para o frontend, e corrigir o fluxo de reset de senha (Resend).

---

## Ambiente Docker local (validado)
- `ninbus-api` :8081 (healthy)
- `hawkbit` :8080 (starting → healthy)
- `HAWKBIT_URL=http://hawkbit:8080` (service name)
- `BETTER_AUTH_URL=http://localhost:8081` ⚠️ aponta para a API, não frontend
- `EMAIL_FROM="Ninbus <noreply@resend.dev>"` ⚠️ domínio sandbox Resend (só envia p/ verificados)
- `RESEND_API_KEY=re_TEwEh...` (preenchido)

---

## Hipóteses (com níveis de confiança)

### H1: Lista de dispositivos vazia em deployments antigos
**Confiança: 95%**
`getAssignedTargets(dsId)` retorna só targets cuja atribuição ATUAL é o DS.
Quando um target recebe novo deployment, migra → DS antigo para de listá-lo.
A lista histórica correta existe em `deployments.target_ids` (banco local) mas nenhum endpoint a usa.

### H2: Version inconsistente
**Confiança: 90%**
- `enrichDeployment` (DS vivo): `version = ds.version = 'v-${Date.now()}'` (interno), **sem** artifactVersion
- `enrichOrphanedDeployment` (DS deletado): tem `artifactVersion` (real), **sem** version
→ frontend vê version em alguns e não em outros.

### H3: Status "1 de N não atualizou" retorna 'pending'/'failed', nunca 'completed'
**Confiança: 85%**
`computeDeploymentStatus`: só 'completed' quando `finished === total`. Sem agregar "quase completo".

### H4: trail.ts busca ação mais recente do target sem filtrar por DS
**Confiança: 90%**
`getDeploymentTargetStatuses` (trail.ts:65-78): `actions.content.find(a => a.type === 'update')` — pega a mais recente, mesmo que seja de outro DS.

### H5: Resend falha silenciosamente
**Confiança: 95%**
`sendEmail` try/catch só loga, nunca lança. `sendResetPassword` conclui. Endpoint devolve 200.

### H6: Link de reset aponta para API não frontend
**Confiança: 95%** (confirmado via BETTER_AUTH_URL)
Não existe FRONTEND_URL no projeto.

### H7: EMAIL_FROM sandbox → envios reais falham
**Confiança: 80%**
resend.dev é sandbox. Falha 403/400 mas erro é engolido (H5).

---

## Plano de Ação (execução)

### Fase 0 — Validação no Docker (ANTES de mexer no código)
- [ ] Confirmar estado real dos DSes/targets no hawkBit
- [ ] Confirmar dados no banco local (`deployments` table)
- [ ] Reproduzir o bug chamando os endpoints reais
- [ ] Validar H1, H2, H3, H4 contra dados reais

### Fase 1 — Refatorar enrichment para mesclar banco local (H1, H2, H4)
- [ ] `enrichDeployment` recebe/consulta registro local por `hawkbitDsId`
- [ ] Popular `targetIds`, `targetCount`, `artifactName`, `artifactVersion` do banco
- [ ] Padronizar `version` = `artifactVersion` (ou remover `version` interno)
- [ ] `enrichOrphanedDeployment` também retorna o mesmo shape

### Fase 2 — Endpoint de dispositivos históricos (H1, H4)
- [ ] `getDeploymentTargetStatuses`: resolver devices de `deployments.target_ids` (banco) em vez de `getAssignedTargets`
- [ ] Para cada target, buscar ação do DS específico (não a mais recente genérica)
- [ ] Retornar lista de dispositivos com info de cada um

### Fase 3 — Status agregado (H3)
- [ ] Adicionar info suficiente para frontend ver "quase completo" (summary já tem finished/total)
- [ ] Considerar `'completed_with_errors'` ou deixar explícito via summary

### Fase 4 — Resend / reset de senha (H5, H6, H7)
- [ ] `sendEmail` propagar falhas críticas (throw em produção)
- [ ] Adicionar `FRONTEND_URL` ao env.ts + .env.example + .env.test
- [ ] `sendResetPassword` construir link `${FRONTEND_URL}/reset-password?token=...`
- [ ] Validar envio real de email no Docker

### Fase 5 — Validação no Docker (DEPOIS de mexer no código)
- [ ] Rebuild da imagem API
- [ ] Chamar endpoints, comparar antes/depois
- [ ] Testar reset de senha ponta-a-ponta

### Fase 6 — Testes automatizados
- [ ] Ajustar/aumentar testes para cobrir os novos comportamentos

---

## Log de execução

### ✅ Fase 0a — Infraestrutura hawkBit RESOLVIDA (descoberta crítica)
**Problema raiz (bloqueador):** hawkBit em loop de restart (81 restarts) — nunca subiu.
Causa encadeada:
1. hawkBit e Ninbus compartilham o MESMO banco Neon cloud (`neondb`) e MESMA role (`neondb_owner`).
2. hawkBit compartilha o schema `public` com Ninbus → Flyway faz `baselineOnMigrate` nas tabelas do Ninbus e **nunca cria as tabelas do hawkBit** (sp_lock, target_*, etc).
3. Banco usava PgBouncer **transaction pooling** (Neon `-pooler`) → `currentSchema` na URL JDBC é resetado entre transações → Spring Integration lockRepository não encontra `SP_LOCK`.

**Solução aplicada (docker-compose.yml + ALTER ROLE):**
- `SPRING_FLYWAY_BASELINE_ON_MIGRATE=true` + `SPRING_FLYWAY_BASELINE_VERSION=0` → força Flyway a criar as 29 tabelas `sp_*` no `public` (nomes NÃO colidem com Ninbus).
- `SPRING_DATASOURCE_URL=...&currentSchema=public` → belt-and-suspenders para novas conexões físicas.
- `ALTER ROLE neondb_owner IN DATABASE neondb SET search_path TO public` → garantido contra reset do PgBouncer (GUC de role é reaplicado a cada backend).

**Resultado:** hawkBit **healthy**, todos os endpoints 200. Banco tinha 0 deployments (vazio).

### ✅ Fase 0b — Bug REPRODUZIDO e CORRIGIDO
Cenário criado: DS4 assigna 3 targets (DEV1,2,3); DS5 assigna só DEV1 (migra DEV1).

**ANTES (bug confirmado):**
- `GET /deployments/4/target-statuses` → só **2 targets** (DEV1 sumiu p/ DS5)
- `version: "v-1781981079402"` (timestamp interno); `artifactVersion`/`artifactName` AUSENTES

**DEPOIS (corrigido):**
- `GET /deployments/4/target-statuses` → **3 targets** (DEV1 mostra `phase: canceled` — correto, foi re-atribuído)
- `version: "2.1.0"` (semântica); `artifactVersion`, `artifactName`, `targetCount` sempre presentes

**Arquivos alterados:**
- `src/common/hawkbit/targets.ts` — `getActions` agora aceita filtro `q` RSQL
- `src/modules/deployments/enrichment.ts` — `enrichDeployment(ds, local?)` mescla dados do banco; `LocalDeploymentRecord` type exportado; `parseTargetIds` helper; orphaned padronizado
- `src/modules/deployments/schemas.ts` — `EnrichedDistributionSetSchema` + `targetIds`
- `src/modules/deployments/service.ts` — `listDeployments` e `getDeployment` passam registro local; nova `getLocalDeployment`
- `src/modules/deployments/trail.ts` — `getDeploymentTargetStatuses` usa `target_ids` do banco + filtro `distributionSet.id=={dsId}` (action correta por DS)

### 🔄 Fase 4 — Resend / reset de senha (em andamento)

### ✅ Fase 4 — Resend / reset de senha — CONCLUÍDO
**Descobertas:**
- Resend ESTÁ funcionando: confirmado `"Email sent via Resend" id: d9721cb9-...` para email autorizado.
- Problema real era o domínio `resend.dev` (sandbox) que SÓ entrega para o email da conta proprietária (`luiz.eduardo@frt.com.br`). Para outros recipients → 403 validation_error.
- **Limitação do Better Auth (intransponível sem fork):** `runInBackgroundOrAwait()` (create-context.mjs:174) envolve sendResetPassword em try/catch e só LOGA — nunca propaga o erro ao response HTTP. O endpoint SEMPRE retorna 200 (anti-enumeration by design). Logo, try/catch no handler NÃO dispara.

**Correções aplicadas:**
- `src/common/config/email.ts` — reescrito: `EmailSendError` class; `sendEmail({required})` lança em produção ou quando `required:true`; logs claros com detalhes do erro Resend.
- `src/common/config/auth.ts` — `buildFrontendLink()` reescreve o link para `${FRONTEND_URL}/{path}?token=...` (era BETTER_AUTH_URL → apontava para a API). `sendResetPassword`/`sendVerificationEmail` marcados `required: true`.
- `src/modules/auth/index.ts` — handler do `/request-password-reset` com try/catch defensivo → 502 se o erro propagar (defensive; funciona se Better Auth mudar).
- `FRONTEND_URL` adicionado a: env.ts (schema), .env.example, .env.test, .env (local), docker-compose.yml.

**Ação recomendada ao Luiz:** verificar um domínio em resend.com/domains (ou trocar `EMAIL_FROM` para um domínio próprio verificado) para poder enviar resets para qualquer recipient.

### ✅ Fase 5 — Validação final no Docker — CONCLUÍDO
API rebuilt (`docker compose build api`). Validado via HTTP real com sessão autenticada:
- `GET /deployments`: cada item traz `version` (semântica), `artifactVersion`, `artifactName`, `targetCount`, `targetIds` (lista histórica completa).
- `GET /deployments/4/target-statuses`: retorna **3 targets** (antes: 2). DEV0001 mostra `phase: canceled` (correto — foi re-atribuído ao DS5). Action específica por DS via RSQL `distributionSet.id=={dsId}`.
- hawkBit + API ambos **healthy**.

### ✅ Fase 6 — Testes automatizados — CONCLUÍDO
- `src/modules/deployments/enrichment.test.ts` (NOVO, 17 testes): enrichOrphanedDeployment + enrichDeployment(local) — cobre version semântica, targetIds, parse defensivo (null/malformed/non-array/filter), fallbacks, status completed/unknown.
- `src/common/config/email.test.ts` (NOVO, 5 testes): EmailSendError em required+error, required+throw, dev best-effort, mensagem inclui erro Resend. (mock via globalThis + env.RESEND_API_KEY monkey-patch — `mock.module` closure não funciona no Bun).
- Suite completa: **93 unit tests pass / 0 fail** (71 pré-existentes + 17 + 5). Os 28 testes E2E que falham em `tests/*.test.ts` são PRÉ-EXISTENTES (confirmado via git stash: falham no código original também; precisam de ambiente E2E específico).

---
## RESUMO EXECUTIVO FINAL

| Item | Status | Como validar |
|------|--------|------|
| H1 dispositivos vazios | ✅ corrigido | `GET /deployments/{id}/target-statuses` retorna lista histórica completa do `deployments.target_ids` |
| H2 version inconsistente | ✅ corrigido | `version` = artifactVersion (semântica) sempre que há registro local |
| H3 status confuso | ✅ mitigado | `statistics.finished/total/canceled` sempre presente; `pending:2,canceled:1` no exemplo de DS4 |
| H4 action errada | ✅ corrigido | filtro `distributionSet.id=={dsId}` pega a action correta por DS |
| H5 Resend silencioso | ⚠️ parcial | logs claros; limitação Better Auth (sempre 200). Diagnóstico via log. |
| H6 link p/ API não frontend | ✅ corrigido | `FRONTEND_URL` reescreve o link do email |
| H7 domínio sandbox | ℹ️ config | verificar domínio em resend.com/domains |
| hawkBit nunca subia | ✅ corrigido | baseline flyway + ALTER ROLE search_path |

**Arquivos alterados (12):** env.ts, email.ts, auth.ts, auth/index.ts, hawkbit/targets.ts, deployments/{enrichment,schemas,service,trail}.ts, docker-compose.yml, .env.example, .env.test (+ 2 novos testes).
