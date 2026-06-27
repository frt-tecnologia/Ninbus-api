# Tutorial: App Links / Universal Links na AWS (Ninbus)

> **Objetivo:** fazer os links de e-mail (`https://ninbus.frt.com.br/reset-password?token=...`)
> abrirem **direto no app Flutter** no mobile, em vez do navegador/503.
>
> **Pré-requisito (JÁ FEITO na API):** `APP_DEEP_LINK_BASE=https://ninbus.frt.com.br`
> em todos os `.env` + `docker-compose.yml`. Os links já saem como **https clicável**
> (testado localmente — ver `docs/email-app-link-plan.md`). Este tutorial cobre o
> **resto** para o link **abrir o app**: nginx, fallback web e validação.
>
> **Responsáveis:** TI (infra/nginx/DNS) + App Flutter (config no app).

---

## Por que isto é necessário (resumo de 30s)

Links `ninbus://` custom scheme **não são clicáveis** no Gmail/Outlook/Yahoo mobile.
Trocar para `https://ninbus.frt.com.br` resolve o clique (✅ já feito na API). Mas
para que o toque **abra o app** (e não o navegador mostrando 503), o Android e o iOS
exigem que o domínio prove que "conhece" o app, servindo dois arquivos de verificação
em `.well-known/`. Sem eles, o link abre no navegador — e hoje `ninbus.frt.com.br`
retorna **503**, então quebra para quem não tem o app instalado.

**Frentes (este tutorial):**
- **B — Nginx (TI):** servir `.well-known/assetlinks.json` + `apple-app-site-association`.
- **D — Fallback web (TI):** página mínima para quem **não tem** o app (evita 503).
- **C — App Flutter:** declarar o domínio (ver mensagem `docs/MESSAGE-flutter-deep-links.md`).

---

## FRENTE B — Nginx: servir a verificação de domínio

### B.1 — Criar os arquivos de verificação (no host, junto ao nginx)

Crie o diretório `docker/nginx/app-links/` com dois arquivos. **O conteúdo exato**
(se package_name, fingerprint, TeamID, BundleID) **vem do time Flutter** — peça a eles
preencham (ver `docs/MESSAGE-flutter-deep-links.md`). Templates abaixo.

**`docker/nginx/app-links/assetlinks.json`** (Android — App Links):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "br.com.frt.ninbus",
      "sha256_cert_fingerprints": [
        "COLE_O_FINGERPRINT_SHA256_DO_APP_RELEASE_AQUI"
      ]
    }
  }
]
```

> ⚠️ Um fingerprint por **variant de assinatura**. Para o Google Play recomenda-se
> usar a **App Signing Key** do Play Console (Setting → App integrity), não a chave
> local de debug. Sem o fingerprint certo, o Android NÃO abre o app.

**`docker/nginx/app-links/apple-app-site-association`** (iOS — Universal Links):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID.br.com.frt.ninbus"],
        "components": [
          "/reset-password",
          "/verify-email"
        ]
      }
    ]
  }
}
```

> ⚠️ `TEAMID` é o Apple Developer Team ID (10 caracteres, ex.: `A1B2C3D4E5`).
> `br.com.frt.ninbus` é o Bundle ID do app. Sem esses valores corretos o iOS não abre o app.

### B.2 — Patch do `docker/nginx/conf.d/ninbus.conf` (vhost 2 — `ninbus.frt.com.br`)

Substitua o bloco do vhost 2 (hoje retorna 503) por:

```nginx
# ════════════════════════════════════════════════════════════════════════
# vhost 2 — App Link host (ninbus.frt.com.br)
#   • /.well-known/*  → App Link / Universal Link verification (estático)
#   • /reset-password, /verify-email → fallback web (abre app ou loja)
#   • demais rotas → 503 (dashboard ainda não existe)
# ════════════════════════════════════════════════════════════════════════
server {
	listen 80;
	server_name ninbus.frt.com.br;

	location /.well-known/acme-challenge/ { root /var/www/certbot; }

	# ── App Link / Universal Link verification (DEVE vir antes do /) ──
	# O SO baixa estes para validar que o domínio autoriza o app.
	# Content-Type DEVE ser application/json (mesmo sem extensão .json no iOS).
	location = /.well-known/assetlinks.json {
		default_type application/json;
		alias /etc/nginx/app-links/assetlinks.json;
	}
	location = /.well-known/apple-app-site-association {
		default_type application/json;
		alias /etc/nginx/app-links/apple-app-site-association;
	}

	# ── Fallback web: quem NÃO tem o app (ou App Link ainda não verificado) ──
	# Redireciona para a loja. Troque a página estática por uma SPA real quando
	# o dashboard web existir (então ela mesma tenta abrir o app).
	location = /reset-password    { return 302 https://play.google.com/store/apps/details?id=br.com.frt.ninbus; }
	location = /verify-email      { return 302 https://play.google.com/store/apps/details?id=br.com.frt.ninbus; }

	location / {
		default_type text/plain;
		return 503 "Admin dashboard not deployed yet.\n";
	}
}
```

> Repita os 3 blocos `location` (`.well-known/...`, `/reset-password`, `/verify-email`)
> no bloco `:443` comentado quando ativar o TLS (Fase 6 do nginx-reverse-proxy-plan).

### B.3 — Montar os arquivos no container (`docker-compose.yml`)

No serviço `nginx`, adicione o volume:

```yaml
  nginx:
    # ...
    volumes:
      - ./docker/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./docker/nginx/.htpasswd:/etc/nginx/.htpasswd:ro
      # NOVO ↓
      - ./docker/nginx/app-links:/etc/nginx/app-links:ro
      # ...
```

---

## FRENTE D — Fallback web (decisão de produto)

Hoje `ninbus.frt.com.br` → **503**. Após B.2, `/reset-password` e `/verify-email`
redirecionam para a Play Store (exemplo). **Decidir:**

- **Opção D1 (mínima, já no patch):** redirect para a loja. Bom o suficiente enquanto
  não há dashboard web. Quem tem o app → abre o app (App Link). Quem não tem → loja.
- **Opção D2 (com formulário web):** quando a dashboard web existir, ela própria serve
  `/reset-password?token=` com um `<form>` que chama a API
  (`POST /api/auth/reset-password`). Útil para quem está no PC ou resetando senha sem o
  app instalado. **Requer o frontend web.**
- **Opção D3 (sem fallback):** NÃO recomendado — regrediria o fluxo de quem reinstala o
  app / troca de celular (cairia em 503).

**Recomendação:** começar com **D1** agora (zero esforço de frontend) e migrar para
**D2** quando a dashboard web estiver pronta.

---

## FRENTE C — App Flutter (responsabilidade do app)

O App precisa **declarar** o domínio `ninbus.frt.com.br` e tratar as URLs
`/reset-password?token=` e `/verify-email?token=`. Tudo detalhado em
**`docs/MESSAGE-flutter-deep-links.md`** — encaminhe ao time de Flutter.

> ⚠️ **Sequenciamento importante:** o release do app com os novos filtros deve sair
> **antes** (ou no mesmo dia) da troca de `APP_DEEP_LINK_BASE` em produção — senão o
> link abre no navegador/loja em vez do app. No dev local já está trocado; em produção
> (`.env.docker`) também, então alinhe o release do app.

---

## ⚠️ GOTCHA DE PRODUÇÃO (leia antes do deploy) — precedência do `.env`

`docker compose up` lê **o `.env` do servidor** por padrão (NÃO o `.env.docker`
do repo, e NÃO o `.env` do repo — este é gitignored). A linha do compose é:

```yaml
APP_DEEP_LINK_BASE: ${APP_DEEP_LINK_BASE:-https://ninbus.frt.com.br}
```

Isso significa:

| `.env` do servidor (AWS) | Resultado em prod | Status |
|---|---|---|
| **OMITE** a variável | default do compose vence → `https://ninbus.frt.com.br` | ✅ correto |
| tem `APP_DEEP_LINK_BASE=ninbus://` (valor ANTIGO) | **sobrescreve o default** → `ninbus://` | 🔴 **BUG persiste** |
| tem `APP_DEEP_LINK_BASE=https://ninbus.frt.com.br` | valor explícito vence | ✅ correto |

**Antes do deploy, na AWS:**
```bash
# No servidor, abra o .env real (gitignored) e verifique:
grep APP_DEEP_LINK_BASE /opt/ninbus/.env   # (ou o path real)
# Se existir com ninbus:// → TROQUE ou COMENTE a linha.
# Se não existir → OK (o default do compose já é o https).
```
Se usam `docker compose --env-file .env.docker up`, então o `.env.docker`
DO REPO é o que vale — já atualizei ele para `https://ninbus.frt.com.br`. ✅

---

## DNS e TLS (TI)

1. **DNS:** `ninbus.frt.com.br` deve apontar (registro A) para o **mesmo IP** do nginx
   (já é assim hoje, conforme `nginx-reverse-proxy-plan.md`). Sem DNS, o App Link não
   funciona — o SO precisa baixar os `.well-known` pela URL pública.
2. **HTTPS é OBRIGATÓRIO para iOS:** Universal Links só funcionam sobre **HTTPS** com
   certificado válido. O Android aceita HTTP em teoria, mas a Play exige HTTPS na prática.
   → Use o **certificado wildcard `*.ninbus.frt.com.br`** (Fase 6 do nginx-reverse-proxy).
3. **Cloudflare (se usar):** deixe `ninbus.frt.com.br` em modo **proxy laranja**
   (HTTPS) — diferente do `hb.`, este vhost É web, não DDI de device. Sem problema.

---

## Validação passo a passo (após deploy)

```bash
# 1. Os arquivos .well-known respondem com application/json:
curl -sI https://ninbus.frt.com.br/.well-known/assetlinks.json | grep -i content-type
#   → content-type: application/json
curl -s  https://ninbus.frt.com.br/.well-known/assetlinks.json | jq .
curl -s  https://ninbus.frt.com.br/.well-known/apple-app-site-association | jq .

# 2. Validação oficial do Android (precisa do host público):
#    https://developers.google.com/digital-asset-links/tools/generator

# 3. Fallback web não dá 503:
curl -sI https://ninbus.frt.com.br/reset-password | grep -i location

# 4. Disparar um reset real e checar o link no email:
#    POST /api/auth/request-password-reset  →  email chega com link https
```

**Teste no celular (definitivo):**
- Envie um reset para um e-mail que você abre **no Gmail do celular**.
- Toque no botão → se o app abrir na tela de redefinição: ✅ App Link funcionando.
- Se abrir o navegador/loja: verifique (a) o fingerprint no `assetlinks.json`,
  (b) o `intent-filter` com `autoVerify=true`, (c) o certificado HTTPS.

---

## Checklist de execução (AWS)

- [ ] **Flutter:** fornecer `package_name`, fingerprint SHA-256 (App Signing Key),
      TeamID + BundleID → preencher os 2 arquivos JSON.
- [ ] **TI:** criar `docker/nginx/app-links/{assetlinks.json,apple-app-site-association}`.
- [ ] **TI:** aplicar patch B.2 no `ninbus.conf` (vhost 2) + volume B.3 no compose.
- [ ] **TI:** confirmar DNS `ninbus.frt.com.br` → IP do nginx; cert wildcard ativo.
- [ ] **Flutter:** release do app com `intent-filter`/Associated Domain.
- [ ] **Validar:** curl nos `.well-known` + teste no Gmail mobile.
- [ ] **Cutover:** confirmar release do app já publicado ANTES de depender do link.
```
