# Plano: Links de E-mail Clicáveis no Mobile via HTTPS App Link

> **Status:** ✅ FRENTE A IMPLEMENTADA + TESTADA LOCALMENTE.
> **Próximos passos:** Frentes B/C/D na AWS (ver `docs/email-app-link-aws-setup.md`)
> e mensagem ao Flutter (`docs/MESSAGE-flutter-deep-links.md`).
> **Motivo:** links de redefinição de senha / verificação de e-mail **não eram
> clicáveis** dentro dos apps de e-mail no mobile. O usuário sugeriu usar o domínio
> já existente `ninbus.frt.com.br` — confirmado como a solução correta.

---

## 1. Diagnóstico — por que o link NÃO é clicável hoje

### Evidência (estado atual do código/config)
- `.env`, `.env.example`, `.env.test`: `APP_DEEP_LINK_BASE=ninbus://`
- `docker-compose.yml`: default `APP_DEEP_LINK_BASE: ${APP_DEEP_LINK_BASE:-ninbus://}`
- `.env.docker` (produção): **não define** `APP_DEEP_LINK_BASE` → herda o default `ninbus://`
- `src/common/config/auth.ts → buildAppDeepLink()` gera:
  - `ninbus://reset-password?token=XXX`
  - `ninbus://verify-email?token=XXX`

### Causa raiz
**Custom schemes (`ninbus://`) NÃO são clicáveis na maioria dos apps de e-mail mobile.**

| Cliente | Texto puro `ninbus://...` | `<a href="ninbus://...">` |
|---|---|---|
| Gmail (Android/iOS) | texto morto | **href removido** (anti-phishing) → não clica |
| Outlook mobile | texto morto | href removido na maioria dos casos |
| Apple Mail | às vezes clica | inconsistente |
| Samsung/Yahoo/Outlook.com | texto morto | href removido |

Apps de e-mail **só "auto-linkam" URLs `http://`/`https://`**. Quando o `href` não é
http/https, muitos clientes **removem o link por segurança** (evita abrir apps
arbitrários / phishing). Resultado: o botão aparece mas não responde ao toque —
exatamente o sintoma relatado.

---

## 2. Por que a sugestão do usuário está correta

Trocar para **`https://ninbus.frt.com.br`** resolve o problema porque vira um
**App Link (Android) / Universal Link (iOS)**:

1. ✅ **Clicável em TODOS os apps de e-mail** — é um HTTPS normal.
2. ✅ **Abre o app quando instalado** — se o domínio estiver verificado, o SO abre
   o app Flutter direto (sem passar pelo navegador).
3. ✅ **Padrão da indústria** — é assim que WhatsApp, Instagram, bancos, etc. fazem.

### Bônus: o código JÁ suporta isso (zero reescrita)
- `buildAppDeepLink()` **já** adiciona o separador `/` correto para URLs host-based:
  `https://ninbus.frt.com.br` + `/` + `reset-password` + `?token=XXX` →
  `https://ninbus.frt.com.br/reset-password?token=XXX` ✔️
- `env.ts` — a regex `^[a-z][a-z0-9+.-]*://` **já aceita** `https://ninbus.frt.com.br`
  (validado: passa ✔️). Não precisa mexer no schema.
- É **o alvo de produção já documentado** em `docs/nginx-reverse-proxy-plan.md` (linha 404)
  e na descrição da própria var em `env.ts`.

**Conclusão:** a mudança no formato do link é **só de configuração**, não de código.
Mas, para o link **abrir o app** (e não o navegador), há dependências externas.

---

## 3. Plano de Ação (4 frentes)

### 🟢 Frente A — API (este repo): ✅ IMPLEMENTADA + TESTADA
> Única frente que mexe neste repositório. **Feita e validada localmente.**

**Decisões tomadas (usuário):**
1. **Domínio:** `ninbus.frt.com.br` ✔️
2. **Dev vs. prod:** trocado em **todos** os ambientes ✔️
3. **Fallback (D):** endereçado no tutorial AWS — recomendação D1 (redirect p/ loja)
   agora, D2 (form web) quando a dashboard existir.

| Arquivo | Antes | Depois |
|---|---|---|
| `.env` (dev local) | `APP_DEEP_LINK_BASE=ninbus://` | `https://ninbus.frt.com.br` |
| `.env.example` | `ninbus://` | `https://ninbus.frt.com.br` (+comentário) |
| `.env.test` | `ninbus://` | `https://ninbus.frt.com.br` |
| `.env.docker` (prod) | **não definido** | `https://ninbus.frt.com.br` (adicionado) |
| `docker-compose.yml` default | `${...:-ninbus://}` | `${...:-https://ninbus.frt.com.br}` |
| `src/common/config/auth.ts` | `buildAppDeepLink` inline | extraiu p/ `deep-link.ts` (testável) |
| `src/common/config/deep-link.ts` | — | **NOVO** (função + doc do porquê https) |
| `src/common/config/deep-link.test.ts` | — | **NOVO** (7 testes de regressão) |

**Resultado:** links viram `https://ninbus.frt.com.br/reset-password?token=XXX` →
clicáveis em qualquer cliente de e-mail. **Validado empiricamente**
(`bun run _demo.ts` → output https; 16/16 testes; build 1318 módulos; biome limpo).

### 🟡 Frente B — Infraestrutura (Nginx): servir os arquivos de verificação
> Para o OS abrir o app em vez do navegador, o domínio precisa ser "verificado".

Adicionar no vhost `ninbus.frt.com.br` (hoje retorna `503`):

```nginx
# App Links / Universal Links — servidos estaticamente, ANTES do return 503
location /.well-known/assetlinks.json {
    default_type application/json;
    alias /var/www/app-links/assetlinks.json;
}
location /.well-known/apple-app-site-association {
    default_type application/json;
    alias /var/www/app-links/apple-app-site-association.json;
}
```

- **Android:** `assetlinks.json` precisa do `package_name` + fingerprint(s) SHA-256 do app Flutter.
- **iOS:** `apple-app-site-association` precisa do `applicationID` (TeamID + BundleID).
- ⚠️ Sem estes arquivos, o link **ainda é clicável** (Frente A resolve só isso), mas abre
  no **navegador** e não no app.

### 🟡 Frente C — App mobile (Flutter): declarar o domínio
> Responsabilidade do app, mas precisa estar alinhado.

- Android: `intent-filter` com `android:autoVerify="true"` para `ninbus.frt.com.br`.
- iOS: *Associated Domain* `applinks:ninbus.frt.com.br`.
- App precisa tratar as URLs `.../reset-password?token=` e `.../verify-email?token=`
  (extrair token, abrir a tela certa).
- ⚠️ **Sequenciamento:** o release do app com os novos filtros deve sair **antes**
  (ou junto) da troca do `APP_DEEP_LINK_BASE` em produção — senão o link abre no
  navegador/503 em vez do app.

### 🔴 Frente D — Fallback web (UX): quando o app NÃO está instalado
> Hoje é o ponto crítico de UX.

- **Problema:** hoje `ninbus.frt.com.br` retorna **503** (dashboard `:8082` não existe).
  Se o usuário clicar o link e o app **não estiver instalado** (ou o App Link ainda não
  verificado), o navegador abre `https://ninbus.frt.com.br/reset-password` → **503**.
- **Opções:**
  - **D1:** página estática mínima no `ninbus.frt.com.br` que (a) tenta abrir o app,
    (b) redireciona para Play Store/App Store, ou (c) mostra um formulário web de
    reset (quando a dashboard existir).
  - **D2:** apontar os links para `app.ninbus.frt.com.br` (domínio web dedicado).
- ⚠️ **Sem Frente D, o fluxo quebra para quem não tem o app instalado.** Precisa de
  decisão (ver §4).

---

## 4. Decisões que preciso de você (bloqueantes p/ execução)

1. **Domínio do App Link:** confirmar que o app Flutter vai verificar
   **`ninbus.frt.com.br`** (App Link / Universal Link). Ou deve ser outro
   (ex.: `app.ninbus.frt.com.br`)?
2. **Dev vs. prod:** trocar `APP_DEEP_LINK_BASE` **em todo lugar** para `https://ninbus.frt.com.br`,
   ou só em `.env.docker` (produção) e manter `ninbus://` no `.env` de dev?
3. **Fallback (Frente D):** construir a página web mínima **agora**, ou só depois que a
   dashboard web estiver pronta? (Sem fallback, o link quebra para quem não tem o app.)

---

## ⚠️ O que é GARANTIDO vs. o que PRECISA de mais trabalho

Seja honesto sobre as duas expectativas distintas:

| Expectativa | Status só com a Frente A (já feita) | Precisa de |
|---|---|---|
| **Link é clicável dentro do app de e-mail no mobile** | ✅ **GARANTIDO** (https = clicável em qualquer cliente) | nada mais |
| **Toque abre o app Flutter direto** | 🔴 NÃO (abre no navegador) | TLS (Fase 6) + Frentes B + C |
| **Quem não tem app vê algo útil (não 503)** | 🔴 NÃO (503 hoje) | Frente D |

**Por que App Links precisam de HTTPS:** Android (`autoVerify`) e iOS (Universal
Links) só validam o domínio baixando `.well-known/*` sobre **HTTPS com cert
válido**. Hoje `ninbus.frt.com.br` é **HTTP** (`:80`, TLS na Fase 6 comentada).
Logo, mesmo com os arquivos `.well-known` publicados (Frente B), o App Link **só
passa a abrir o app depois do TLS ativo**. Até lá, o link é clicável mas abre no
browser (caindo no fallback da Frente D).

---

## ⚠️ GOTCHA DE PRODUÇÃO — precedência do `.env`

`docker compose up` lê o `.env` do **servidor** (gitignored). Se esse `.env` tiver
o valor ANTIGO `APP_DEEP_LINK_BASE=ninbus://`, ele **sobrescreve** o default novo
do compose → o bug persistiria em produção apesar do código correto. **Verificar/
atualizar o `.env` da AWS antes do deploy** (detalhe em `email-app-link-aws-setup.md`).

---

## 5. O que NÃO muda / é preservado

- `buildAppDeepLink()` — **lógica inalterada** (já trata https). Risco zero ao fluxo de
  reset/verificação; só o *base* muda.
- `env.ts` — schema inalterado (regex já aceita https).
- Lógica de token / Better Auth — inalterada.
- Expiração do token (1h), `required:true` (falha não-silenciosa) — inalterados.

---

## 6. Riscos e Mitigações

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Arquivos `.well-known` ausentes/errados → link abre navegador | Alta no início | 🟡 Baixo | Frente B; link **continua clicável** (Frente A resolve o sintoma) — só não abre o app |
| App sem filtros no release → link abre navegador/503 | Média | 🟠 Médio | Sequenciamento: release do app **antes** da troca em prod (Frente C) |
| Usuário sem app instalado → cai em 503 | Alta hoje | 🔴 Alto (UX quebrado) | **Frente D obrigatória** para não regredir quem reinstala/troca de celular |
| `.env.docker` ainda usa `ninbus.com` (stale) | — | 🟡 | Já sinalizado no `nginx-reverse-proxy-plan.md`; aproveitar p/ corrigir domínio |

---

## 7. O que NÃO vou fazer sem sua aprovação

- ❌ Não alterar `.env`, `.env.example`, `.env.test`, `.env.docker`, `docker-compose.yml`.
- ❌ Não alterar `auth.ts` nem `env.ts`.
- ❌ Não mexer no Nginx nem nos arquivos `.well-known/*`.
- ❌ Não fazer commit.

Após sua aprovação (decisões §4), executo **Frente A** (config) — que por si só já
torna os links clicáveis no mobile. Frentes B/C/D dependem de infra/app e podem ser
paralelas, mas **D deve preceder ou acompanhar** a ativação em produção para não
quebrar o fluxo de quem não tem o app.
