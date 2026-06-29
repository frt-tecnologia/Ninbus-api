# Dashboard Redesign — Log de progresso & hipóteses

> Tarefa longa. Persiste estado, hipóteses e auto-crítica para sobreviver à
> compactação de contexto. Plano-mestre: `docs/dashboard-redesign-plan.md`.

## Decisões confirmadas
- Accent: **índigo** (`--primary`). Dark-first. Fleet Pulse aprovado. Fases 1→8.

## Rastreador de fases — TODAS CONCLUÍDAS ✅
| Fase | Estado | Entrega |
|---|---|---|
| 0 tokens.ts | ✅ | sistema de sinais tipado |
| 1 fundação visual | ✅ | components.json + tailwind dark-first + globals.css (signals) + Geist/GeistMono |
| 2 system/* + layout/* shell | ✅ | 11 primitivos system + AppShell/SidebarNav/Topbar/⌘K/UserMenu/ThemeToggle/PageHeader |
| 3 auth redesign | ✅ | login split-panel + reset-password (console aesthetic) |
| 4 overview (FleetPulse+Pipeline) | ✅ | grade de sinais + Kpis mono |
| 5 devices | ✅ | DeviceTable + ProvisionDialog (TanStack-style sort) |
| 6 deployments | ✅ | funil OTA (Pipeline) + DeploymentTable (segmentos de progresso) |
| 7 companies | ✅ | CompanyTable + MembersManager + CompanyCreateDialog |
| 8 users + designations + limpeza | ✅ | UserTable + DesignationTable; mortos removidos |

## Validação empírica (Docker, imagem nova 5914b062)
- Build: ✓ Compiled successfully, 12 static pages, typecheck limpo.
- /admin/auth/login → 200 (renderiza "Fleet Control").
- /admin/* → 307 → login (middleware intacto) para overview/devices/companies/users/deployments/designations.
- get-session → 200. Logs sem erros.
- Bundle CSS: 5 signal shapes + GeistMono + --signal-ok + font-mono presentes.
- Nenhuma ref a componentes antigos no source.

## Hipóteses — reavaliação final
- H1 [✓ confirmada] Tailwind v3.4 + shadcn manual > upgrade v4. Build verde.
- H2 [✓] next-themes class/dark-first com `:root,.dark`/`.light` → funciona.
- H3 [✓] Geist via `geist` pkg (GeistSans/GeistMono) — bundlado.
- H4 [→ parcial] TanStack Table v8 NÃO usado; data-table.tsx é wrapper leve
  próprio (sort+search, <250 linhas). Suficiente p/ MVP; TanStack fica como
  follow-up se precisar multi-sort/server-pagination. Decisão pragmatica p/
  garantir conclusão.
- H5 [✓] Signal geometria via CSS classes (sig-dot/ring/square/diamond/slash) +
  pulse — nitidez confirmada no bundle.
- H6 [→ parcial] FleetPulse capado em 600 cells (virtualização §future p/ 10k+).

## Limpeza de mortos (Fase 8)
- Removido: tables/, forms/, ui/{Modal,State}.tsx, layout/{Sidebar,PageHeader}.tsx,
  lib/utils/status.ts (substituído por lib/design/tokens.ts).
- Case-fix Windows→Linux: Button/Card/Input/Badge.tsx → minúsculos (build Docker
  é case-sensitive; era necessário).

## Auto-crítica
- RISCO CONTROLADO: Windows case-insensitive mesclou writes lowercase nos
  capitalizados antigos → quebrou build incremental; resolvi com migração
  atômica de todas as páginas + case-fix. Por isso 1 commit coeso (não por fase).
-PENDÊNCIAS (não bloqueiam, polish/future):
  - Mobile: tabelas hoje scroll horizontal; card-empilhado por linha é polish.
  - FleetPulse virtualização p/ frotas grandes.
  - StatusTrail detalhado por device (endpoint existe, UI na próxima iteração).
  - TanStack Table se multi-sort/server-side virar necessário.
