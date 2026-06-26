# Plano de Ação — Proxy Reverso Nginx + Hardening hawkBit (Produção)

> **Status:** 🟢 IMPLEMENTADO + VALIDADO EMPÍRICAMENTE (Fases 1–5 locais) — Fases 6/7 pendentes.
>
> **Validação empírica no Docker local (todos os 3 containers healthy):**
> - API via vhost `api.` → **HTTP 200** (`/health` retorna JSON saudável)
> - Management API `/rest/v1/*` via `hb.` → **HTTP 404** (protegida, mesmo com admin:admin)
> - UI hawkbit `/login` via `hb.` → **HTTP 404**
> - Dashboard `ninbus.` → **HTTP 503** (placeholder)
> - **DDI poll via `hb.:8080`** com TargetToken → **HTTP 200** e **`_links` com `hb.ninbus.frt.com.br:8080`** (NÃO `hawkbit:8080`) ✅ forward-headers funcionando
> - DDI sem token → **HTTP 401** (TargetToken exigido)
>
> **Ajustes técnicos durante a implementação (validados):**
> - nginx usa **resolução DNS dinâmica** (`resolver 127.0.0.11` + `set $backend_*`) em vez de `upstream {}` (que abortava no startup: "host not found in upstream")
> - Sem `USER nginx` no Dockerfile (master precisa de root p/ bind :80 + cache)
> - healthcheck usa `127.0.0.1` (não `localhost` → IPv6 ::1)
> - Porta pública do hawkBit removida (Fase 5 cutover); nginx atende :8080
>
> **Pendências (externas):**
> - **Fase 0 (TI):** security group do AWS só 80/443; `hb.` em DNS-only.
> - **Fase 6 (TLS):** emitir wildcard `*.ninbus.frt.com.br`, descomentar blocos `:443`.
> - **Fase 7 (hardening):** least-privilege role, token rotation/mTLS (roadmap).
>
> **Mudanças da v4 (contexto):**
> - **Seção 1** responde diretamente as duas perguntas: (a) todos os domínios dão no
>   mesmo IP — sim; (b) como o proxy distingue `hb.` de `api.` — pelo header `Host`/SNI.
> - **Seção 10 (NOVA)** mapeia cada recomendação oficial do hawkBit ao estado atual do
>   sistema, marcando ✅ já atende / 🟡 parcial / 🔴 a corrigir.
>
> **Fatos confirmados (mantidos):** 3 subdomínios da TI (`api.`/`ninbus.`/`hb.`);
> firmware é HTTP; download via CloudFront (não passa pelo proxy); DDI usa per-device
> TargetToken; auto-registration desabilitado.

---

## 1. As duas perguntas-chave (respondidas logo no início) 💡

### 1.1 "Todos vão dar no mesmo lugar, correto?"

**Sim, exatamente.** Os 3 subdomínios da TI resolvem, via DNS, para o **mesmo IP**
(a sua instância AWS). É um comportamento normal e desejado — é assim que a internet
funciona (milhares de sites compartilham um IP).

```
api.ninbus.frt.com.br  ─┐
ninbus.frt.com.br      ─┼──►  3 registros A (DNS)  ──►  mesmo ip-aws
hb.ninbus.frt.com.br   ─┘
```

**O DNS só entrega o IP. Ele não sabe de portas nem de "qual serviço".** A
diferenciação entre `hb.` e `api.` acontece **depois**, dentro do servidor, lendo
qual nome o cliente pediu. É aí que entra o proxy reverso.

### 1.2 "Como o proxy sabe se o acesso veio do `hb.` ou do `api.`?"

**Pelo cabeçalho `Host` da requisição HTTP** (e, no caso de HTTPS, pelo **SNI** do
handshake TLS — que revela o domínio *antes* de qualquer dado ser trocado).

Toda requisição HTTP/HTTPS carrega, automaticamente, o nome do site que o cliente
quer acessar. O navegador, o app Flutter e até o firmware (que envia
`Host: hb.ninbus.frt.com.br`) fazem isso por padrão. O Nginx lê esse nome e decide o
destino:

```
Requisição chega no ip-aws:443 (ou :80)
                    │
                    ▼
        ┌───────────────────────────┐
        │  Nginx lê o Host/SNI:      │
        └───────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  Host=api.    Host=hb.     Host=ninbus.
        │           │           │
        ▼           ▼           ▼
  API :8081   hawkBit DDI   dashboard :8082
   (interno)    (só DDI)      (futura)
```

Isso se chama **virtual hosting por nome** (name-based virtual host). É a base de
como funciona hospedagem compartilhada, CDNs e praticamente toda a web. **Você não
precisa de 3 IPs nem de 3 instâncias.** No Nginx isso é um bloco `server` por domínio:

```nginx
server { listen 443 ssl; server_name api.ninbus.frt.com.br; ... proxy_pass http://api:8081; }
server { listen 80;      server_name hb.ninbus.frt.com.br;  ... proxy_pass http://hawkbit:8080; }
server { listen 443 ssl; server_name ninbus.frt.com.br;     ... proxy_pass http://dashboard:8082; }
```

### 1.3 "Se eu cobrir o Nginx na minha instância, todos os endpoints vão funcionar?"

**Sim — desde que a Fase 0 (firewall da TI) esteja feita e o firmware aponte para o
domínio certo.** Os pontos de atenção são:

- **API do app** (`api.ninbus.frt.com.br`): passa a responder na `:443` HTTPS. O app
  Flutter precisa apontar para `https://api.ninbus.frt.com.br` (mudar `BETTER_AUTH_URL`/
  `CORS_ORIGIN`). Funciona 100%.
- **Dashboard** (`ninbus.frt.com.br`): ainda **não existe** (porta 8082 não tem nada
  rodando). O vhost fica como placeholder (`503`) até a dashboard existir.
- **Dispositivos** (`hb.ninbus.frt.com.br`): continuam funcionando se o firmware já
  aponta para esse domínio. O Nginx escuta a porta que o firmware usa (`:8080`
  transição, `:80` futura). **Sem mudar o firmware.**
- ⚠️ **A Management API do hawkBit** (`/rest/v1/*`) **vira 404 publicamente** — é
  exatamente a intenção. A app Ninbus continua falando com ela **internamente**
  (`http://hawkbit:8080`), sem passar pelo Nginx.

---

## 2. Julgamento da Configuração da TI ⚖️

A TI configurou (intenção):

```
ninbus.frt.com.br     → ip-aws:8082   (futura dashboard Admin)
api.ninbus.frt.com.br → ip-aws:8081   (API backend)
hb.ninbus.frt.com.br  → ip-aws:8080   (hawkBit)
```

### 2.1 ✅ Correto
- 3 subdomínios distintos → entrada ideal para virtual hosting (Seção 1.2).
- Registros A apontando para o mesmo IP — exatamente o que o Nginx precisa.

### 2.2 🔴 Erro conceitual (ainda não resolvido)
- **DNS não codifica porta.** `domínio → ip:porta` não existe em DNS; um registro A só
  faz `domínio → IP`. A porta vem do proxy (80/443), não do DNS.
- **A segurança não foi resolvida.** Se as portas 8080/8081/8082 continuam publicadas
  no host, então `http://hb.ninbus.frt.com.br:8080/rest/v1/targets` continua
  acessível com `admin:admin`. **Todo o motivo do proxy continua sem resolver.**

### 2.3 ✅ O que pedir à TI (bloqueante)
1. Registros A → mesmo IP **sem porta** (provavelmente já feito).
2. **Security group do AWS: só 80 e 443 abertos ao público. Fechar 8080/8081/8082.**
3. `hb.ninbus.frt.com.br` em modo **DNS-only** (sem proxy laranja Cloudflare) — senão
   a Cloudflare força HTTPS e quebra o firmware HTTP.

> A TI fez a camada de DNS (correta); falta a camada de perímetro (firewall + proxy),
> que é o que este plano entrega.

---

## 3. Resumo Executivo

O Nginx vira a **única porta pública** (80/443) do `ip-aws`. Os containers `api` e
`hawkbit` **não publicam mais portas no host**. Roteamento por **hostname** (Seção 1):

| Subdomínio | Porta pública | Backend interno | Risco removido |
|------------|---------------|-----------------|----------------|
| `api.ninbus.frt.com.br` | HTTPS `:443` | API `:8081` | (já tinha auth) |
| `ninbus.frt.com.br` | HTTPS `:443` | dashboard `:8082` (futura) | — |
| `hb.ninbus.frt.com.br` | HTTP `:80`/`:8080` | hawkBit **DDI only** | **Management API/UI exposta** |

- **Management API `/rest/v1/*` e UI do hawkBit deixam de existir publicamente.**
- O dispositivo fala DDI via `hb.ninbus.frt.com.br` (HTTP), **sem mudar o firmware**
  no primeiro rollout (Opção C — Nginx também escuta `:8080`).
- Download de firmware **ignora o proxy** (CloudFront).

**Viabilidade: ✅.** Único ponto delicado: geração dos `_links` DDI (correção =
`forward-headers`). Como o device é HTTP, os links saem `http://hb.ninbus.frt.com.br/...`.

---

## 4. Análise de Interferência no Sistema Embarcado (STM32) ⚠️

| Aspecto do firmware | Impacto do Nginx | Ação |
|----------------------|------------------|------|
| Resolução DNS | Nenhum | — |
| **Download de firmware** | **Nenhum (CloudFront)** ✅ | — |
| Porta de conexão DDI | **Nenhum (Opção C)** ✅ | — |
| Auth `TargetToken` (per-device) | Nenhum (header passa direto) | — |
| `_links` DDI absolutas | Quebra se não configurar | `forward-headers` + headers Nginx |
| TLS | Inalterado (continua HTTP) | Consultar embarcado (Seção 9) |

**O ponto crítico:** os `_links` das respostas DDI são **URLs absolutas** que o hawkBit
monta a partir do `Host` da requisição. Atrás do proxy, sem ajuste, o hawkBit geraria
`http://hawkbit:8080/...` (hostname interno) e o dispositivo não resolveria →
**polling quebra**. Correção (2 partes):
1. hawkBit: `SERVER_FORWARD_HEADERS_STRATEGY: framework`.
2. Nginx envia `Host`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Port`.

Resultado: `_links` saem como `http://hb.ninbus.frt.com.br/DEFAULT/controller/v1/.../configData`
→ dispositivo resolve e segue, **exatamente como hoje**.

---

## 5. Arquitetura Alvo — Roteamento por Virtual Host

### 5.1 Mapeamento (resumo da Seção 1)

| Subdomínio | Protocolo/Porta pública | Backend interno | Roteamento no Nginx |
|------------|-------------------------|-----------------|---------------------|
| `api.ninbus.frt.com.br` | HTTPS `:443` | `api:8081` | `server_name api...` → proxy_pass |
| `ninbus.frt.com.br` | HTTPS `:443` | dashboard `:8082` (futuro) | `server_name ninbus...` → placeholder 503 |
| `hb.ninbus.frt.com.br` | HTTP `:80` (+ `:8080` transição) | hawkBit **DDI only** | `server_name hb...` + location regex; **bloqueia `/rest/v1/`** |

> O Ninbus API fala com a Management API pela **rede interna**
> (`HAWKBIT_URL=http://hawkbit:8080`), **sem passar pelo Nginx**.

### 5.2 TLS por SNI
- Certificado **wildcard `*.ninbus.frt.com.br`** cobre `api.` e `ninbus.` (HTTPS).
  Emitir via **certbot DNS-01 (API Cloudflare)** ou **Cloudflare Origin Cert**.
- `hb.ninbus.frt.com.br` é **HTTP** (firmware) → **não precisa de cert**.
  ⚠️ `hb.` deve ficar **DNS-only** (cinza) na Cloudflare, senão força HTTPS e quebra.

### 5.3 Considerações especiais
- **SSE** (`/api/.../sse`, vhost `api.`): `proxy_buffering off` + `proxy_read_timeout` alto.
- **Upload de firmware do admin** (multipart, vhost `api.`): `client_max_body_size 100m`.
- **Rate limiting de perímetro:** `limit_req` para o DDI (30r/m por IP é farto).

---

## 6. Plano de Ação Estruturado (Fases)

> Estratégia **zero downtime + zero mudança de firmware** (Opção C).

### Fase 0 — Decisões e pré-requisitos (bloqueante)
- [ ] **TI:** security group do AWS com **só 80/443** abertos (fechar 8080/8081/8082).
- [ ] **TI:** confirmar `hb.ninbus.frt.com.br` em modo DNS-only (sem proxy Cloudflare).
- [ ] **Você:** confirmar **domínio:porta que o firmware usa hoje** (Seção 9).
- [ ] **Você:** definir fonte do cert wildcard (certbot DNS-01 ou Origin Cert).

### Fase 1 — Criar config do Nginx
- [ ] `docker/nginx/nginx.conf` (Seção 8.1).
- [ ] `docker/nginx/conf.d/ninbus.conf` — **3 vhosts** (Seção 8.2).
- [ ] `docker/nginx/Dockerfile`.
- [ ] Adicionar `PUBLIC_DOMAIN`/`PUBLIC_PROTOCOL` ao `env.ts` + `.env.example` + `.env.test` (Seção 8.4).

### Fase 2 — Adicionar serviço `nginx` ao Compose (paralelo)
- [ ] Nginx escutando `:80`, `:443` (e `:8080` transição).
- [ ] **Manter** portas públicas de `api`/`hawkbit` (rollback seguro).
- [ ] `depends_on: [api, hawkbit]`.

### Fase 3 — Habilitar forward-headers no hawkBit
- [ ] Adicionar `SERVER_FORWARD_HEADERS_STRATEGY: framework` ao `hawkbit.environment`.
- [ ] Reiniciar hawkBit; confirmar Management API interna OK.

### Fase 4 — Validar pelo Nginx **sem tocar em device** (em `:80`)
- [ ] **API:** `curl -H "Host: api.ninbus.frt.com.br" http://<ip>/health` → 200.
- [ ] **DDI (validação-chave):** `curl -H "Host: hb.ninbus.frt.com.br" http://<ip>/DEFAULT/controller/v1/<hex> -H "Authorization: TargetToken <token>"` → 200/204 e **`_links` com `hb.ninbus.frt.com.br`** (não `hawkbit:8080`).
- [ ] **Bloqueio:** `curl -H "Host: hb.ninbus.frt.com.br" http://<ip>/rest/v1/targets` → **404**.

### Fase 5 — Cutover do device (Opção C — assume a `:8080`)
- [ ] Nginx escuta também `:8080` para o vhost `hb.`.
- [ ] hawkBit **deixa de publicar** `:8080` no host (só interno).
- [ ] Device piloto (1 unidade) pola por `hb.ninbus.frt.com.br:8080` via Nginx.
- [ ] Confirmar `pollStatus.lastRequestAt`/`ipAddress` atualizando.
- [ ] (Rollback em segundos: re-publicar `:8080` do hawkBit.)

### Fase 6 — Lockdown final + TLS da API
- [ ] Remover `ports` do serviço `api` (fica interno).
- [ ] Confirmar `:8081`/`:8082` **não** publicados no host.
- [ ] Emitir cert wildcard; `listen 443 ssl` + redirect 80→443 nos vhosts `api.`/`ninbus.`.
- [ ] Atualizar `BETTER_AUTH_URL`/`CORS_ORIGIN`/`FRONTEND_URL`/`APP_DEEP_LINK_BASE` (Seção 8.4).

### Fase 7 — Endurecimento (inclui recomendações hawkBit da Seção 10)
- [ ] ✅ **Senha do hawkBit:** a credencial `admin:admin` existe **só no `.env` local de testes**.
      Em produção (AWS) a senha **já é forte/complexa** — **nenhuma ação necessária**.
      Apenas confirmar que `HAWKBIT_PASSWORD` no `.env` de produção continua forte.
- [ ] Validar `deviceKey` com 32+ chars no `provisionDeviceSchema` (entrada mais rigorosa).
- [ ] (Opcional) role de least-privilege no hawkBit para o usuário da API.
- [ ] `limit_req` no Nginx + security headers.
- [ ] (Futuro) token rotation + mTLS — condicionado à Seção 9.

---

## 7. Decisões Pendentes

**Para a TI:** (1) security group só 80/443; (2) `hb.` em DNS-only; (3) emitir/autorizar
cert wildcard.

**Para você/firmware:** (4) **domínio:porta atual do firmware**; (5) TLS no embarcado
(Seção 9, não bloqueia).

---

## 8. Proposta de Arquivos (criar só após aprovação) ⛔

### 8.1 `docker/nginx/nginx.conf`
```nginx
worker_processes auto;
events { worker_connections 1024; }
http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    access_log /dev/stdout;
    error_log  /dev/stderr warn;
    limit_req_zone $binary_remote_addr zone=ddi:10m rate=30r/m;
    include /etc/nginx/conf.d/*.conf;
}
```

### 8.2 `docker/nginx/conf.d/ninbus.conf` (3 vhosts — coração da Seção 1)
```nginx
upstream ninbus_api  { server api:8081;     keepalive 16; }
upstream hawkbit_ddi { server hawkbit:8080; keepalive 16; }
client_max_body_size 100m;

# ── vhost 1: API (api.ninbus.frt.com.br) → HTTPS ──
server {
    listen 80;
    server_name api.ninbus.frt.com.br;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name api.ninbus.frt.com.br;
    ssl_certificate     /etc/letsencrypt/live/ninbus.frt.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ninbus.frt.com.br/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options        DENY always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    location / {
        proxy_pass http://ninbus_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering    off;
        proxy_read_timeout 86400s;
        send_timeout       86400s;
    }
}

# ── vhost 2: Dashboard (ninbus.frt.com.br) → HTTPS (placeholder 503) ──
server {
    listen 80;
    server_name ninbus.frt.com.br;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    http2 on;
    server_name ninbus.frt.com.br;
    ssl_certificate     /etc/letsencrypt/live/ninbus.frt.com.br/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ninbus.frt.com.br/privkey.pem;
    location / { return 503; }   # dashboard :8082 ainda não existe
}

# ── vhost 3: hawkBit DDI (hb.ninbus.frt.com.br) → HTTP (device) ──
server {
    listen 80;
    listen 8080;   # Opção C: firmware que já usa :8080
    server_name hb.ninbus.frt.com.br;
    location ~ ^/[^/]+/controller/v1/ {
        proxy_pass http://hawkbit_ddi;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
        proxy_connect_timeout 10s;
        proxy_read_timeout    300s;
        limit_req zone=ddi burst=10 nodelay;
    }
    location /rest/v1/ { return 404; }
    location = /login  { return 404; }
    location /system/  { return 404; }
    location /         { return 404; }
}
```

### 8.3 `docker-compose.yml` — diff proposto
```yaml
services:
  nginx:                         # NOVO — única porta pública
    build: { context: ./docker/nginx, dockerfile: Dockerfile }
    container_name: ninbus-nginx
    restart: unless-stopped
    ports: ["80:80", "443:443", "8080:8080"]   # 8080 = Opção C
    volumes:
      - ./docker/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/www:/var/www/certbot:ro
      - ./certbot/conf:/etc/letsencrypt:ro
    depends_on: [api, hawkbit]
  api:
    # REMOVER 'ports' na Fase 6
  hawkbit:
    # REMOVER 'ports' na Fase 5
    environment:
      SERVER_FORWARD_HEADERS_STRATEGY: framework   # NOVO
```

### 8.4 Variáveis de ambiente (centralizadas em `env.ts`)
```ts
// src/common/config/env.ts — adicionar:
PUBLIC_DOMAIN: Type.Optional(Type.String({ description: 'Domínio público da API (ex.: api.ninbus.frt.com.br)' })),
PUBLIC_PROTOCOL: Type.Optional(Type.Union([Type.Literal('http'), Type.Literal('https')], { default: 'https' })),
```
```env
# .env (produção) — ATUALIZAR para os domínios reais (hoje .env.docker está stale com ninbus.com):
BETTER_AUTH_URL=https://api.ninbus.frt.com.br
CORS_ORIGIN=https://ninbus.frt.com.br
FRONTEND_URL=https://ninbus.frt.com.br
APP_DEEP_LINK_BASE=https://ninbus.frt.com.br
PUBLIC_DOMAIN=api.ninbus.frt.com.br
PUBLIC_PROTOCOL=https
# HAWKBIT_URL http://hawkbit:8080  ← interno, NÃO muda
```

### 8.5 Ajustes opcionais de código (NÃO obrigatórios para o Nginx)
| Onde | Hoje | Proposta | Por quê |
|------|------|----------|---------|
| `artifacts/service.ts:201` | `downloadUrl` usa `http://hawkbit:8080/...` (interno) | `PUBLIC_PROTOCOL://PUBLIC_DOMAIN` (ou CDN) | Link quebra no Flutter; independente do proxy |
| `src/modules/sse/index.ts` | SSE sem header de buffer | `X-Accel-Buffering: no` | Permite `proxy_buffering on` sem quebrar SSE |

---

## 9. ✉️ Mensagem para o Agente de Firmware (TLS no embarcado)

> **Não bloqueia o rollout.** A resposta define só a evolução futura. Copie/cole:

---

**Assunto:** Domínio/porta do firmware + viabilidade de TLS (HTTPS) para o DDI

Contexto: estamos colocando um proxy reverso (Nginx) na frente do servidor para isolar
o hawkBit (a porta 8080 dele está exposta com Management API + UI acessíveis). A DDI
passará pelo Nginx no domínio **`hb.ninbus.frt.com.br`** (em HTTP, como hoje). O
**download de firmware continua pelo CloudFront** (não muda). O rollout **não exige
mudar o firmware** (Opção C — mesma porta).

1. **Domínio e porta atuais:** o firmware hoje conecta em qual **domínio:porta**?
   (Precisamos saber se bate com `hb.ninbus.frt.com.br:8080`.)
2. **Configurabilidade:** domínio e porta são configuráveis (comando serial / E2PROM)
   ou hardcoded? Se configuráveis, podemos migrar para `:80` (URL limpa) sem reflash.
3. **Stack TLS:** o STM32 tem mbedTLS/wolfSSL? Orçamento de RAM/flash para incluir?
4. **Validação de certificado:** se houver TLS, faria validação completa (CA + expiração)?
   Há RTC/fonte de tempo confiável?
5. **Token storage (recomendação hawkBit):** o securityToken (deviceKey) é armazenado de
   forma segura no hardware (TPM, secure element, E2PROM protegida)?
6. **Esforço/trade-off:** dias para HTTPS completo no caminho da DDI? Risco do handshake
   ser inviável no hardware?

---

## 10. 🆕 Conformidade com as Recomendações Oficiais do hawkBit

> Mapeamento de cada recomendação ao estado atual do sistema (confirmado no código).
> ✅ já atende · 🟡 parcial / a melhorar · 🔴 a corrigir

### 10.1 Management API

| Recomendação hawkBit | Status | Evidência / Ação |
|----------------------|--------|------------------|
| **Access Control** (RBAC na Management API) | 🟡 | Hoje o hawkBit usa 1 role `TENANT_ADMIN` (full). **Com o proxy**, a Management API fica **inacessível publicamente** (404) — o único acesso é interno, via Ninbus API, que **já tem RBAC próprio** (`companyRole`, `superAdmin`). A exposição cai a zero. Ação: trocar a credencial do hawkBit (abaixo). |
| **Credentials** (senhas fortes + API keys p/ automação) | ✅ | **Produção já tem senha forte/complexa** (o `admin:admin` é apenas do `.env` local de testes). A app Ninbus é o único "sistema automatizado" — usa Basic Auth **interno** (rede Docker). Com o proxy, a Management API nem é exposta publicamente. Ação: só manter a boa prática. |
| **HTTPS** (sempre em produção) | 🟡 | A Management API é **interna** (rede Docker), não precisa de HTTPS público. **O caminho público `api.` já vira HTTPS** via proxy (Fase 6). O DDI fica HTTP por ora (firmware). Ação: TLS interno é opcional (defesa em profundidade). |
| **Token Generation** (32+ chars, crypto-random) | 🟡 | O `securityToken` vem da **fábrica** (`deviceKey`, modo B) — o Ninbus **não o gera nem armazena**. **Ação Fase 7:** validar `minLength: 32` no `provisionDeviceSchema` para rejeitar tokens curtos na entrada. |
| **Least Privilege** (role mínima p/ cada sistema) | 🟡 | Atualmente `TENANT_ADMIN` (full). hawkBit suporta roles granulares (`CREATE_TARGET`, `READ_TARGET`, etc.). **Ação opcional Fase 7:** criar um usuário de serviço para a API com apenas as permissões que ela usa (criar targets/DS/SM/artifacts, ler pollStatus). Reduz blast radius. |

### 10.2 DDI API

| Recomendação hawkBit | Status | Evidência / Ação |
|----------------------|--------|------------------|
| **Gateway Token** (nunca em produção; preferir per-device) | ✅ | **Já atende.** Cada dispositivo tem seu próprio `deviceKey` → `securityToken` único. Não há gateway token compartilhado. (`provisioning.ts:51`, `:171`) |
| **Token Storage** (TPM / secure element) | 🟠 | Responsabilidade do **firmware**. O Ninbus **nunca armazena** o `deviceKey` (passa só ao hawkBit). Ação: confirmar com firmware (Seção 9, pergunta 5). |
| **Certificate Auth** (mTLS para máxima segurança) | 🔴 | Não implementado. Requer TLS no firmware (mbedTLS) + PKI. **Futuro** — condicionado à Seção 9. Com o proxy, mesmo sem mTLS, a Management API deixa de ser exposta. |
| **Token Rotation** | 🟡 | Não implementado. O fluxo existe via Ninbus (re-provisionar atualiza o target). **Futuro:** endpoint de rotation que regenera o `securityToken` no hawkBit + regrava o device. |
| **Auto-Registration** (desabilitar em prod) | ✅ | **Já atende.** `HAWKBIT_AUTOPROVISIONING=false` em `.env`, `.env.docker` e default do compose. Só dispositivos pré-registrados via `POST /provision` conectam. |

### 10.3 Resumo do hardening pós-plano

| Item | Hoje | Após o plano |
|------|------|--------------|
| Management API exposta | 🔴 sim (`:8080` pública, `admin:admin`) | ✅ não (404 público, só interna) |
| Senha do hawkBit | 🔴 `admin` | ✅ 32+ chars |
| Auto-registration | ✅ já `false` | ✅ mantido |
| Per-device token | ✅ já | ✅ mantido |
| Validação de token 32+ chars | 🟡 não validado | ✅ no schema |
| TLS no DDI | 🟠 HTTP | 🟠 HTTP (consultar firmware p/ futuro HTTPS) |
| mTLS / rotation | 🔴 não | 🟠 futuro (roadmap, Seção 9) |

> **Conclusão:** o sistema **já atende a maioria** das recomendações de DDI (per-device
> token, auto-registration off). As **falhas reais** que o proxy + Fase 7 resolvem são:
> (1) Management API exposta, (2) senha fraca, (3) Management sem HTTPS público. mTLS e
> rotation ficam como roadmap futuro condicionado à capacidade do firmware.

---

## 11. Riscos e Mitigações

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| `_links` DDI com host interno → devices param | Alta se esquecer forward-headers | 🔴 | Fase 3 + validação Fase 4 |
| Fechar `:8080` antes de validar → frota offline | Média | 🔴 | Rollout paralelo; cutover só na Fase 5 após piloto |
| TI não fechar 8080/8081/8082 no security group | — | 🔴 | **Fase 0 (bloqueante):** alinhar Seção 2.3 |
| `hb.` atrás de proxy Cloudflare → força HTTPS | Média | 🟠 | `hb.` em DNS-only (Seção 5.2) |
| Firmware usa domínio/porta diferente de `hb…:8080` | — | 🟠 | Confirmar (Seção 9, pergunta 1) |
| SSE cair por buffering | Baixa | 🟡 | `proxy_buffering off` no vhost `api.` |
| Rate-limit da app agrupar em 1 IP | — | — | Já mitigado: app lê `x-forwarded-for` |
| Cert wildcard expira/renova falha | Baixa | 🟠 | certbot renew em cron; só afeta `api.`/`ninbus.` |
| Management API exposta por erro de config | Baixa | 🔴 | Whitelist explícita + `return 404` no vhost `hb.` |

---

## 12. Checklist de Validação (aceitação do rollout)

- [ ] `GET https://api.ninbus.frt.com.br/health` → 200 JSON da API Ninbus.
- [ ] `GET https://api.ninbus.frt.com.br/docs` → Swagger.
- [ ] `GET http://hb.ninbus.frt.com.br:8080/DEFAULT/controller/v1/<serial>` com `TargetToken` → 200/204 e **`_links` com `hb.ninbus.frt.com.br`**.
- [ ] `GET http://hb.ninbus.frt.com.br:8080/rest/v1/targets` → **404** (Management protegida).
- [ ] Device piloto pola pelo Nginx: `lastRequestAt`/`ipAddress` atualizam.
- [ ] Device piloto recebe deployment e **baixa do CloudFront**.
- [ ] SSE Flutter: evento recebido em < 2s.
- [ ] `:8080`/`:8081`/`:8082` **não** publicados no host após lockdown.
- [ ] Security group do AWS: só 80/443 públicos.
- [ ] `.env` produção: domínios `*.frt.com.br`; `HAWKBIT_PASSWORD` forte (32+).

---

## 13. O que NÃO vou fazer sem sua aprovação

- ❌ Não criar/editar `docker-compose.yml`, `Dockerfile`, `env.ts`, `.env*`.
- ❌ Não criar os arquivos do Nginx.
- ❌ Não fazer commit, nem reiniciar/rebuildar containers.
- ❌ Não tocar no firmware.

Após sua aprovação, executo fase a fase começando pela **Fase 1 + 3**, validando em
`:80` com `curl` **antes** de qualquer cutover de device (Opção C — zero dispositivo
tocado). A **Fase 0 (TI)** é bloqueante e precisa ser alinhada primeiro.
