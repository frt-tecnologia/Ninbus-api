# Plano de Ação — Hardening de Segurança (P1/P2 + Docs)

> **Status:** 🟢 IMPLEMENTADO + VALIDADO (Frentes A, B, C) — D = roadmap (após hawkBit least-priv).
>
> **Executado nesta iteração (sem commit):**
> - **A:** Basic Auth no `/docs` (nginx) — `.htpasswd` BCrypt gitignored, `auth_basic`
>   no vhost api. Validado: /docs e /docs/json → 401 sem cred / 200 com cred / 401 errada;
>   /health e /api/auth NÃO afetados (sem auth_basic); DDI hb. não afetado.
> - **B:** `findSoftwareModule(companyId, ...)` agora busca na tabela `artifacts`
>   local (WHERE company_id) — cross-tenant de SM ID/nome bloqueado (404).
>   Compatível com Flutter (aceita nome OU SM-ID, desde que da própria empresa).
> - **C:** rotas action-status e ddi-check agora chamam `isTargetOwnedByCompany()`
>   antes do hawkBit — targetId cross-tenant → 404.
> - **D (roadmap):** least-privilege hawkBit (depois) + token rotation (exige firmware).
>
> **Testes:** 31 testes passando (18 nginx + 7 B + 6 C), incluindo cross-tenant
> explícitos. Validação empírica no Docker: 3 containers healthy, sem regressão.
>
> **P0 (assinatura firmware + TLS) e D:** iterações futuras conforme decisão.
>
> **O que NÃO foi feito:** commit (aguardando pedido), senha do .htpasswd
> (placeholder — usuário define via `docker run --rm httpd:alpine htpasswd -nbB ...`).
>
> **Princípio:** cada item tem hipóteses testadas (caminho feliz + adversos),
> evidência de código, e plano de reversão.

---

## 📋 Sumário Executivo

| # | Frente | Complexidade | Toca firmware? | Toca app? |
|---|--------|-------------|----------------|-----------|
| A | **Basic Auth no `/docs` (nginx)** | 🟢 Baixa | ❌ Não | ❌ Não |
| B | **Cross-tenant artifacts (findSoftwareModule)** | 🟠 Média | ❌ Não | ⚠️ Talvez* |
| C | **Auditoria de escopo (outros hawkBit lookups)** | 🟠 Média | ❌ Não | ❌ Não |
| D | **Least-privilege hawkBit + Token rotation (roadmap)** | 🔴 Alta | ✅ Sim (D2) | ✅ Sim |

\* B pode exigir o Flutter passar `artifactId` num formato diferente — ver Seção B.5.

**Decisão de particionamento:** A, B, C são **independentes e reversíveis**, ideais
para esta iteração. **D (token rotation)** exige firmware (regravação de token no
device) → fica como **roadmap documentado**, não executado agora.

---

## FRENTES A SEREM EXECUTADAS (A, B, C)

---

## 🔐 FRENTE A — Basic Auth no `/docs` (nginx)

### A.1 Objetivo
Proteger `/docs`, `/docs/json` e assets com credencial nginx, **sem tocar na app**.

### A.2 Hipóteses e ponderação

| Hipótese | Ponderação | Decisão |
|----------|-----------|---------|
| **H1: location `/docs` no nginx com `auth_basic`** | Cobre `/docs`, `/docs/json`, `/docs/json/*`. Zero código. Browser cacheia a senha. | ✅ **Escolhida** |
| H2: auth da app (superAdmin) no swagger plugin | Exige mudar `app.ts`; cookie+fetch do Scalar pode quebrar; acopla docs à identidade da app. | ❌ Rejeitada |
| H3: IP allowlist | Frágil (IPs mudam, home office). Bom como **camada extra**, não primária. | ⚠️ Opcional (combina com H1) |
| H4: desligar swagger em prod | Perde utilidade (debug, onboarding). | ❌ Rejeitada |

### A.3 Implementação proposta (NÃO executada)
1. Gerar `.htpasswd` com senha forte (fora do repo, no host): `htpasswd -cb docker/nginx/.htpasswd ninbus-docs '<SENHA_FORTE>'`.
2. Adicionar `location /docs` **antes** do `location /` no vhost `api.` do `ninbus.conf`,
   com `auth_basic` + `auth_basic_user_file /etc/nginx/.htpasswd;` + mesmos headers de proxy.
3. Montar `.htpasswd` no compose: `- ./docker/nginx/.htpasswd:/etc/nginx/.htpasswd:ro`.
4. `.gitignore`: adicionar `docker/nginx/.htpasswd` (segredo, **nunca** commitar).
5. Recriar só o nginx (`docker compose up -d --force-recreate nginx`).

### A.4 Casos de teste (caminho feliz + adversos)
| # | Cenário | Esperado | Tipo |
|---|---------|----------|------|
| A-T1 | `GET /docs` **sem** credencial | **401** + header `WWW-Authenticate: Basic` | adverso |
| A-T2 | `GET /docs` **com** credencial correta | **200** (HTML Scalar) | feliz |
| A-T3 | `GET /docs/json` **sem** credencial | **401** (spec protegida) | adverso — **crítico** |
| A-T4 | `GET /docs/json` **com** credencial | **200** (JSON OpenAPI) | feliz |
| A-T5 | `GET /health` **sem** credencial | **200** (não tem auth_basic) | adverso — confirma **não-interferência** |
| A-T6 | `GET /api/auth/...` **sem** credencial nginx | fluxo auth normal (não afetado) | adverso |
| A-T7 | credencial **errada** | **401** | adverso |
| A-T8 | DDI do device (`hb.:8080`) | **não afetado** (outro vhost) | adverso |

### A.5 Impacto
- **Firmware:** ❌ nenhum (vhost `hb.` isolado).
- **App Flutter:** ⚠️ o desenvolvedor que abrir `/docs` no browser precisa da senha
  nginx. O **app em runtime não chama `/docs`** → zero impacto funcional.
- **Rollback:** remover o bloco `location /docs` + recriar nginx. Segundos.

### A.6 Risco principal
`.htpasswd` com BCrypt/APR1 — a imagem `nginx:alpine` suporta MD5/APR1 por default;
para BCrypt precisa `apache2-utils`. **Decisão:** gerar com `htpasswd` (APR1) que é
o default suportado — documentar isso.

---

## 🛡️ FRENTE B — Cross-Tenant de Artefatos (`findSoftwareModule`)

### B.1 O bug (evidência)
`src/modules/deployments/helpers.ts:62-110` — `findSoftwareModule` consulta hawkBit
**globalmente** e aceita **SM ID numérico sequencial**:

```ts
// helpers.ts:64-69 — aceita ID numérico SEM checar companyId
const asNumber = Number(artifactNameOrSmId);
if (!isNaN(asNumber) && asNumber > 0 && ...) {
    const sm = await hawkbitSoftwareModules.get(asNumber);  // ← global, enumerável
    return { id: sm.id, ... };
}
// helpers.ts:89-110 — list por nome/tipo, também global (sem companyId)
const result = await hawkbitSoftwareModules.list({ q: `name==${...};type==${...}` });
```

**Ataque:** operator de empresa A cria deployment com `artifactName="42"` (SM ID da
empresa B) → implanta firmware alheio nos próprios devices. Brute-force de IDs
sequenciais enumera todo o catálogo.

### B.2 Hipóteses e ponderação

| Hipótese | Ponderação | Decisão |
|----------|-----------|---------|
| **H1: lookup pela tabela local `artifacts` (WHERE companyId)** | Já é o padrão do módulo (`listArtifacts`, `requireOwnership`). hawkBit = source of truth do binário; tabela local = source of truth do **ownership**. Consistente com SKILL.md (write-through pattern). | ✅ **Escolhida** |
| H2: filtrar no hawkBit via query `q=` | hawkBit é single-tenant ("DEFAULT"), não tem noção de companyId. Impossível filtrar lá. | ❌ Rejeitada |
| H3: criar tenants hawkBit por empresa | Refatoração massiva (multi-tenancy hawkBit), fora de escopo, quebra provisioning existente. | ❌ Rejeitada |

### B.3 Implementação proposta (NÃO executada)
Refatorar `findSoftwareModule` em `helpers.ts` para **receber `companyId`** e
consultar a tabela `artifacts` (local) em vez do hawkBit:

```ts
export async function findSoftwareModule(
    companyId: string,              // ← NOVO parâmetro
    artifactNameOrId: string,
    version: string,
    typeKey: string,
): Promise<{ id: number; name: string; version: string } | null> {
    // 1. Busca SEMPRE na tabela local, escopada por empresa
    const [local] = await db.select()
        .from(artifacts)
        .where(and(
            eq(artifacts.companyId, companyId),
            // por nome OU por hawkbitSmId numérico — ambos validados contra a empresa
        )).limit(1);
    if (!local) return null;          // ← cross-tenant rejeitado aqui
    // 2. (opcional) valida type/version se vierem no request
    return { id: local.hawkbitSmId, name: local.name, version: local.version };
}
```
- `createDeployment` em `service.ts` passa `params.companyId` ao chamar.
- **Rejeição explícita de ID cross-tenant:** se o SM ID existe no hawkBit mas não na
  tabela local da empresa → `null` (404 "Artifact not found in this company").

### B.4 Casos de teste (caminho feliz + adversos)
| # | Cenário | Esperado | Tipo |
|---|---------|----------|------|
| B-T1 | deploy c/ artifact **próprio** (nome) | **201** deploy criado | feliz |
| B-T2 | deploy c/ artifact **próprio** (ID) | **201** | feliz |
| B-T3 | deploy c/ SM ID **de outra empresa** (cross-tenant) | **404** "not found in this company" | adverso — **fecha o bug** |
| B-T4 | deploy c/ nome inexistente | **400/404** | adverso |
| B-T5 | deploy c/ `artifactName="42"` onde 42 não é da empresa | **404** (não vaza) | adverso |
| B-T6 | brute-force de IDs 1..1000 | todos **404** (não enumera) | adverso |
| B-T7 | deploy existente pós-fix | **201** (regression ok) | regressão |

### B.5 Impacto (atenção aqui)
- **Firmware:** ❌ nenhum.
- **App Flutter:** ⚠️ **possível**. Se o Flutter hoje envia `artifactName` como
  **SM ID numérico sequencial** (ex.: `"42"`), e esse ID pertence à empresa correta,
  **continua funcionando** (validado contra a tabela local). Se envia como nome de
  exibição, também funciona. **Risco real:** se o Flutter enviava um SM ID que
  *parecia* funcionar por acaso cross-tenant — agora vira 404. **Ação:** mensagem ao
  frontend (Seção G) pedir confirmação do formato enviado. Sem mudança de contrato da
  API (mesmo campo `artifactName`).
- **Testes:** `deployments.test.ts` roda com `HAWKBIT_ENABLED=false` — preciso
  garantir que os fixtures de teste criam registros em `artifacts` para o lookup local.

### B.6 Riscos
- **R1:** deploy de artifact **recém-uploaded** cuja linha local ainda não existe
  (race). Mitigação: `uploadArtifact` já faz `db.insert(artifacts)` **antes** de
  retornar (write-through) → sem race.
- **R2:** artifact compartilhado entre empresas (caso de uso?). Pergunta aberta — hoje
  cada upload é por empresa, então não há compartilhamento.

---

## 🔍 FRENTE C — Auditoria de Escopo (outros hawkBit lookups)

### C.1 Objetivo
Garantir que **nenhum** outro endpoint permita acessar recurso cross-tenant pela
mesma classe de bug (ID direto sem `companyId`).

### C.2 Evidência coletada (audit completa)
Varri todos os `hawkbitSoftwareModules.get/list`, `hawkbitTargets.get`,
`hawkbitDistributionSets.get` em `src/`:

| Local | Padrão | Risco cross-tenant? |
|-------|--------|---------------------|
| `artifacts/service.ts` getArtifact/update/delete/download | ✅ `requireOwnership(companyId, smId)` antes | ❌ seguro |
| `artifacts/service.ts` listArtifacts | ✅ `WHERE companyId` + `listByIds(smIds locais)` | ❌ seguro |
| **`deployments/helpers.ts` findSoftwareModule** | ❌ **global + ID numérico** | ✅ **bug (Frente B)** |
| `deployments/service.ts` getDeployment | ✅ `requireDeploymentOwnership` | ❌ seguro |
| `deployments/service.ts` listDeployments | ✅ `WHERE companyId` | ❌ seguro |
| `deployments/device-routes.ts` action status | ✅ device é da empresa (membership via `companyRole`) + `devices.companyId` | 🟡 revisar 1 caso |
| `deployments/ddi-diagnostics.ts` | ✅ atrás de `companyRole` + target da empresa | 🟡 revisar 1 caso |

**Conclusão da auditoria:** a única brecha confirmada é **Frente B**. Dois pontos
(`device-routes` action status, `ddi-diagnostics`) usam `targetId` direto — preciso
confirmar que validam `devices.companyId = :companyId` antes do lookup hawkBit.

### C.3 Implementação proposta (NÃO executada)
1. Revisar `deployments/device-routes.ts:155-185` (action status por `targetId`) —
   confirmar/forçar `WHERE devices.companyId` antes de `hawkbitTargets.getActionStatus`.
2. Revisar `deployments/ddi-diagnostics.ts:80` (target lookup) — idem.
3. Adicionar **teste cross-tenant explícito** para cada um: empresa B não acessa
   action/diagnóstico de device da empresa A → **404**.

### C.4 Casos de teste
| # | Cenário | Esperado |
|---|---------|----------|
| C-T1 | empresa B GET action-status de device da empresa A | **404/403** |
| C-T2 | empresa B GET ddi-check de target da empresa A | **404/403** |
| C-T3 | empresa A acessa próprio device | **200** |

### C.5 Impacto
- Firmware: nenhum. App: nenhum (só fecha brechas).

---

## 📋 FRENTES DOCUMENTADAS (D — NÃO EXECUTADAS agora)

---

## 🔴 FRENTE D — Least-privilege hawkBit + Token rotation (ROADMAP)

> Documentada e alinhada com as mensagens aos agentes, mas **não executada** nesta
> iteração (D2 exige firmware).

### D.1 Least-privilege hawkBit (P2 — pode executar agora se aprovar)
**Objetivo:** o usuário de serviço que a API usa para falar com o hawkBit não deve ser
`TENANT_ADMIN` (full). Deve ter só as roles necessárias.

- **Hipótese vs realidade:** hawkBit 1.0.3 suporta roles granulares
  (`CREATE_TARGET`, `READ_TARGET`, `CREATE_SOFTWARE_MODULE`, etc.) via Security
  Concepts. **Investigação necessária:** confirmar quais roles cobrem todas as
  operações que a API faz (criar SM/DS/target, upload artifact, assign, ler actions,
  system configs para DDI). Se uma operação não tem role específica → mantém admin.
- **Risco:** quebrar silenciosamente a API (403 em operação que antes funcionava).
  **Mitigação:** testar exaustivamente cada endpoint da API após a troca.
- **Ação:** criar user `ninbus-api-service` no hawkBit com role mínima, trocar
  `HAWKBIT_USERNAME`/`HAWKBIT_PASSWORD` no `.env` prod, validar TODO o CRUD.

### D.2 Token rotation (ROADMAP — exige firmware + app)
**Objetivo:** endpoint `POST /api/devices/:id/rotate-token` que regenera o
`securityToken` no hawkBit + regrava no device.

- **Por que exige firmware:** o device precisa **gravar o novo token na E2PROM** via
  comando serial (ou via OTA com firmware atual que saiba receber novo token).
- **Por que exige app:** botão "Rotacionar token" no admin Flutter + feedback.
- **Design proposto:**
  1. `POST /companies/:id/devices/:deviceId/rotate-token` (admin role) → chama
     `PUT /rest/v1/targets/{controllerId}` com novo `securityToken` aleatório (32+ chars).
  2. Retorna novo token **uma vez** (nunca armazenado no DB — mesmo princípio do deviceKey).
  3. Admin grava no device via serial (`//ZZ<novo-token>`).
- **Risco:** durante a janela entre rotação no servidor e regravação no device, o
  device **não consegue autenticar** (401 DDI). **Mitigação:** janela curta + status
  claro no UI + documentar procedimento.
- **Ação:** fica como **roadmap**, dependente do firmware suportar regravação de token
  (pergunta ao agente embarcado na Seção G).

---

## 🧪 ESTRATÉGIA DE VALIDAÇÃO GERAL

### Validação empírica no Docker (executar após implementar A, B, C)
1. `docker compose up -d` (3 containers healthy).
2. Rodar **todos** os testes A-T*, B-T*, C-T* via `curl` contra o nginx vivo.
3. Rodar `bun test` (suíte de regressão — atenção: Bun 1.3.12 tem bug de segfault no
   boot; se crashar, isolar os arquivos de artifact/deployment).
4. Confirmar roteamento não-regredido: API 200, Management 404, DDI 200 com `_links`
   públicos (já validado na iteração anterior).

### Testes de regressão automatizados (adicionar)
- `tests/nginx-proxy.test.ts`: +2 testes (docs exige credencial, /health não).
- `tests/deployments.test.ts`: +3 testes cross-tenant (B-T3, B-T5, B-T6).
- `tests/deployments.test.ts`: +2 testes (C-T1, C-T2).

---

## 📐 HIPÓTESES ESTRUTURAIS (ponderadas)

| Hipótese | Ponderação | Decisão |
|----------|-----------|---------|
| Particionar em A+B+C agora, D depois | Menor risco, valor imediato, não trava firmware/app. | ✅ |
| Fazer tudo de uma vez (incl. D) | Alto risco de quebrar firmware/app simultaneamente; rollback complexo. | ❌ |
| Adicionar config ao env.ts para senha nginx | Viola princípio (segredo não deve ir pro repo/env versionado); `.htpasswd` no host + `.gitignore` é mais seguro. | ❌ |
| Mudar contrato da API (`artifactName` → `artifactId`) | Quebra o Flutter. Manter campo, só validar escopo. | ❌ |

---

## 📦 ENTREGÁVEIS PÓS-IMPLEMENTAÇÃO

1. **Código:** `ninbus.conf` (location /docs), `helpers.ts` (findSoftwareModule),
   revisão de `device-routes.ts`/`ddi-diagnostics.ts`, fixtures de teste.
2. **Testes:** +7 testes automatizados, todos passando.
3. **Docs:** atualizar `docs/nginx-reverse-proxy-plan.md` (docs protegido),
   `docs/security-hardening.md` (NOVO — roadmap P0/D + estado P1/P2).
4. **SKILL.md:** adicionar padrão "ownership de artifact SEMPRE via tabela local".
5. **README:** nota sobre `/docs` com Basic Auth em prod.
6. **Mensagens aos agentes** (Seção G).

---

## 📨 FRENTE G — Mensagens aos agentes (preparar após implementar)

### G.1 Para o Frontend (Flutter)
> Implementamos proteção do `/docs` (Basic Auth nginx) — não afeta o app.
> **Cross-tenant de artifacts corrigido:** o campo `artifactName` do POST /deployments
> agora valida que o artifact pertence à empresa. **Ação:** confirmar que o app envia
> o `artifactName` como (a) nome de exibição do artifact OU (b) SM ID que pertence à
> própria empresa. Se enviava SM ID cross-tenant "por acaso", agora retorna 404.
> Token rotation (futuro) adicionará botão "Rotacionar token" — alinhar quando D.2 for.

### G.2 Para o Firmware (STM32)
> **Nenhuma mudança necessária** para A/B/C — DDI, TargetToken e download CloudFront
> seguem idênticos.
> **Roadmap que pode te afetar (Token rotation — D.2):** quando implementarmos, o
> admin poderá regenerar o `securityToken` do device. Perguntas: (1) o firmware suporta
> receber/regravar o token via serial hoje (`//ZZ`)? (2) suporta via OTA (comando DDI
> custom)? (3) qual o procedimento de regravação segura (E2PROM protegida)?
> **P0 futuro (assinatura de firmware):** separado, mas vai exigir verificação de
> assinatura no boot do STM32 — aguardamos sua análise de capacidade.

---

## ✅ CHECKLIST DE APROVAÇÃO

Antes de eu executar, confirmar:
- [ ] **Aprova Frentes A, B, C** nesta iteração (D fica roadmap)?
- [ ] **Senha do `.htpasswd`**: você define, ou gero uma e te entrego separado?
- [ ] **D.1 (least-privilege hawkBit)**: incluo agora ou deixo para depois? (recomendo
      depois — precisa validação exaustiva de cada role)
- [ ] Confirma que o Flutter envia `artifactName` como nome ou SM-ID próprio (B.5)?

**Após aprovação,** executo nesta ordem: A (nginx, isolado) → testes A → B (código) →
testes B → C (auditoria) → testes C → docs → mensagens. **Sem commit** (aguardo pedido).

---

## ❌ O QUE NÃO VOU FAZER SEM APROVAÇÃO
- Não executar nenhuma Frente.
- Não gerar `.htpasswd` com senha.
- Não alterar `helpers.ts`, `device-routes.ts`, `ddi-diagnostics.ts`.
- Não fazer commit.
- Não tocar em firmware/app.
