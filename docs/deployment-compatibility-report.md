# Relatório de Análise: Migração AWS + Compatibilidade Flutter

> **Branch:** `feat/dashboard-improvement` (criada de `release/hawkbit-api`)
> **Data:** 2026-07-03
> **Conclusão:** ✅ MIGRATION SEGURA · ✅ ZERO BREAKING CHANGES PARA O FLUTTER · ✅ BRANCH CRIADA

---

## 1. Migração 0012_observability — Segurança contra a base AWS

### 1.1 Veredito: 100% ADITIVA — NENHUM RISCO A DADOS EXISTENTES

A migration contém APENAS operações que criam objetos novos ou adicionam
colunas nullable. **Zero DROP, zero ALTER COLUMN destrutivo, zero DELETE.**

| Operação | Tipo | Risco a dados |
|---|---|---|
| `CREATE TYPE activity_action` | novo enum | ✅ nenhum |
| `CREATE TYPE activity_entity` | novo enum | ✅ nenhum |
| `CREATE TYPE connection_event` | novo enum | ✅ nenhum |
| `CREATE TABLE activity_log` | nova tabela | ✅ nenhum |
| `CREATE TABLE device_connections` | nova tabela | ✅ nenhum |
| `ALTER companies ADD COLUMN created_by text` | coluna nullable | ✅ linhas existentes → NULL |
| `ALTER categories ADD COLUMN created_by text` | coluna nullable | ✅ linhas existentes → NULL |
| `ADD CONSTRAINT ... FOREIGN KEY` (tabelas novas) | FK em tabelas novas | ✅ nenhum |
| `ADD CONSTRAINT companies_created_by_fk` | FK nullable | ✅ NULL nunca viola FK |
| `ADD CONSTRAINT categories_created_by_fk` | FK nullable | ✅ NULL nunca viola FK |
| `CREATE INDEX` (5 índices) | em tabelas novas | ✅ nenhum |

### 1.2 Comportamento do migrator (re-run safe)
- `CREATE TYPE` sem `IF NOT EXISTS`: o migrator captura erros 42P07/42710/42P06
  ("already exists") e ignora — re-runs são seguros.
- Skip check: `tableSet.has('activity_log') && tableSet.has('device_connections')`
  → pula a migration inteira se já aplicada.
- Validado empiricamente no Docker (Neon cloud) — aplicou sem erro.

### 1.3 Procedimento de deploy na AWS
1. Deploy da imagem Docker com o novo código (migration roda automaticamente no boot).
2. O migrator detecta as tabelas inexistentes → aplica 0012.
3. Dados existentes (empresas, devices, deployments) INALTERADOS.
4. hawkBit sp_* tables (29) INALTERADAS (nenhum DROP na migration).

---

## 2. Endpoints consumidos pelo Flutter — Análise de compatibilidade

### 2.1 Veredito: ZERO BREAKING CHANGES

| Mudança no código | Tipo | Impacto no Flutter |
|---|---|---|
| `logActivity()` injetado em ~15 rotas | side-effect interno (best-effort) | ✅ nenhum — response shapes idênticos |
| `EnrichedDeployment` ganhou `createdBy`/`creatorEmail` | campos opcionais adicionados | ✅ ignorado por JSON parsers |
| `createCompany()` persiste `created_by` | coluna extra no DB | ✅ response schema inalterado |
| `revokePendingDesignation()` retorno mudou | função interna | ✅ response HTTP inalterado |
| `batchUpdateDevicesFromTargets` captura telemetria | side-effect do sync | ✅ nenhum — response inalterado |
| `markOverdueDevicesOffline()` (staleness sweep) | CORREÇÃO de bug | ✅ devices órfãos agora corretamente offline |
| Schemas de validação (body/response) | **NENHUM alterado** | ✅ contratos de request idênticos |

### 2.2 Evidência: nenhum schemas.ts de módulo existente foi alterado
```
git diff HEAD -- src/modules/**/schemas.ts → (vazio)
```

### 2.3 Evidência: logActivity é best-effort (nunca quebra o response)
```ts
export async function logActivity(input: LogActivityInput): Promise<void> {
  try { await db.insert(activityLog)... }
  catch (error: any) {
    // Non-fatal: audit logging must never break the primary operation.
    appLogger.warn(...)
  }
}
```

### 2.4 Endpoints que o Flutter consome — todos inalterados no contrato
- POST /api/auth/sign-up/email, sign-in/email, sign-out ✅
- GET /api/companies ✅
- GET /api/companies/:id/devices ✅
- GET /api/companies/:id/deployments (+ campos opcionais createdBy/creatorEmail) ✅
- GET /api/companies/:id/deployments/:id/statistics ✅
- GET /api/companies/:id/deployments/:id/target-statuses ✅
- GET /api/companies/:id/deployments/:id/targets/:cid/status-trail ✅
- POST /api/companies/:id/deployments ✅
- POST /api/devices/provision ✅
- DELETE /api/devices/deprovision/:serial ✅
- SSE /api/companies/:id/sse ✅

### 2.5 Novos endpoints (não consumidos pelo Flutter)
- GET /api/admin/activity (superadmin only)
- GET /api/admin/devices/connections (superadmin only)
- GET /api/admin/categories (superadmin only)
- GET /api/admin/stats (superadmin only)

---

## 3. Cadeia de snapshots Drizzle — íntegra

```
0000 (5 tabelas) → 0002 (10) → 0011 baseline (13) → 0012 (15)
```
Cadeia linear (prevId encadeado). `drizzle-kit generate` futuro produzirá
diffs corretos a partir de 0012_snapshot.json.

---

## 4. Branch criada

- **Branch:** `feat/dashboard-improvement` (criada de `release/hawkbit-api`)
- **83 arquivos** modificados/novos preservados na branch
- `release/hawkbit-api` **intacta** (sem as mudanças)
- Nenhum commit feito — alterações estão como working tree (prontas para review)

### Resumo do que está na branch
- **Backend:** migration 0012 (observability), módulo observability/ (4 arquivos),
  injeção de logActivity em 15 rotas, captura de telemetria no sync,
  staleness sweep (fix do device offline), retenção, endpoint /stats, env vars.
- **Frontend:** overview redesenhado (histograma, distribuição horária, top empresas),
  página empresa observabilidade (3 seções), group-organizer com modal CRUD,
  members-manager com combobox de busca, universal search na topbar,
  busca corrigida no DataTable, tela de usuários enriquecida (filtros + convites),
  designations removido da sidebar, range picker com custom, PWA (manifest + SW + ícones),
  ícones ninbus-logo, fix do time-range-picker.
