# Auditoria — pipeline de upload/disponibilização de firmware (módulo firmware/)

Data: iter. 54 · Escopo: `src/modules/firmware/**` · **Análise only — nenhum commit**

## Veredito geral

A **funcionalidade** está correta e validada na bancada (upload v2 → pilot/publish gates → deploy),
mas a **estrutura degradou por acréscimo incremental**: 4 arquivos estouram o limite de 250 linhas,
6 blocos de tratamento de erro duplicados com mapeamentos HTTP **inconsistentes entre si**,
1 bug real de comentário contraditório, line-endings misturados e 3 consultas `max(counter)`
quase-idênticas. O usuário está certo: "amontoou".

## A. Defeitos reais (corrigir primeiro)

| # | Onde | Defeito |
|---|------|---------|
| A1 | `status-service.ts:163-170` | Comentário STALE ("must STILL be published… an assign never resolves a draft") **empilhado acima** do código do canal piloto que faz o oposto — leitura contraditória do fluxo |
| A2 | `service.ts:264` (log do upload) | `'Release %s published: …'` — upload cria **draft**, log mente para auditoria |
| A3 | `status-service.ts` | Line endings **MISTOS** (3 linhas LF em arquivo CRLF) — sujeira de edição por script |
| A4 | `release-gate.ts` persistGate | `gate: result as any` — furo de tipagem no JSONB |
| A5 | `schemas.ts` | `gate: t.Union([t.Unknown(), t.Null()])` — estrutura conhecida (checks/verdict/sha256) sem schema; viola critério 3 |
| A6 | `routes.ts` DELETE | `query?.realignFloor === 'true' \|\| … === true` — 2º ramo é código morto (schema declara `t.String`) |

## B. Limites de tamanho/organização (critério 2 — "every file under 250")

| Arquivo | Linhas | Problema |
|---|---|---|
| `service.ts` | **471** | 4 responsabilidades: catálogo (list/latest), pipeline de upload (sign+validar+hawkBit+insert), delete com guard de piso (ifs aninhados 4 níveis), classe de erro + constantes |
| `release-gate.ts` | 307 | Mistura fetch-by-id + gate (re-download+checks+persist) + publish/unpublish |
| `status-service.ts` | 303 | Mistura leitura de status (company view/classify/enrich) + orquestração de deploy (pilot+re-offer+draftWarning) |
| `ota-signer.ts` | 305 | Borderline — coeso (1 domínio), aceitável; DER-validation + key-load poderiam sair |
| `tar-validator.ts` | 252 | Borderline ok |

## C. Duplicação (DRY)

- **C1** `coalesce(max(counter))` 3× com filtros distintos (upload L103, delete-guard L379, gate L177) → extrair `catalogCounterFloor(type, {excludeId?, publishedOnly?})`
- **C2** Mapeamento erro→HTTP repetido **6×** e **inconsistente**: `GATE_FAILED→409` só em gate-routes; `COUNTER_FLOOR_BURNED→409` só em routes; `REJECTED_ARTIFACT` cai em **400** no force-deploy (deveria ser 409); status-routes desconhece os códigos novos → 1 helper único `firmwareErrorToResponse()`
- **C3** Catch blocks publish/unpublish idênticos em gate-routes
- **C4** Mapeamento OtaSignerError/InvalidPackageError→FirmwareValidationError inline 2× no upload

## D. Semântica/naming

- `force` no body conflita com o endpoint já ser "force deploy" → `retryRejected`
- `release-gate.ts` não reflete o conteúdo (também é catálogo+status)
- Comentário do schema DB (`firmware.ts`) desatualizado vs semântica piloto/publicado final
- Import em leque (status-service → release-gate + service + version-refresh) sinaliza arquivo de trigger próprio

## E. Cobertura de testes (critério 5)

Zero cobertura para: canal piloto (gate mode), `realignFloor`, discriminador do REJECTED_ARTIFACT,
publication gate. `firmware.test.ts`: 13 falhas pré-existentes (DB) mascaram regressões.

## Plano de refactor proposto (executar em follow-up, 1 commit lógico por passo)

1. `errors.ts` — `FirmwareValidationError` + mapa código→HTTP + helper de resposta (mata C2/C3, unifica 409s)
2. `catalog.ts` — list/getLatest/getById + `catalogCounterFloor()` (C1)
3. `upload.ts` — pipeline de upload puro; `delete.ts` — delete + guard com early-returns
4. `publication-gate.ts` — gate+persist+publish/unpublish (renomeia release-gate)
5. `deploy-trigger.ts` — trigger com pilot/re-offer (sai de status-service, que fica só-leitura)
6. `schemas.ts` — `GateCheckSchema`/`GateResultSchema` tipados; corrige A2/A5/A6
7. Normalizar line endings do módulo (LF) + corrigir A1/A3/A4
8. Testes novos (unit-puros onde possível) + atualizar notes/SKILL/README

Pós-split estimado: todos os arquivos < 250 linhas.

## O que está bom (manter)

- signer/validator coesos, paridade com o oracle comprovada por 16 testes puros
- Evidência do gate persistida e exposta; semântica piloto/publicado correta
- Cliente hawkBit com `raw` bem isolado; migrations aplicadas nos 3 DBs
- Guard de piso anti-replay + discriminador por createdAt (design endossado pelo embarcado)
