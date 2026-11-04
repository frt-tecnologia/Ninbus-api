# Plano — Gestão de Polling Global via Dashboard + Correções de Segurança Aprovadas

> **Iteração 59 · EXECUTADO (v2) — resultado abaixo.**
> Aprovação do usuário: polling GLOBAL editável no dashboard, somente super admin;
> limites 5s–24h; S1–S3 confirmados. Diretrizes atendidas: indicação de online
> intacta (comprovada em drill vivo), análise sistemática, testes, mudança mínima.

---

## Resultado da execução (2026-11-04)

**Commits (branch `fix/connection-pass`, sem push):**
`59af2fd` S1 rate-limit XFF · `52f7960` S2 portas · `47bf942` S3 .drill ·
`2aad988` teste postura compose · `3a06bb1` fix migrator (0025 abortava o loop;
0026 nunca aplicaria) · `584d936` feature polling.

**Drill vivo (docker, simulador DDI com TargetToken, SSE conectado na company):**
| Cenário | Resultado |
|---|---|
| A — default 5s | online no 1º poll observado; offline backdated a lastPoll+5s exato após grace do tenant |
| B — PUT 30s com device pollando a 5s | **sem flap** (permaneceu online); offline posterior backdated a lastPoll+30s EXATO — a expectativa do dashboard governa |
| C — ciclo completo com SSE ao vivo | exatamente 1 `connected` + 1 `disconnected` entregues, zero duplicatas pass×enrichment; 6 eventos em 3 ciclos limpos |
| D — restart da API | override sobreviveu e foi RE-EMPURRADO (hawkBit contaminado com 60s voltou a 00:00:30 no boot) |

**Descoberta do drill:** `pollingOverdueTime` do tenant = 00:05:00 (grace do
hawkBit) — a detecção de offline é deadline + grace + 1 tick (~5min com os
valores atuais). É knob do hawkBit, não nosso; documentado no SKILL.md.

**Validação estática:** suíte 564/567 (2 flakes de timeout no Neon — vizinhos
passando com 2.7–3.8s; retestes pontuais verdes; 1 fail era o teste da era TLS
exigindo a porta 8081 — atualizado para a postura S2). tsc/biome limpos nos
arquivos tocados. Build bun OK. Migration 0026 aplicada em dev+test (prod no
deploy, processo dos 3 bancos). nginx local: resolvido pós-drill com cert
autoassinado no mesmo path (`scripts/gen-local-certs.sh`, seção 14 do doc do
nginx) — drill anterior feito via shim direto.

---

## PARTE 1 — Fatos verificados (evidência, não hipótese)

Verificação nos **binários do hawkBit 1.0.3** (imagem local, jars extraídos):

| # | Fato | Evidência |
|---|------|-----------|
| V1 | Não existe polling por target no hawkBit 1.0.3 — expectativa deriva do config do TENANT (`pollingTime` clampado por min/max) | `JpaControllerManagement` + `JpaTarget.getPollStatus()` via `TenantConfigurationManagement` |
| V2 | O servidor não dita quando o device polla (DDI root sem hint de poll/sleep) | `DdiRootController` sem referências |
| V3 | Knob existente: system config global `PUT /rest/v1/system/configs/pollingTime` (JSON `{"value":"HH:MM:SS"}`) — **já usado pelo startup** | `system-config.ts` em produção |

Com escopo global, o mecanismo hawkBit existente é **suficiente e exato** — nenhuma
inferência local nova, nenhum schema por device. O valor global `pollingTime` do
hawkBit continua sendo a ÚNICA voz do online/offline (doutrina Single Voice preservada).

## PARTE 2 — Correções de segurança APROVADAS (S1–S3)

Excluídos (rationale do usuário): creds hawkBit (local-only), Swagger (basic auth nginx),
verificação de signup (futuro, exige UX no app).

### S1 — Rate limit: fim do bypass por `X-Forwarded-For` (ALTA)
- nginx: `proxy_set_header X-Forwarded-For $remote_addr` (sobrescreve em TODOS os proxies).
- API: `getClientIP` lê o **último** item do XFF → `X-Real-IP` → `'unknown'`.
- Testes: unitários (cadeia spoofada/1 item/ausente) + integração (XFF rotativo, mesmo IP → 429).
- Aceite: login brute-force limitado pelo authRateLimit com IP real.

### S2 — Publicação de portas: prod expõe apenas o ingress nginx
- Base `docker-compose.yml` publica só 80/443/8080; **`docker-compose.dev.yml`** (novo)
  adiciona 8081 (API) e 3001 (dashboard) para dev local.
- Checklist de regressão (nada pode quebrar): `client_max_body_size` no vhost da API
  (uploads via nginx), SSE (buffering off), ACME no :80, healthchecks internos.
- Aceite: `docker compose config` (modo prod) sem 8081/3001; drill login+upload+SSE+DDI.

### S3 — `.drill/` fora do git
- `git rm -r --cached .drill/` + `.gitignore`. Cookie de sessão dev deixa de ser rastreado.

## PARTE 3 — Feature: polling global editável no dashboard (superAdmin)

### Decisão de design (mínima alteração, aderente)

- **Fonte da verdade do valor em runtime**: nova tabela minúscula `platform_settings`
  (KV: `key` PK, `value` text, `updated_by`, `updated_at`). Uma chave:
  `hawkbit_polling_time` (valor em **segundos**, ex. `"5"`).
- **`HAWKBIT_POLLING_TIME` (.env) vira DEFAULT DE BOOTSTRAP**: usado só quando não
  existe override na tabela. Nenhuma variável nova no env (config net-zero).
- **Aplicação**: o mesmo PUT que o startup já faz (`applyPollingTimeConfig`), fatorado
  para receber valor por parâmetro. PUT do dashboard = grava DB **e** empurra ao hawkBit.
- **Startup (sync.ts)**: lê override → se existe, empurra o valor da tabela; senão,
  empurra o .env. Restart nunca regredir uma edição do dashboard (fim do drift).
- **Ordem de escrita**: valida → empurra ao hawkBit → persiste no DB; se o push falhar,
  nada persiste (503) → DB e hawkBit nunca divergem. Se persistir falhar após push
  bem-sucedido: log de erro explícito ( hawkBit ficará com o valor novo e o restart
  re-empurrará o .env — caso raríssimo, auditável no log).

### Rotas (novas, plataforma — sem :companyId)

- `GET /api/admin/polling` → `{ effectiveSec, source: 'override'|'env-default', updatedAt?, updatedBy? }`
- `PUT /api/admin/polling` body `{ pollingSec: int }` (5–86400) → valida, empurra, persiste, audita.
- Auth: `{ auth: true, superAdmin: true }` (macro existente; **sem** companyRole — rota
  de plataforma, princípio do projeto). Guards hawkBit: nível 1 (`enabled` → 400 se off)
  e nível 2 (erro de rede → 503). Response schemas no `schemas.ts` do módulo admin.
- Arquivo novo `src/modules/admin/polling-routes.ts` (admin/index.ts já >200 linhas);
  serviço em `src/common/hawkbit/system-config.ts` (dono do domínio pollingTime):
  `getEffectivePollingSec()` (cache em memória, DB ?? env), `setPollingTimeSec()`.
- Audit log (activityLog existente) + log estruturado de quem mudou o quê.

### Não quebrar o online — análise sistemática de cenários

| Cenário | Efeito | Veredito |
|---|---|---|
| Subir intervalo (5s→60s) | Deadlines (`nextExpectedRequestAt = lastPoll + intervalo`) se estendem para TODOS os targets no próximo cálculo do hawkBit; polls continuam frescos → ninguém vira offline espúrio | ✅ Seguro |
| Baixar intervalo (60s→5s) | Devices cujo firmware polla mais lento que a nova expectativa cruzam o deadline → offline **até o próximo poll real** (então online). É a semântica correta da expectativa, não um bug — mas exige aviso na UI | ⚠️ UI avisa: "o intervalo deve corresponder ao ritmo real de poll do firmware" |
| hawkBit cacheia config do tenant por segundos | Transição de expectativa assenta em ≤1 ciclo do pass; sem corrupção | ✅ |
| Connection Pass: budget de rotação lê `hawkbitConfig.pollingTime` (env, em tempo de import) | **Stale** após edição → budget passa a ler `getEffectivePollingSec()` (cache) — única mudança no pass | ✅ Corrigido no plano |
| Restart da API | Override da tabela re-empurrado; dashboard persiste | ✅ |
| PUT com hawkBit fora do ar | 503, nada persistido (ordem de escrita) | ✅ |
| Burst de transições ao baixar intervalo | Chokepoint único + coalescer SSE existentes absorvem | ✅ |
| Enrichment/fetch por empresa | Mesma fonte (pollStatus do hawkBit) — inalterado | ✅ |

### Dashboard (mínimo)

- Card **"Polling dos dispositivos"** na área admin (mesmo gating superAdmin da página
  de audit) — valor efetivo + origem + edição com validação 5–86400 + aviso de
  correspondência com o firmware. Componentes Arc existentes (Input + Button + Badge).

### Testes (fundamentais — critério do usuário)

- Unit (puro, sem hawkBit): conversão sec↔HH:MM:SS; bounds (rejeita 4, 86401, negativo,
  não-inteiro); resolução effective (override vence env; fallback env).
- API: GET effective (default env); PUT 403 para não-super-admin (owner/manager incluso);
  PUT 200 super admin persiste e retorna effective; PUT bounds → 400; HAWKBIT_ENABLED=false
  → 400 e **nada persistido**; erro de rede hawkBit → 503 e nada persistido (mock).
- Pass: budget usa valor efetivo (teste do núcleo com valor injetado); regressão —
  suíte do connection pass intacta (nenhum teste existente alterado).
- Drill vivo (docker, protocolo existente): setar 300s como super admin via dashboard →
  simulador DDI pollando a 5s permanece **online**; parar polls → 1 evento offline
  **backdated ao deadline de 300s**; voltar para 5s → offline detectido ≤ deadline+rotação;
  restart da API → override persiste (re-push); SSE conectado → sem eventos duplicados.

### Futuro (fora de escopo, registrado)

Polling por device/grupo/company (cadeia device > min-grupos > company > global) exigiria
expectativa per-target — hawkBit 1.0.3 não suporta (V1–V3) — e/ou firmware que leia config
entregue por deployment. Arquitetura registrada no histórico deste plano (v1, git log).

## Ordem de execução (aprovada)

S1 → S2 → S3 (commits independentes) → migration 0026 → serviço system-config →
rotas admin → integração pass/startup → dashboard → testes → Fase A (suíte/tsc/biome) →
Fase B (drill docker) → docs + commits convencionais, **sem push**.
