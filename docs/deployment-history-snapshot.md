# Deployment History — Snapshot & Cancellation

**Status:** ✅ Implementado e validado empiricamente no Docker (2026-06-22)
**Bug corrigido:** ao cancelar um deployment concorrente, dispositivos cancelados desapareciam do histórico e o status final não refletia a realidade.

## Causa raiz

hawkBit **não preserva** o histórico de actions quando:
1. Um novo DS é atribuído a um target que tinha action ativa → a action `update` original some do filtro `distributionSet.id=={dsId}` (sobrou só a `cancel`).
2. Uma action é cancelada via `DELETE /actions/{id}` → o estado final do target fica ambíguo no hawkBit.

O endpoint `GET /deployments/:id/target-statuses` dependia 100% do hawkBit em tempo real → dispositivos "sumiam" do histórico ou perdiam a fase real.

## Solução — Snapshot local canônico (com regra STICKY-FINISHED)

Nova coluna `deployments.target_status_snapshot` (JSONB) que armazena o **histórico imutável por target**. hawkBit continua sendo a fonte em tempo real para deployments ativos; o snapshot é a fonte canônica do histórico.

### Regra STICKY-FINISHED (crítica)

> **Uma vez que um dispositivo reportou `finished`/`installed`, o snapshot é congelado e NUNCA sobrescrito — nem por um cancelamento.**

Isso preserva o tracking real: se um dispositivo atualizou com sucesso antes do deployment ser cancelado, ele continua aparecendo como `installed`, mesmo que outros dispositivos do mesmo deployment tenham sido cancelados.

**Apenas dispositivos em estados não-terminais** (downloading, pending, assigned, etc.) são marcados como `canceled` quando o deployment é cancelado ou a action é substituída.

### Exemplo visual

```
Deploy #4 — status: completed (mantém)
├─ Onibus 1: 🚫 canceled (snapshot congelado)
├─ Onibus 2: 🚫 canceled (snapshot congelado)
└─ Onibus 3: ✅ installed (STICKY — não virou canceled)

Deploy #5 — status: canceled (após você cancelar)
├─ Onibus 1: 🚫 canceled
├─ Onibus 2: 🚫 canceled
└─ Onibus 3: ✅ installed (STICKY — preservado)

(ambos aparecem no histórico, nenhum some)
```

## Arquitetura

### `src/modules/deployments/snapshot.ts` (246 linhas)

Funções principais:
- `getSnapshot(dsId)` — lê o snapshot do DB.
- `updateTargetSnapshot(dsId, controllerId, partial)` — upsert com proteção sticky.
- `freezeTargetAsInstalled(dsId, controllerId, actionId)` — congela como installed (terminal-success).
- `freezeTargetAsCanceledIfNotInstalled(dsId, controllerId, actionId)` — congela como canceled **apenas se não for installed**.
- `freezeOnTerminalPhase(dsId, controllerId, phase, ...)` — dispatcher usado pelo sync engine.

### Integração (4 pontos)

| Ponto | Arquivo | Comportamento |
|-------|---------|---------------|
| Sync engine (poll de actions) | `sync-progress.ts` | A cada ciclo, ao detectar fase terminal (installed/canceled/error), chama `freezeOnTerminalPhase`. |
| Cancelar action (DELETE) | `device-routes.ts` | Antes de cancelar, se o target já estava `finished`, freeze como installed. Depois, freeze como canceled (respeitando sticky). |
| `target-statuses` (GET) | `trail.ts` | Se o target tem snapshot frozen, retorna direto do snapshot (não busca hawkBit). Senão, busca hawkBit em tempo real. |
| `listDeployments` (GET) | `service.ts` | Não filtra mais `!ds.deleted` — todos os deployments do DB local aparecem (DSes soft-deleted usam 100% snapshot). |

## Validação empírica (Docker, hawkBit habilitado)

Cenário reproduzido:
1. Empresa + 3 dispositivos + artifact.
2. Deploy #1 (DS 7) para os 3 dispositivos.
3. Deploy #2 (DS 8) concorrente, mesmos dispositivos.
4. Simulado: D1 ficou `installed` no snapshot do DS 7.
5. Cancelada action do D2 no DS 7 via endpoint.

**Resultado (validado via GET /target-statuses):**

| Device | Phase | Status |
|--------|-------|--------|
| CC01DD (Onibus 1) | `installed` ✅ | `finished` (preservado pelo sticky!) |
| CC02DD (Onibus 2) | `canceled` ✅ | `canceled` |
| CC03DD (Onibus 3) | `pending` | (ainda sem feedback) |

**GET /deployments:** ambos DS 7 e DS 8 aparecem na lista (Total: 2) — histórico não some mais.

## Testes

- **`snapshot.test.ts`** — 6 testes unitários cobrindo a regra sticky:
  - freezeTargetAsInstalled marca frozen=true.
  - **installed NÃO é sobrescrito por cancel** (sticky).
  - **não-installed É marcado canceled** no cancel.
  - **frozen canceled NÃO é downgradado** para assigned.
  - **frozen canceled PODE ser upgradado** para installed (feedback tardio).
  - helpers `isTargetFrozen` / `isTargetInstalled`.
- **`deployment.test.ts`** + **`enrichment.test.ts`** — 88 testes existentes continuam passando.

## Migration

`drizzle/0011_deployment_target_snapshot.sql`:
```sql
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS target_status_snapshot JSONB DEFAULT '{}'::jsonb;
```

Aplicada em dev DB (Neon) e test DB (Neon). Para produção, o `migrate.ts` aplica automaticamente no startup com skip-check de coluna.

## Limitações

1. **Deployments anteriores ao fix** (coluna vazia) continuam usando hawkBit em tempo real enquanto o DS existir. Conforme terminam, o snapshot é populado pelo sync engine. Sem perda de dados.

2. **Dispositivos órfãos** (target deletado do hawkBit): aparecem com `name = controllerId` quando o snapshot está frozen. Comportamento aceitável.

3. **Snapshot é best-effort**: falhas de DB no freeze são logadas mas não bloqueiam o sync/cancel. O histórico pode ter lacunas se houver outage prolongada — mas a regra sticky garante que installed sempre prevalece quando há dados.
