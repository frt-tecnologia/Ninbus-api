# Ninbus Admin Dashboard

Painel administrativo da plataforma Ninbus OTA. Next.js (App Router) servido em
`ninbus.frt.com.br/admin`, acessível apenas a super administradores
(`SUPER_ADMIN_EMAILS`).

## Arquitetura

- **Comunicação 100% via API:** o dashboard nunca chama a API diretamente. Todo
  tráfego passa pelo Route Handler proxy (`src/app/api/[...path]/route.ts`),
  que repassa o cookie de sessão para a API (`http://api:8081`, service name do
  compose). Resolve o problema de cookie cross-origin.
- **Guard de super admin:** server-side (`requireAdmin`) + middleware.
- **Clean/DDD:** domínio isolado em `src/types`, infra em `src/lib/api`,
  apresentação em `src/components` e `src/app`.

## Desenvolvimento local

```bash
cd apps/dashboard
npm install
npm run dev   # http://localhost:3001/admin
```

A API precisa estar rodando em `http://localhost:8081` (ou ajustar
`API_INTERNAL_URL`). Para o cookie funcionar em dev local, recomenda-se acessar
pelo nginx em `http://ninbus.frt.com.br/admin` (adicionar entrada em `/etc/hosts`).

## Estrutura

```
src/
├── app/                # rotas (App Router)
│   ├── auth/login/     # tela de login
│   ├── admin/          # área protegida (overview, devices, companies, users, deployments, designations)
│   └── api/[...path]/  # proxy → API
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
