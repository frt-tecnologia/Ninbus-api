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
| Serial Number | Normalização + validação de formato hex | ✅ |
| File Upload | Extensão whitelist + size limit (100MB) | ✅ |

### 1.2 Vulnerabilidades Endereçadas

| Vulnerabilidade | OWASP | Mitigação |
|----------------|-------|-----------|
| SQL Injection | A03:2021 | Drizzle ORM parameterized queries |
| Broken Authentication | A07:2021 | Better Auth + httpOnly cookies + CSRF |
| Sensitive Data Exposure | A02:2021 | No stack traces em prod, env validation |
| Security Misconfiguration | A05:2021 | Strict cookies, CORS whitelist, fail-fast env |
| Rate Limiting | A07:2021 | LRU Cache per IP, auth-specific limits |
| Mass Assignment | A08:2021 | Body schemas explícitos (whitelist de campos) |
| Broken Access Control | A01:2021 | Company membership + super admin check |
| Insecure OTA | A08:2021 | Artifact type whitelist + hawkBit securityToken |

### 1.3 Segurança — hawkBit TargetToken

O DDI (Device Direct Integration) usa autenticação TargetToken:

1. **TargetToken auth obrigatório**: hawkBit 1.0.3 vem com `authentication.targettoken.enabled=false`. **DEVE ser habilitado** via env var ou Management API.
2. **SecurityToken único por target**: Cada dispositivo tem seu token (gravado na E2PROM). O hawkBit compara o header `Authorization: TargetToken <valor>` com o campo `securityToken` do target.
3. **deviceKey nunca armazenado**: O Ninbus API passa o deviceKey como securityToken ao hawkBit mas NÃO armazena no DB local. Nunca é retornado em API responses.
4. **Auto-provisioning seguro**: Mesmo com auto-provisioning habilitado, o dispositivo deve enviar o securityToken correto. hawkBit não aceita conexões anônimas.

### 1.4 Segurança — hawkBit Basic Auth (Management API)

O Management API usa HTTP Basic Auth (username:password):

- **Armazenamento**: Via `HAWKBIT_USERNAME` e `HAWKBIT_PASSWORD` env vars
- **Comunicação**: Header `Authorization: Basic <base64(user:pass)>`
- **Isolamento**: O Ninbus API é o único cliente do Management API — dispositivos nunca acessam diretamente
- **TLS**: Em produção, hawkBit deve estar atrás de reverse proxy com TLS

### 1.5 Segurança — Company Isolation

O isolamento multi-tenant funciona em duas camadas:

1. **Ninbus API layer**: `isCompanyMember(companyId, userId)` verifica membership.
2. **Super admin bypass**: Emails em `SUPER_ADMIN_EMAILS` bypassam checks de company.

### 1.6 Segurança — Platform Routes vs Company Routes

| Tipo | Prefixo | Auth | Exemplo |
|------|---------|------|---------|
| Platform | `/api/devices/provision` | `auth: true` | Provisionamento (sem company) |
| Company | `/api/companies/:companyId/devices` | `companyRole: 'operator'` | CRUD de devices |

**Regra**: Rotas sem `:companyId` no path usam APENAS `auth: true`. Nunca `companyRole` — causa "Company ID is required" porque o macro procura `params.companyId`.

### 1.7 Pontos de Atenção

1. **Rate limiting em memória** — Não funciona em ambientes multi-instância.
   **Recomendação**: Para produção com múltiplas réplicas, usar Redis-backed rate limiter.

2. **Session storage** — Better Auth usa database-backed sessions.
   **Recomendação**: Para alta escala, considerar Redis.

3. **Secret rotation** — `BETTER_AUTH_SECRET` e hawkBit credentials não têm mecanismo de rotação automática.
   **Recomendação**: Documentar processo de rotação e usar vault.

---

## 2. hawkBit DDI — Detalhes de Segurança

### 2.1 Fluxo de Autenticação DDI

```
Device → GET /{tenant}/controller/v1/{controllerId}
         Authorization: TargetToken {securityToken}
         
hawkBit → Verifica authentication.targettoken.enabled == true
       → Busca target by controllerId
       → Compara securityToken do target com header
       → 200 se confere, 401 se não
```

### 2.2 Configurações Críticas do hawkBit

| Config | Default | Obrigatório | Descrição |
|--------|---------|-------------|-----------|
| `authentication.targettoken.enabled` | `false` | **true** | Habilita TargetToken auth |
| `authentication.gatewaytoken.enabled` | `false` | false | Gateway token (não usado) |
| `hawkbit.server.ddi.autoprovisioning.enabled` | `false` | true | Auto-cria target no primeiro poll |

### 2.3 Verificação via Management API

```bash
# Verificar se TargetToken auth está habilitado
curl http://localhost:8080/rest/v1/system/configs/authentication.targettoken.enabled \
  -H "Authorization: Basic $(echo -n admin:admin | base64)"

# Verificar security token de um target
curl http://localhost:8080/rest/v1/targets/{controllerId} \
  -H "Authorization: Basic $(echo -n admin:admin | base64)"
# → {"securityToken": "key-test", ...}
```

---

## 3. Super Admin — Controle via Env Var

### 3.1 Mecanismo

```typescript
// env.ts
SUPER_ADMIN_EMAILS: Type.Optional(Type.String())

// Uso
const superAdmins = env.SUPER_ADMIN_EMAILS?.split(',').map(e => e.trim()) ?? [];
function isSuperAdmin(email: string): boolean {
  return superAdmins.includes(email);
}
```

### 3.2 O que o super admin pode fazer

- Criar companies sem ser owner
- Acessar qualquer company sem ser membro
- Ver todos os devices
- Provisionar devices

### 3.3 O que o super admin NÃO pode fazer

- Auto-promover (emails são fixos no env)
- Promover outros a super admin (apenas via env var + restart)

---

## 4. Logs & Auditoria

### O que é logado:
- Toda request (método, path, status, duração) via `requestLogger`
- Erros com code e message via `onError`
- hawkBit API errors (status, endpoint, method, error body)
- Provisionamento: serial normalization, target creation
- Rate limit blocks (em dev)

### O que NÃO deve ser logado:
- Passwords
- Session tokens
- hawkBit credentials
- deviceKey / securityToken
- PII desnecessário

---

## 5. Threat Model — Cenários Específicos

### 5.1 Unauthorized Device Provisioning

**Ameaça**: Dispositivo não autorizado se provisiona no hawkBit.
**Mitigação**: Auto-provisioning exige securityToken correto. hawkBit rejeita tokens inválidos (401).

### 5.2 Cross-Company Device Access

**Ameaça**: Operações em devices de outra empresa.
**Mitigação**: `checkMembership()` verifica company. `resolveTargetIds()` filtra por companyId.

### 5.3 Token Compromise

**Ameaça**: deviceKey/securityToken vazou.
**Mitigação**: Re-provisionar via API com novo token. Gravar novo token na E2PROM via serial.
**Impacto**: Apenas o device afetado.

### 5.4 hawkBit Management API Exposure

**Ameaça**: Acesso não autorizado ao Management API do hawkBit.
**Mitigação**: hawkBit não exposto publicamente — apenas Ninbus API acessa (Docker network). Basic Auth forte.
**Recomendação**: Em produção, usar reverse proxy + TLS + IP whitelist.

### 5.5 Malicious Firmware Upload

**Ameaça**: Artefato malicioso uploaded.
**Mitigação**: hawkBit valida integridade (checksum). O dispositivo verifica hash antes de instalar.
**Gap**: Assinatura digital do artefato.
**Recomendação**: Implementar signing de artefatos no pipeline de build.
