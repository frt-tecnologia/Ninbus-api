# 📡 Ninbus — Provisionamento de Dispositivos & Segurança

> Arquitetura completa do fluxo device-to-cloud, auto-provisionamento,
> visibilidade admin e proteção contra escalação de privilégios.

---

## 1. Os Dois Modos de Provisionamento

hawkBit suporta **dois modelos de autenticação de dispositivo** via DDI API
(Device Direct Integration). Ambos usam o mesmo endpoint de polling:

```
GET /{tenant}/controller/v1/{controllerId}
```

### Modo A — Token do Servidor (Pull Model)

```
┌──────────────┐                         ┌──────────────────┐
│  Admin Panel │                         │  hawkBit Server   │
│  (Ninbus)    │                         │                  │
└──────┬───────┘                         └────────┬─────────┘
       │                                          │
       │ 1. POST /targets                         │
       │    {controllerId: "SN-ABC123",            │
       │     securityToken: "server-gen-token"}    │
       │─────────────────────────────────────────>│
       │                                          │
       │ 2. Instala firmware no dispositivo        │
       │    com controllerId + securityToken       │
       │    gravados na flash                      │
       │                                          │
       │                                          │
┌──────┴───────┐                                 │
│  Ninbus WiFi │  3. GET /controller/v1/SN-ABC123 │
│  (ESP8266)   │  Header: Authorization:          │
│              │    TargetToken server-gen-token   │
│              │─────────────────────────────────>│
│              │  4. 200 OK (configuração)         │
│              │<─────────────────────────────────│
│              │  5. Faz polling a cada 3 min      │
│              │─────────────────────────────────>│
└──────────────┘                                 │
```

**Fluxo:**
1. Admin cria o target no hawkBit (via Ninbus API) com `controllerId` (serial number) e `securityToken` gerado pelo servidor
2. Admin grava firmware + credenciais no dispositivo durante a instalação física
3. Dispositivo liga, faz primeiro polling com o token → hawkBit reconhece
4. hawkBit envia configuração, ações de deployment etc.

**Vantagem:** Segurança máxima — cada token é único, gerado pelo servidor, revogável.
**Desvantagem:** Requer intervenção manual na gravação do firmware.

### Modo B — Chave do Dispositivo (Push Model / Auto-Provisionamento)

```
┌──────────────┐                         ┌──────────────────┐
│  Ninbus WiFi │                         │  hawkBit Server   │
│  (ESP8266)   │                         │                  │
│              │                         │                  │
│  Gravado de  │                         │                  │
│  fábrica:    │                         │                  │
│  - serialNum │                         │                  │
│  - deviceKey │                         │                  │
└──────┬───────┘                         └────────┬─────────┘
       │                                          │
       │ 1. GET /controller/v1/{serialNum}         │
       │    Header: Authorization:                  │
       │      TargetToken {deviceKey}               │
       │─────────────────────────────────────────>│
       │                                          │
       │  hawkBit: target não existe               │
       │  + targetToken não confere                │
       │  → 401 Unauthorized                       │
       │<─────────────────────────────────────────│
       │                                          │
       │                                          │
┌──────┴───────┐                                 │
│  Admin Panel │ 2. POST /api/companies/:id/       │
│  (Ninbus)    │    devices                        │
│              │    {serialNumber: "SN-ABC123"}     │
│              │─────────────────────────────────>│
│              │                                         ┌──────────────────┐
│              │  Ninbus API cria target no hawkBit:       │  hawkBit Server   │
│              │  POST /rest/v1/targets                    │                  │
│              │  {controllerId: "SN-ABC123",              │                  │
│              │   securityToken: "deviceKey"}             │                  │
│              │─────────────────────────────────────────>│                  │
│              │                                          │                  │
└──────┬───────┘                                         │                  │
       │                                          │                  │
       │ 3. GET /controller/v1/SN-ABC123           │                  │
       │    Header: TargetToken deviceKey           │                  │
       │─────────────────────────────────────────>│                  │
       │  200 OK ✅                                 │                  │
       │<─────────────────────────────────────────│                  │
```

**Fluxo:**
1. Cada Ninbus WiFi sai de fábrica com serial number + device key gravados (fused/OTP)
2. Dispositivo tenta polling → 401 (target não existe)
3. Admin registra dispositivo via Ninbus API com `serialNumber`
4. Ninbus API cria target no hawkBit com `securityToken = deviceKey`
5. Próximo polling do dispositivo → 200 OK → auto-provisionado

**Vantagem:** Sem intervenção no firmware — o dispositivo já vem com suas credenciais.
**Desvantagem:** Requer que a fábrica grave um key único por dispositivo.

### Qual usar?

| Critério | Modo A (Server Token) | Modo B (Device Key) |
|----------|----------------------|---------------------|
| Segurança | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Escalabilidade | Manual por dispositivo | **Automatizado** |
| Custo operacional | Alto (técnico no local) | **Baixo (self-service)** |
| Revogação | Re-flash do firmware | API call |
| Indicado para | Protótipos, poucos devices | **Produção (100k+)** |

**Recomendação:** Modo B para produção. Cada dispositivo sai com serial+key da fábrica.
O admin só precisa cadastrar o serial number no painel.

---

## 2. Fluxo Completo de Auto-Provisionamento (Modo B)

### 2.1 Setup Inicial (uma vez por empresa)

```
Admin → POST /api/companies
       { name: "FRT Express" }
       → 201 { data: { id: "comp-uuid", hawkbitTenantId: null } }
```

### 2.2 Registro do Dispositivo (por dispositivo)

```
Admin → POST /api/companies/{companyId}/devices
       {
         name: "Bus FRT-001",
         serialNumber: "SN-ABC123"     // gravado na flash na fábrica
       }
       → 201 {
            message: "Device registered successfully",
            data: {
              id: "dev-uuid",
              status: "pending",          // aguardando hawkBit link
              hawkbitTargetId: null
            }
          }
```

**O que acontece internamente (service + sync):**

1. `registerDevice()` insere no DB local com `status: "pending"`
2. `DeviceSyncEngine.syncCompany()` é chamado
3. O sync engine busca targets no hawkBit e tenta match por `serialNumber`
4. Se encontrou → atualiza `hawkbitTargetId` + `status: "accepted"`
5. Se não encontrou → permanece `pending`

**Mas espera — o target ainda não existe no hawkBit!** É aqui que entra o enhancement:

### 2.3 Auto-Criação do Target no hawkBit ( Enhancement Necessário )

Hoje o sync engine apenas **busca** targets existentes. Para auto-provisionamento,
precisamos **criar** o target no hawkBit quando o dispositivo é registrado:

```
registerDevice({ serialNumber: "SN-ABC123" })
  → insere no DB com status: "pending"
  → cria target no hawkBit:
      POST /rest/v1/targets
      [{
        controllerId: "SN-ABC123",
        name: "Bus FRT-001",
        securityToken: "deviceKey-from-manifest"  // ou gerado pelo servidor
      }]
  → atualiza DB: hawkbitTargetId = "SN-ABC123", status: "accepted"
```

**Problema:** De onde vem o `securityToken`?

- **Se o dispositivo já tem key da fábrica:** O admin fornece via API
  (`deviceKey` field no body do register)
- **Se não tem key (protótipo):** O servidor gera um token aleatório
  e o admin grava no dispositivo via UART/USB

### 2.4 Dispositivo Conecta (automático)

```
Ninbus WiFi liga →
  GET http://hawkbit:8080/DEFAULT/controller/v1/SN-ABC123
  Authorization: TargetToken <securityToken>
  → 200 OK + config + polling interval
  → Dispositivo começa a fazer polling a cada 3 minutos
  → hawkBit registra lastRequestAt, ipAddress, pollStatus
```

### 2.5 O Dispositivo Precisa ser Adicionado na Company?

**SIM.** O fluxo é:

1. ✅ Admin registra dispositivo na company via API
2. ✅ API cria target no hawkBit com `securityToken`
3. ✅ Dispositivo faz polling → hawkBit reconhece
4. ✅ Sync engine atualiza status para "accepted"
5. ✅ Dispositivo aparece no painel da company

O dispositivo **nunca** se auto-registra diretamente. Sempre passa pelo admin.
Isso é uma decisão de segurança — evita dispositivos não autorizados.

---

## 3. Visibilidade Admin (Cross-Company)

### 3.1 Situação Atual

O modelo atual é **company-scoped**:

```
GET /api/companies/:companyId/devices  → apenas devices DA company
```

Não existe hoje um endpoint que lista **todos** os dispositivos de **todas** as companies.

### 3.2 O Que Falta para Admin Global

Precisamos de um **role global** (super admin / platform admin):

| Role | Escopo | Permissões |
|------|--------|------------|
| `owner` | Company | CRUD devices, members, deployments |
| `admin` | Company | Mesmas do owner (menos transferir ownership) |
| `operator` | Company | CRUD devices, deployments (não members) |
| `viewer` | Company | Apenas leitura |
| **`super_admin`** | **Global** | **Todas companies, todos devices** |

### 3.3 Endpoints Necessários (sem criar novos!)

Podemos otimizar os endpoints existentes adicionando **query params**:

#### Opção A: Query param `?global=true` (Super Admin)

```
GET /api/devices?global=true
  → requer role super_admin
  → retorna todos devices de todas companies
  → com paginação: ?page=1&perPage=50
  → com filtros: ?status=accepted&search=SN-ABC&companyId=uuid

GET /api/devices?global=true&companyId=uuid
  → dispositivos de uma company específica (super admin vendo qualquer company)
```

**Isso requer um novo endpoint `/api/devices` (sem company scope).**

#### Opção B: Reusar endpoints existentes (sem novos endpoints)

```
GET /api/companies?all=true               → lista TODAS companies (super admin)
GET /api/companies/:companyId/devices     → já funciona, só precisa liberar acesso

GET /api/companies/:companyId/devices?search=SN-ABC
  → fuzzy search por nome, serial number, hawkbit target ID

GET /api/companies/:companyId/devices?status=accepted
  → filtrar por status

GET /api/companies/:companyId/devices?hawkbitStatus=connected
  → filtrar por status de conexão hawkBit
```

**A Opção B é melhor — não precisa de endpoints novos.** O super admin:

1. `GET /api/companies?all=true` → lista todas companies
2. `GET /api/companies/{id}/devices` → vê devices de qualquer company
3. `GET /api/companies/{id}/devices?search=termo` → busca devices

O único enhancement necessário é:
1. Adicionar `?all=true` e `?search=` nos GET endpoints
2. Adicionar verificação de `super_admin` no company check
3. Adicionar o role `super_admin` no enum

---

## 4. Segurança — Proteção Contra Escalação de Privilégios

### 4.1 Como uma pessoa mal-intencionada poderia tentar:

| # | Ataque | Como funciona | Proteção atual | Gap |
|---|--------|---------------|----------------|-----|
| 1 | Criar conta admin | Sign up normal, depois se auto-promove | ❌ Qualquer user cria company e vira `owner` | **Precisa de `super_admin` global separado** |
| 2 | Adicionar membro admin | Membro se auto-promove via API | ❌ `POST /members` não verifica quem pode promover | **Precisa de role check no addMember** |
| 3 | Listar devices de outra company | Chamar GET com companyId alheio | ✅ `checkMembership` bloqueia | ✅ Já protegido |
| 4 | Registrar device em company alheia | POST com companyId de outro | ✅ `checkMembership` bloqueia | ✅ Já protegido |
| 5 | Brute force de senha | Tentar senhas em sign-in | ✅ Rate limit: 10/60s | ✅ Já protegido |
| 6 | Criar múltiplas contas | Spam de sign-ups | ✅ Rate limit: 10/60s | ⚠️ Precisa email verification |
| 7 | Session hijacking | Roubar cookie | ✅ httpOnly, secure, sameSite | ✅ Já protegido |

### 4.2 Gaps Críticos de Segurança

#### Gap 1: Sem role global — qualquer user é owner

**Problema:** Qualquer pessoa que cria uma company vira `owner`.
Não existe distinção entre "admin da plataforma" e "cliente".

**Solução:**

```typescript
// Adicionar ao env.ts:
SUPER_ADMIN_EMAILS: Type.Optional(
  Type.String({ description: 'Comma-separated list of super admin emails' })
)

// Verificação no auth:
// Se user.email está em SUPER_ADMIN_EMAILS → role global super_admin
// Senão → role normal (owner/admin/operator/viewer por company)
```

#### Gap 2: Members podem promover a qualquer role

**Problema:** `POST /api/companies/:id/members` aceita qualquer role.
Um `viewer` poderia se auto-promover a `admin`.

**Solução:**

```typescript
// No addCompanyMember:
// - Apenas owner/admin pode adicionar membros
// - Apenas owner pode promover para admin/owner
// - Não permite auto-promoção (callerUserId !== targetUserId)
```

#### Gap 3: Sem email verification

**Problema:** Sign-up não verifica email → contas falsas.

**Solução:** Habilitar `REQUIRE_EMAIL_VERIFICATION=true` em produção
(já suportado pelo Better Auth, só precisa configurar).

---

## 5. Implementação — Otimização dos Endpoints Existentes

### 5.1 Enhancements necessários (sem novos arquivos, sem novos endpoints)

#### A. `GET /api/companies` — Adicionar `?all=true` para super admin

```typescript
// companies/index.ts — GET /api/companies
async ({ query, user }) => {
  if (query?.all && isSuperAdmin(user.email)) {
    // Retorna TODAS companies (sem filtro de membership)
    return { data: await getAllCompanies() };
  }
  // Comportamento atual: companies do user
  return { data: await getUserCompanies(user.id) };
}
```

#### B. `GET /api/companies/:id/devices` — Adicionar `?search=` e `?status=`

```typescript
// devices/index.ts — GET /
async ({ params, query, user }) => {
  // checkMembership já libera super_admin
  const devices = await getCompanyDevices(params.companyId, {
    search: query?.search,    // fuzzy search: name, serialNumber
    status: query?.status,    // filter: pending, accepted, etc
  });
  return { data: devices, total: devices.length };
}
```

#### C. `POST /api/companies/:id/devices` — Auto-criar target no hawkBit

```typescript
// devices/service.ts — registerDevice
async registerDevice(data) {
  // 1. Insere no DB
  const device = await db.insert(devices).values({...}).returning();

  // 2. Se hawkBit disponível, criar target
  if (hawkbitConfig.enabled && data.serialNumber) {
    const target = await hawkbitTargets.create({
      controllerId: data.serialNumber,
      name: data.name,
      securityToken: data.deviceKey || generateSecureToken(),
    });
    // 3. Atualiza com hawkbitTargetId
    await db.update(devices).set({
      hawkbitTargetId: target[0].controllerId,
      status: 'accepted',
    });
  }

  return device;
}
```

#### D. `checkMembership` — Liberar acesso para super admin

```typescript
// company-check.ts
export async function checkMembership(companyId, userId, userEmail?) {
  if (userEmail && isSuperAdmin(userEmail)) return null; // liberado
  const isMember = await isCompanyMember(companyId, userId);
  if (!isMember) return { status: 403, body: {...} };
  return null;
}
```

### 5.2 Tabela de Endpoints Otimizados

| Endpoint | Enhancement | Sem novo endpoint? |
|----------|------------|-------------------|
| `GET /api/companies` | `?all=true` para super admin | ✅ |
| `GET /api/companies/:id/devices` | `?search=&status=` filtros | ✅ |
| `POST /api/companies/:id/devices` | Auto-create hawkBit target | ✅ |
| `GET /api/companies/:id/devices/:id` | Incluir hawkbit status inline | ✅ |
| `POST /api/companies/:id/members` | Role check (só owner/admin) | ✅ |
| `PUT /api/companies/:id/members/:uid` | Não permite auto-promoção | ✅ |
| `GET /api/companies/:id/devices` | Paginação `?page=&perPage=` | ✅ |

---

## 6. Resumo — Respostas Diretas

### Q1: Qual o fluxo do dispositivo embarcado?

```
Fábrica → grava serialNumber + deviceKey na flash
    ↓
Liga → polling hawkBit (GET /controller/v1/{serial})
    ↓
401 (target não existe) → aguarda
    ↓
Admin cadastra serialNumber via Ninbus API
    ↓
API cria target no hawkBit (securityToken = deviceKey)
    ↓
Próximo polling → 200 OK → provisionado ✅
    ↓
 hawkBit envia deployments quando disponíveis
```

### Q2: Precisa adicionar na company?

**Sim.** O admin registra o dispositivo via `POST /api/companies/:id/devices`
com o serial number. Isso cria o target no hawkBit e associa à company.

### Q3: Admin consegue ver todos os devices?

**Hoje não.** Mas com os enhancements propostos:
- `GET /api/companies?all=true` → lista todas companies (super admin)
- `GET /api/companies/:id/devices` → vê qualquer company (super admin)
- `GET /api/companies/:id/devices?search=termo` → busca global

Tudo **sem criar novos endpoints** — apenas query params + role check.

### Q4: Como otimizar sem criar novos endpoints?

Adicionar nos endpoints existentes:
1. **Query params:** `?search=`, `?status=`, `?all=true`, `?page=`
2. **Auto-provisionamento:** `registerDevice()` já cria target no hawkBit
3. **Super admin:** `checkMembership()` libera acesso global
4. **Role check:** `addMember()` verifica permissão de promover

### Q5: Como proteger contra escalação?

1. **SUPER_ADMIN_EMAILS no env** — apenas emails pré-aprovados
2. **Role check em addMember** — só owner/admin adiciona, só owner promove
3. **Sem auto-promoção** — user não pode mudar próprio role
4. **Email verification** — `REQUIRE_EMAIL_VERIFICATION=true` em produção
5. **Rate limiting** — 10 req/min em auth endpoints
6. **httpOnly cookies** — session inacessível via JavaScript
7. **Company membership** — verificação em cada request

---

## 7. Diagrama Final — Arquitetura de Provisionamento

```
                    ┌─────────────────────────────────────┐
                    │         FÁBRICA (Setup Único)        │
                    │                                     │
                    │  Cada Ninbus WiFi v3 recebe:        │
                    │  • Serial Number (único, fused)     │
                    │  • Device Key (único, OTP/fused)    │
                    │  • URL do hawkBit gravada na flash   │
                    │  • Intervalo de polling (3 min)      │
                    └──────────────┬──────────────────────┘
                                   │
                                   ▼
              ┌─────────────────────────────────────────┐
              │        OPERAÇÃO (Dia a Dia)              │
              │                                         │
              │  ┌─────────────┐    ┌──────────────┐   │
              │  │ Admin Panel │    │  Dispositivo  │   │
              │  │  (Ninbus)   │    │  (Ninbus WiFi)│   │
              │  └──────┬──────┘    └──────┬───────┘   │
              │         │                  │            │
              │         │   ┌──────────────┘            │
              │         │   │ 1. GET /controller/v1/    │
              │         │   │    {serialNumber}          │
              │         │   │    TargetToken {deviceKey} │
              │         │   │────────────────────────>   │
              │         │   │                            │
              │  2. POST│   │                            │
              │  /devic │   │   ┌─────────────────┐     │
              │  es     │   │   │  hawkBit Server  │     │
              │  {sn}   │   │   │                 │     │
              │─────────┼───┼──>│ 3. Cria target  │     │
              │         │   │   │    com token     │     │
              │         │   │   │                 │     │
              │         │   │   │ 4. Próx poll:   │     │
              │         │   │   │    200 OK ✅     │     │
              │         │   │   │                 │     │
              │         │   │   │ 5. Deployment:  │     │
              │         │   │   │    firmware-ninb │     │
              │         │   │   │    firmware-ctrl │     │
              │         │   │   │    config-nfx    │     │
              │         │   │   └────────┬────────┘     │
              │         │   │            │              │
              │         │   │<───────────┘              │
              │         │   │  Download binary via       │
              │         │   │  hawkBit artifact URL      │
              │         │   │                            │
              │  6. GET │   │                            │
              │  /devic │   │                            │
              │  es     │   │                            │
              │  ?search│   │                            │
              │<────────┘   │                            │
              │  Lista com  │                            │
              │  status,    │                            │
              │  lastSeen   │                            │
              │             │                            │
              └─────────────┴────────────────────────────┘
```

---

## 8. Próximos Passos (Prioridade)

| # | Ação | Impacto | Complexidade |
|---|------|---------|-------------|
| 1 | Auto-create hawkBit target no `registerDevice()` | 🔴 Crítico | Média |
| 2 | `deviceKey` field no register schema | 🔴 Crítico | Baixa |
| 3 | SUPER_ADMIN_EMAILS no env + check | 🔴 Crítico | Baixa |
| 4 | Role check em `addMember()` | 🟡 Importante | Baixa |
| 5 | `?search=` e `?status=` nos GET devices | 🟡 Importante | Baixa |
| 6 | `?all=true` em GET companies (super admin) | 🟡 Importante | Baixa |
| 7 | Paginação em listagens | 🟢 Nice-to-have | Baixa |
| 8 | Email verification em produção | 🟢 Nice-to-have | Config |
