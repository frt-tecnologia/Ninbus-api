# Security — Ninbus API

---

## Superfície de Ataque

| Vetor | Mitigação |
|-------|-----------|
| Body JSON | TypeBox validation |
| URL Params | `t.String({ format: 'uuid' })` |
| Auth | Better Auth + httpOnly cookies + Bearer token |
| CORS | Whitelist configurável via `CORS_ORIGIN` |
| File Upload | Extensão whitelist (.fir/.frz/.bin) + 100MB limit |
| Rate Limiting | LRU por IP |

---

## Auth Layers

1. **Super Admin** — `SUPER_ADMIN_EMAILS` env var (impossível auto-promover)
2. **Company RBAC** — owner(4) > admin(3) > operator(2) > viewer(1)
3. **hawkBit** — Management API: Basic Auth · DDI: TargetToken

### Better Auth

- Plugins: `[bearer()]` (array, não objeto)
- Sessões: cookie httpOnly (`auth.session_token`) assinado com HMAC
- Bearer: `Authorization: Bearer <token>` para API clients/mobile
- Sessão TTL: 7 dias, update a cada 1 dia
- secure cookies em produção (`NODE_ENV=production`)

---

## hawkBit DDI Security

- TargetToken obrigatório (`HAWKBIT_DDI_TARGET_TOKEN_AUTH=true`)
- Cada dispositivo tem securityToken único (gravado na E2PROM)
- deviceKey NUNCA armazenado no DB local
- Auto-provisioning desabilitado por padrão (`HAWKBIT_AUTOPROVISIONING=false`)
- Background sync é read-only (hawkBit → DB local, nunca o contrário)

---

## Multi-Tenant Isolation

- `companyRole` macro em todas as rotas de empresa
- Super admin bypassa checks de company
- Device delete = unclaim (hawkBit target preservado)
- Apenas deprovision (super admin) remove do hawkBit

---

## Platform vs Company Routes

| Tipo | Prefixo | Auth |
|------|---------|------|
| Platform | `/api/devices/provision` | `auth: true` |
| Company | `/api/companies/:cid/...` | `companyRole: 'viewer'+` |

Rotas sem `:companyId` NUNCA usam `companyRole`.

---

## CDN Download Security

- S3 bucket privado (OAC para CloudFront, IAM para R2)
- CloudFront: RSA signed URLs (private key lida de arquivo, não env var)
- R2: HMAC presigned URLs (reutiliza credenciais S3 existentes)
- Chave RSA nunca aparece em logs
- URLs expiram em `HAWKBIT_CDN_EXPIRY_SEC` segundos (default: 3600)
