# Ninbus Admin Dashboard

Painel administrativo da plataforma Ninbus OTA. Next.js (App Router) servido em
`ninbus.frt.com.br/admin`, acessível apenas a super administradores
(`SUPER_ADMIN_EMAILS`).

## Arquitetura

- **Comunicação 100% via API:** o dashboard nunca chama a API diretamente. Todo
  tráfego passa pelo Route Handler proxy (`src/app/api/[...path]/route.ts`),
  que repassa o cookie de sessão para a API (`http://api:8081`, service name do
  compose). Resolve o problema de cookie cross-origin.
- **Cliente HTTP `ky`:** as chamadas browser→proxy usam `ky`
  (https://github.com/sindresorhus/ky) na fachada `src/lib/api/http.ts`
  (`prefix: '/admin/api'`, JSON/query/timeout/error-tratados pelo ky). O
  `session.ts` (server-side) usa uma instância ky separada apontando para
  `API_INTERNAL_URL`. **Atenção:** o proxy `route.ts` usa `fetch` nativo de
  propósito — um proxy transparente precisa repassar status/set-cookie/body
  verbatim, e o auto-JSON/throw do ky faria o oposto. O Better Auth tem cliente
  HTTP próprio (`@better-fetch/fetch`) e **não** usa ky.
- **Guard de super admin:** server-side (`requireAdmin`) + middleware.
- **Clean/DDD:** domínio isolado em `src/types`, infra em `src/lib/api`,
  apresentação em `src/components` e `src/app`.

## Desenvolvimento local

> **Importante — como acessar o dashboard.** O container do dashboard
> **não publica a porta 3001 no host** (é interno, por design/segurança).
> `http://localhost:3001/admin` **não funciona** (ERR_CONNECTION_REFUSED) —
> este é o comportamento esperado. Há duas formas de acessar:

### Opção A — Via nginx + hosts (recomendado; espelha produção)

O nginx faz name-based vhost routing por `Host`. Adicione uma entrada no
arquivo de hosts apontando o domínio para `127.0.0.1`:

- **Windows:** `C:\Windows\System32\drivers\etc\hosts` (abrir como Admin)
- **Linux/macOS:** `/etc/hosts`

```
127.0.0.1   ninbus.frt.com.br
```

Depois abra no navegador: **http://ninbus.frt.com.br/admin**

Assim o cookie de sessão (sameSite=lax) trafega same-origin, exatamente
como em produção. Os containers (`docker compose up -d`) devem estar no ar.

### Opção B — Dev server direto (debug do Next.js)

```bash
cd apps/dashboard
npm install
API_INTERNAL_URL=http://localhost:8081 npm run dev   # http://localhost:3001/admin
```

Aqui o dev server do Next.js roda no host (porta 3001) e chama a API em
`http://localhost:8081` (API rodando localmente ou via `docker compose up api`).
Útil para hot-reload, mas o cookie pode não funcionar perfeitamente sem o
nginx (use a Opção A para validar fluxos de auth).

## Estrutura

```
src/
├── app/                # rotas (App Router). basePath='/admin' (next.config.ts):
│   │                   # next/link, router.push e redirect adicionam '/admin'
│   │                   # automaticamente — escreva as rotas SEM o prefixo.
│   ├── (admin)/        # route group (não afeta a URL) — área protegida:
│   │   ├── layout.tsx  #   sidebar + requireAdmin (guard server-side)
│   │   ├── page.tsx    #   /admin  → redirect /admin/overview
│   │   └── overview|devices|companies|users|deployments|designations/
│   ├── auth/login/     # tela de login (fora do grupo admin → sem sidebar)
│   └── api/[...path]/  # proxy → API (chamado pelo navegador, same-origin)
├── components/         # UI componentizada (ui, layout, tables, forms, feedback)
├── lib/                # infra (api clients, auth, export, utils)
├── hooks/              # useFetch / useMutation
└── types/              # contratos do domínio (espelham schemas da API)
```

## Funcionalidades (Fase 1)

- Dispositivos: listar, buscar, filtrar por empresa, ordenar, provisionar, exportar (PDF/Excel).
- Empresas: CRUD completo + precadastro + designar owner + suspender/ativar + excluir.
- Usuários: listagem (read-only; promoção a super admin é via env).
- Deployments: observabilidade por empresa (status agregado por device).
- Designações: ver pendentes + cancelar.
