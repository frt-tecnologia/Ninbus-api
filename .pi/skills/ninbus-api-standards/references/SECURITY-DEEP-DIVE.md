# Security — Ninbus API

---

## Superfície de Ataque

| Vetor | Mitigação |
|-------|-----------|
| Body JSON | TypeBox validation |
| URL Params | `t.String({ format: 'uuid' })` |
| Auth | Better Auth + httpOnly cookies |
| CORS | Whitelist configurável |
| File Upload | Extensão whitelist + 100MB limit |
| Rate Limiting | LRU por IP |

---

## Auth Layers

1. **Super Admin** — `SUPER_ADMIN_EMAILS` env var (impossível auto-promover)
2. **Company RBAC** — owner > admin > operator > viewer
3. **hawkBit** — Management API: Basic Auth · DDI: TargetToken

---

## hawkBit DDI Security

- TargetToken obrigatório (`authentication.targettoken.enabled=true`)
- Cada dispositivo tem securityToken único (gravado na E2PROM)
- deviceKey NUNCA armazenado no DB local
- Auto-provisioning desabilitado por padrão
- Background sync é read-only (hawkBit → DB local, nunca o contrário)

---

## Multi-Tenant Isolation

- `checkMembership(companyId, userId)` em todas as rotas de empresa
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

## Pontos de Atenção

1. Rate limiting em memória (multi-instância → usar Redis)
2. Secrets sem rotação automática (documentar processo)
3. Assinatura digital de artefatos (gap — implementar no pipeline)
