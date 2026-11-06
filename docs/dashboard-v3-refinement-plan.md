# Plano — Refinamento Dashboard v3 (Arc + dados reais)

> **Status: CONCLUÍDO (v3) — 27/27 checks no docker; refinamento do usuário integrado (período como popover controlado).** Continuação de `docs/arc-dashboard-v2-plan.md` (§8 Fase 2 autorizada agora).
> Escopo: dashboard Arc + backend onde o fluxo exigir. Working tree, sem commit/push/deploy.

## Princípios

- Dados reais apenas: nada de mock p/ histórico/métrica; lacunas declaradas, não preenchidas com zero.
- Estado atual ≠ histórico: cada card declara o que mede (evento/acumulado/instante).
- Período unificado: um modelo (`lib/time/period.ts`), presets 1h/24h/7d/30d/personalizado, TZ America/Sao_Paulo, ISO UTC na serialização, limites inclusivos.
- Componentes Arc oficiais; compostos novos (Waffle) seguem tokens; limitações documentadas.

## Tarefas

### Estágio 0 — Contratos de dados
| # | Tarefa | Arquivos | Dep. | Aceite | Estado |
|---|---|---|---|---|---|
| T0.1 | Modelo de período unificado: presets, validação (ini<fim, máx span), serialização ISO, recompute relativo no refresh | `apps/.../lib/time/period.ts` | — | funções puras testadas (bun) | ✅ |
| T0.2 | Endpoint `GET /api/admin/deployments/timeline?from&to&buckets` — séries atribuições (createdAt) e instalações/falhas/cancelamentos (targetStatusSnapshot.snapshotAt) por bucket | `src/modules/admin/timeline-routes.ts` | — | agregador unit-testado; 200 ao vivo; sticky rule respeitada | ✅ |
| T0.3 | Verificar serialização from/to nas rotas de observabilidade (ISO c/ tz) e padronizar client | `lib/api/observability.ts` | T0.1 | período troca → query troca → dados mudam | ✅ |

### Estágio 1 — Componentes compartilhados
| # | Tarefa | Dep. | Aceite | Estado |
|---|---|---|---|---|
| T1.1 Branding: logos Ninbus/FRT em `public/brand/`, assinatura na sidebar (expandida/recolhida/mobile) | — | imagens servidas; sem caminho Windows; sem nome duplicado | ✅ |
| T1.2 `PeriodPills` compacto (1h/24h/7d/30d/Personalizado) + `PeriodFilter` v2 (DateRangePicker **com** TimePicker; presets diários ≠ janelas móveis) | T0.1 | troca de preset refaz consultas; custom valida ini<fim | ✅ |
| T1.3 `FilterBar`: SearchField \| chips removíveis \| botão "Filtrar" (SlidersHorizontal) com "Data e hora" + dimensões reais por tela; empresa com busca | T0.1,T1.2 | sem "Adicionar filtro"/"Entidade"; pt-BR | ✅ |
| T1.4 `WaffleChart` (arc-app): grade proporcional (célula≠dispositivo), cores semânticas, legenda c/ qtd+%, seleção filtra lista | — | soma das categorias = total; seleção filtra | ✅ |
| T1.5 `Collection`: resize de colunas (pointer+teclado, min-width, sem disparar sort, sem overflow de página); ordenação inicial temporal estável; coluna "Ações" removida (ações no detalhe) | — | resize não ordena; teclado acessa detalhe | ✅ |

### Estágio 2 — Telas
| # | Tarefa | Dep. | Aceite | Estado |
|---|---|---|---|---|
| T2.1 Login/cadastro centralizados (largura máx, alinhamento à esquerda, PasswordField, auth real) | — | composição ok 390/1440 | ✅ |
| T2.2 Overview: pills de período → timeline real; "Atividade de atualizações" 2 séries c/ regras documentadas; "Frota por empresa" → barras compactas; atividade → ActivityHeatmap largura total + drilldown do dia | T0.2,T1.2,T1.4 | período altera consultas; heatmap diário; sem snapshot disfarçado | ✅ |
| T2.3 Atualizações (Rollouts→"Atualizações"): naming, filtros no "Filtrar", detalhe com WaffleChart (target-statuses) + lista filtrável por categoria | T1.3,T1.4 | falha em A permanece em A; categorias = fases reais | ✅ |
| T2.4 Dispositivos: última comunicação visível (não tooltip), sort temporal, Floating group (Vincular selecionados/Buscar para vincular) c/ contagem e disabled vazio | T1.5 | seleção sobrevive a filtro/página c/ aviso de alcance | ✅ |
| T2.5 Empresa: "Frota da empresa" no padrão compartilhado; conectados ao longo do tempo (série + janela; Brush se disponível — **não existe no Arc local**: registrar e compor alternativa); detalhe do dispositivo com histórico de sessões (endpoint deviceId) | T0.3,T1.5 | lacunas ≠ zeros; janela 1h usa série, não heatmap | ✅ |
| T2.6 Naming/UX sweep: Rollouts→Atualizações; HawkBit→"Serviço de atualizações" (contextual); pt-BR curto | — | grep sem "Rollout"/"HawkBit" visíveis na UI | ✅ |
| T2.7 Motion: tokens centrais −25% (validar visual); sem tocar HoldToConfirm/timeouts | — | animações preservadas; reduced-motion ok | ✅ |

### Estágio 3 — Validação
- tsc/biome/build/testes; browser 390/768/1024/1440; drills: período→query, falha A→sucesso B, waffle=total, resize≠sort, seleção+paginação.
- Entrega: plano atualizado, resumo, regras adotadas, limitações, como revisar.

## Decisões registradas

1. **Séries do card de atualizações** (T0.2): "Atribuições" = eventos de criação (`deployments.created_at`); "Instalações" = confirmações de término por alvo (`target_status_snapshot[].snapshotAt`, fase `installed`). Contagem por **evento** (dispositivo repetido conta a cada confirmação) — legenda explica.
2. **Situação atual do dispositivo** (§7 exemplo obrigatório): fase no rollout **mais recente que o inclui** (ordenado por `created_at` DESC). Falha em A fica no histórico de A; dispositivo não fica "com falha" se B (mais nova) concluiu. Preserva sticky rule do snapshot (installed nunca sobrescrito).
3. **BrushChart**: não existe no conjunto Arc instalado (referência verificada). Alternativa: LineChart + janela por período unificado. Registrado como limitação.
4. **WaffleChart**: composto em arc-app seguindo tokens; **proporcional** (célula ≠ dispositivo), legenda com contagens — sem afirmar "1 quadrado = 1 dispositivo". Inspeção por dispositivo fica na lista vinculada.
5. **Fuso**: America/Sao_Paulo em labels; serialização ISO UTC com offset explícito nos limites.
6. **Sem paginação server-side nesta leva** (payload completo continua): requisito de escala do §8 antigo fica para aprovação específica — os requisitos desta tarefa (busca na coleção inteira, não na página) são atendidos no cliente.


## Pós-conclusão — integração do refinamento do usuário (período controlado)

O `Collection`/`FilterToolbar`/`PeriodPills` foram refinados pelo usuário: período passou a ser **controlado** (`period`/`onPeriodChange`) com pills internas quando autônomo, popover "Período" (presets + Personalizado) e chip aplicado. Ajustes de integração:

1. `dateMeaning` reintroduzido como prop (rodapé com janela resolvida em São Paulo).
2. **Bug crítico corrigido** em `useAllDeployments`: `useCallback(..., [companies.map])` dependia da função `Array.prototype.map` (estável) → fetcher congelado com `companies=[]` → cache `deployments:all:<32 ids>` gravado como lista vazia. Agora a dependência é `key` (que codifica o conjunto de ids).
3. Strings do FilterToolbar traduzidas (Filtrar, Nenhum filtro aplicado, Limpar tudo, Voltar aos campos).
4. Assets de marca servidos sem otimizador (`unoptimized`) com prefixo `basePath` (`/console/brand/...`) — o container não tem sharp.
5. `css.d.ts` declara `*.css` para side-effect imports fora do contexto next-env.
6. `docker-compose.dev.yml`: hawkBit publicado em `127.0.0.1:8080` para dev da API no host (HAWKBIT_URL=localhost).

**Validação final:** docker build completo (api+dashboard), `next build` limpo, tsc limpo, biome 0 findings, testes 8 (período) + 36 (timeline/RBAC/companies), auditoria browser **27/27** (login/branding, presets→timeline ao vivo, heatmap, waffle 100 células com soma correta, resize sem ordenar, sem coluna Ações, frota padrão compartilhado, série agregada, 4 larguras sem overflow, drawer mobile, 0 erros de console).
