# Security Deep Dive — Ninbus API

Este documento complementa o SKILL.md com análises de segurança específicas do projeto.

---

## 1. Superfície de Ataque

### 1.1 Entradas Externas

| Vetor | Mitigação | Status |
|-------|-----------|--------|
| Body JSON | TypeBox validation via Elysia | ✅ |
| URL Params | `t.String({ format: 'uuid' })` | ✅ |
| Query Params | `t.Object({...})` nos endpoints com query | ✅ |
| Headers (Auth) | Better Auth session validation | ✅ |
| Cookies | httpOnly, secure, sameSite=lax | ✅ |
| CORS | Whitelist de origins configurável | ✅ |
| Artifact Type | `t.Union([t.Literal(...)])` — whitelist de 3 tipos | ✅ |
| Artifact Compatibility | Pre-flight check contra `ninbus-wifi-v3` | ✅ |
| Artifact Generate | Raw file extension whitelist + size limit (100MB) | ✅ |

### 1.2 Vulnerabilidades Endereçadas

| Vulnerabilidade | OWASP | Mitigação |
|----------------|-------|-----------|
| SQL Injection | A03:2021 | Drizzle ORM parameterized queries |
| Broken Authentication | A07:2021 | Better Auth + httpOnly cookies + CSRF |
| Sensitive Data Exposure | A02:2021 | No stack traces em prod, env validation |
| Security Misconfiguration | A05:2021 | Strict cookies, CORS whitelist, fail-fast env |
| Rate Limiting | A07:2021 | LRU Cache per IP, auth-specific limits |
| Mass Assignment | A08:2021 | Body schemas explícitos (whitelist de campos) |
| Insecure OTA | A08:2021 | Artifact type whitelist + device_type compatibility |
| Broken Access Control | A01:2021 | Company membership check em todas as rotas scoped |

### 1.3 Segurança OTA — Tipos de Artefato

A validação de tipo de artefato é uma camada crítica de segurança:

1. **Type whitelist**: Apenas 3 tipos são aceitos (`firmware-ninbus`, `firmware-controller`, `configuration-nfx`). Qualquer outro tipo → 400.
2. **Device type compatibility**: `validateArtifactForDeployment()` verifica `device_types_compatible` inclui `ninbus-wifi-v3`.
3. **Risk level enforcement**: `firmware-ninbus` tem risco HIGH e causa reboot. O frontend pode usar `riskLevel` para solicitar confirmação extra.
4. **Pre-validation**: Antes de criar o deployment no Mender, o serviço valida que o artefato existe e é do tipo correto.
5. **422 específico**: Erros claros para artifact not found / not compatible / no eligible devices.

### 1.4 Segurança — Mender PAT

O PAT (Personal Access Token) do Mender é a credencial mais sensível do sistema:

- **Armazenamento**: Via `MENDER_PAT` env var ou secret manager. NUNCA no código.
- **Rotação**: A cada 6-12 meses em produção.
- **Privilégios**: O PAT tem `mender.*` (full access ao tenant). Não há granularidade por endpoint.
- **Isolamento**: O PAT é por tenant. Cada empresa deve ter seu próprio tenant e PAT no Mender.
- **Timeout**: Chamadas Mender têm timeout de 30s (configurável via `MENDER_TIMEOUT_MS`).

### 1.5 Segurança — Company Isolation

O isolamento multi-tenant funciona em duas camadas:

1. **Ninbus API layer**: `isCompanyMember(companyId, userId)` verifica membership.
2. **Mender Gateway layer**: O PAT é scoped por tenant. O Mender filtra automaticamente por `mender.tenant`.

**⚠️ Gap conhecido**: Se duas empresas compartilham o mesmo PAT/tenant, o Ninbus API layer é o único isolamento.
**Recomendação**: Um PAT por tenant (empresa) no Mender.

### 1.6 Pontos de Atenção

1. **Rate limiting em memória** — Não funciona em ambientes multi-instância.
   **Recomendação**: Para produção com múltiplas réplicas, usar Redis-backed rate limiter.

2. **Session storage** — Better Auth usa database-backed sessions.
   **Recomendação**: Para alta escala, considerar Redis.

3. **Email template injection** — Templates de email usam interpolação direta de URL.
   **Recomendação**: Sanitizar URLs em templates.

4. **Secret rotation** — `BETTER_AUTH_SECRET` e `MENDER_PAT` não têm mecanismo de rotação automática.
   **Recomendação**: Documentar processo de rotação e usar vault.

5. **Mender device decommission** — `DELETE /devices/:id` no Ninbus API remove do DB local mas não descomissiona automaticamente do Mender.
   **Recomendação**: Implementar cascade decommission no Mender ao remover device local.

---

## 2. Headers de Segurança Recomendados

Adicionar ao app via middleware ou reverse proxy:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Content-Security-Policy: default-src 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

---

## 3. Logs & Auditoria

### O que é logado:
- Toda request (método, path, status, duração) via `requestLogger`
- Erros com code e message via `onError`
- Emails enviados/falharam
- Rate limit blocks (em dev)
- Mender API errors (status, endpoint, method, error body)

### O que NÃO deve ser logado:
- Passwords
- Tokens de sessão
- API keys (Mender PAT, Resend API key)
- PII desnecessário

### Recomendação:
Implementar audit log para operações sensíveis registrando:
`userId`, `companyId`, `ação` (create/update/delete), `resourceType`, `resourceId`, `timestamp`, `ip`, `artifactType` (para deployments).

---

## 4. CI/CD Security

- **Dependabot** habilitado (`.github/dependabot.yml`)
- **CI** roda lint + test + migration (GitHub Actions)
- **Docker** usa non-root user (`USER bun`)
- **Secrets** via environment, não hardcoded
- **Test env** isolado (`.env.test` com secret dedicado)

---

## 5. Threat Model — Cenários Específicos

### 5.1 Unauthorized OTA Deploy

**Ameaça**: Usuário cria deployment para devices de outra empresa.
**Mitigação**: `isCompanyMember()` + `resolveMenderDeviceIds()` filtra por `companyId`.

### 5.2 Malicious Artifact Type

**Ameaça**: Atacante envia `artifactType: 'rootfs-image'` para injetar firmware arbitrário.
**Mitigação**: `t.Union([t.Literal('firmware-ninbus'), ...])` — whitelist de 3 valores.

### 5.3 Cross-Company Device Access

**Ameaça**: Operações Mender via device ID de outra empresa.
**Mitigação**: Device IDs são resolvidos a partir da tabela `devices` filtrada por `companyId`.

### 5.4 PAT Compromise

**Ameaça**: Mender PAT vazou.
**Mitigação**: Rotacionar PAT via `DELETE /settings/tokens/:id` + criar novo.
**Impacto**: Acesso completo ao tenant Mender até rotação.

### 5.5 Firmware Supply Chain

**Ameaça**: Artefato malicioso uploaded via Mender.
**Mitigação**: O Mender valida integridade do artefato (checksum). O dispositivo verifica hash antes de instalar.
**Gap**: Não há assinatura digital do artefato.
**Recomendação**: Implementar signing de artefatos no pipeline de build.
