# 🎯 TASK: Tela de Onboarding — Escolher Empresa + Estado "Sem Empresa"

## Contexto

O backend Ninbus API implementou o **modelo Fábrica (onboarding por designação de email)**. Neste modelo:

- A **FRT Tecnologia** (super admin) cria empresas e designa o dono por email, via painel admin separado.
- O **cliente final** não cria empresa nem recebe link de convite. Ele apenas **se cadastra no app com o email** que a FRT reservou para ele.
- Automaticamente, no cadastro, o backend resolve a designação pendente e o cliente ganha acesso à empresa designada.

**Sua tarefa:** ajustar o fluxo pós-login para refletir esse modelo.

---

## O que precisa mudar no Flutter

### 1. Após login bem-sucedido, NÃO vá direto ao dashboard

Hoje (provavelmente) o app vai direto para a tela principal. **Mude para** ir a uma tela intermediária **"Escolher Empresa"** que busca as empresas do usuário.

### 2. Nova tela: `CompanySelectionScreen` (ou similar)

**Comportamento:**
1. Chama `GET /api/companies` com o token de sessão (cookie ou Bearer).
2. Conforme a resposta, mostra **um de dois estados**:

#### Estado A — Tem empresa(s) (`total > 0`)

```
┌─────────────────────────────────────┐
│  Escolha uma empresa                │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 🏢 Viação Exemplo S.A.        │  │
│  │    Você é: Dono               │  │
│  │                          [→]  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 🏢 Viação Norte               │  │
│  │    Você é: Operador           │  │
│  │                          [→]  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

- Cada card mostra `company.name` e o `company.role` traduzido (owner→"Dono", admin→"Administrador", operator→"Operador", viewer→"Visualizador").
- Ao tocar num card: armazena o `companyId` + `role` no estado da app (provider/Bloc/RiverPod) e navega para o dashboard.

#### Estado B — NÃO tem empresa (`total: 0`) ← **NOVO, o foco desta task**

```
┌─────────────────────────────────────┐
│                                     │
│            🏢                        │
│        (ícone grande)               │
│                                     │
│   Você ainda não tem acesso a       │
│   nenhuma empresa.                  │
│                                     │
│   Entre em contato com a            │
│   FRT Tecnologia para realizar      │
│   o seu cadastro.                   │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  📱 Entrar em contato       │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │  ↩  Sair                    │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Texto exato da mensagem (manter):**

> **Você ainda não tem acesso a nenhuma empresa.**
> Entre em contato com a FRT Tecnologia para realizar o seu cadastro.

**Botão "Entrar em contato":**
- Abre o WhatsApp da FRT Tecnologia (deep link `https://wa.me/55XXXXXXXXXXX` — **solicite o número ao time FRT**).
- Alternativa: abre o app de email com `mailto:contato@frttecnologia.com.br` (confirmar email com a FRT).

**Botão "Sair":**
- Chama `POST /api/auth/sign-out` e volta para a tela de login.

---

## Endpoints do backend (contrato)

### Autenticação

```http
POST /api/auth/sign-up/email
Content-Type: application/json

{ "email": "joao@cliente.com", "password": "SenhaForte123", "name": "João Silva" }
```
**200** → `{ "token": "<bearer-token>", "user": { "id", "name", "email", ... } }`

> ⚡ Importante: o cadastro resolve designações pendentes no backend. O cliente não precisa fazer nada extra — basta cadastrar-se com o email correto e a empresa aparecerá na próxima chamada.

```http
POST /api/auth/sign-in/email
Content-Type: application/json

{ "email": "joao@cliente.com", "password": "SenhaForte123" }
```
**200** → `{ "token": "<bearer-token>", "session": {...}, "user": {...} }` + cookie `auth.session_token`

**Uso no Flutter (mobile):** prefira o **Bearer token** (campo `token` da resposta) no header `Authorization: Bearer <token>`. Cookies não funcionam bem em apps mobile.

### Listar empresas do usuário

```http
GET /api/companies
Authorization: Bearer <token>
```

**200** →
```json
{
  "data": [
    {
      "id": "uuid-da-empresa",
      "name": "Viação Exemplo S.A.",
      "status": "active",
      "hawkbitTenantId": null,
      "role": "owner",
      "createdAt": "2026-06-22T...",
      "updatedAt": "2026-06-22T..."
    }
  ],
  "total": 1
}
```

**Quando `total === 0`** → mostrar o Estado B (mensagem "contacte a FRT").

> Observação: este endpoint também resolve designações pendentes como safety-net. Mesmo se o hook de sign-up falhar, chamar `GET /api/companies` garante que o cliente veja a empresa designada.

### Logout

```http
POST /api/auth/sign-out
Authorization: Bearer <token>
```

---

## Regras de UX

1. **Sempre chame `GET /api/companies` após login.** Não faça cache agressivo — a designação pode ter sido criada pela fábrica depois do último login do cliente.

2. **Empresa suspensa:** se `company.status === "suspended"`, mostre um badge "Suspensa" no card e bloqueie o acesso (toque mostra snackbar "Esta empresa está suspensa. Contate a FRT Tecnologia.").

3. **Múltiplas empresas:** o cliente pode pertencer a várias empresas (N:N). Sempre mostre a lista; nunca assuma empresa única.

4. **Role do usuário:** use o campo `role` de cada item da lista para:
   - Mostrar o rótulo traduzido no card.
   - Habilitar/desabilitar funcionalidades no dashboard (viewer não vê botões de criar/editar; operator não gerencia membros; etc.).

5. **Empresa escolhida:** ao selecionar, armazene `companyId` no estado global. **Todas** as chamadas subsequentes usam `/api/companies/{companyId}/...`.

---

## Estrutura sugerida (Flutter)

```
lib/
├── screens/
│   ├── auth/
│   │   ├── login_screen.dart
│   │   └── signup_screen.dart
│   ├── company/
│   │   ├── company_selection_screen.dart   ← NOVA (foco desta task)
│   │   └── widgets/
│   │       ├── company_card.dart
│   │       └── empty_companies_state.dart  ← Estado B (mensagem FRT)
│   └── dashboard/
│       └── dashboard_screen.dart
├── models/
│   ├── company.dart                         ← com campo `role` e `status`
│   └── ...
├── services/
│   └── api_client.dart                      ← Bearer token interceptor
└── state/
    ├── auth_provider.dart                   ← guarda token + user
    └── company_provider.dart                ← guarda companyId + role atuais
```

### Model `Company` (atualizar para incluir `role`)

```dart
class Company {
  final String id;
  final String name;
  final String status;        // "active" | "suspended"
  final String? hawkbitTenantId;
  final String role;          // "owner" | "admin" | "operator" | "viewer"
  final DateTime createdAt;
  final DateTime updatedAt;

  // ... fromJson / toJson
}
```

### Tradução de roles (helper)

```dart
String roleLabel(String role) {
  switch (role) {
    case 'owner':    return 'Dono';
    case 'admin':    return 'Administrador';
    case 'operator': return 'Operador';
    case 'viewer':   return 'Visualizador';
    default:         return role;
  }
}
```

---

## Fluxo de navegação final

```
[App abre]
    │
    ▼
[Tem token salvo?]──não──▶[Login Screen]──cadastrar──▶[Signup Screen]
    │sim                                              │
    │                                                 ▼
    │                                          [POST sign-up]
    │                                                 │
    ▼                                                 ▼
[GET /companies]◀─────────────────────────────────────┘
    │
    ├─ total > 0 ──▶ [Company Selection Screen]
    │                     │
    │                     └─ seleciona ──▶ [Dashboard]
    │
    └─ total == 0 ─▶ [Company Selection Screen — Estado B]
                          │
                          ├─ [Entrar em contato] → WhatsApp/email FRT
                          └─ [Sair] → logout → [Login Screen]
```

---

## Contatos da FRT Tecnologia (a confirmar com o time)

- **WhatsApp:** `https://wa.me/55XXXXXXXXXXX` ← solicitar número
- **Email:** `contato@frttecnologia.com.br` ← confirmar domínio
- **Telefone:** (XX) XXXX-XXXX ← opcional

> ⚠️ Estes contatos devem vir de uma **variável de ambiente ou config** no Flutter (não hardcoded), para facilitar atualização sem recompilar.

---

## Critérios de aceite

- [ ] Após login (sign-in OU sign-up), o app navega para `CompanySelectionScreen`.
- [ ] `GET /api/companies` é chamado com Bearer token.
- [ ] Se `total > 0`: lista empresas em cards com nome + role traduzido.
- [ ] Se `total === 0`: mostra **exatamente** a mensagem "Você ainda não tem acesso a nenhuma empresa. Entre em contato com a FRT Tecnologia para realizar o seu cadastro."
- [ ] Botão "Entrar em contato" abre WhatsApp/email da FRT.
- [ ] Botão "Sair" faz logout e volta ao login.
- [ ] Empresa suspensa mostra badge e bloqueia acesso.
- [ ] Selecionar empresa armazena `companyId` no estado global.
- [ ] Bearer token enviado em todas as requisições autenticadas.

---

## Documentação completa do backend

- Swagger/OpenAPI: `https://api.ninbus.com.br/docs` (produção) ou `http://localhost:8081/docs` (dev)
- Modelo Fábrica: `docs/flutter-factory-onboarding.md` no repositório do backend
- Categorias/Grupos: `docs/flutter-category-integration.md` no repositório do backend
