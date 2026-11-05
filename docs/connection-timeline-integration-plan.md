# Timeline de conexão — integração + otimização para 55k dispositivos

Componente `ninbus-connection-timeline` integrado à dashboard com os filtros de cada
tela (sem barra própria), duas correções de performance imediatas e o plano atômico
de backend para escalar o carregamento a 55k dispositivos.

## O que entra agora (implementado nesta entrega)

### F1 — Badge "Conectando" lento (investigado; sem patch no servidor)

O emitter **já** envia o primeiro byte na abertura (`connected` imediato em
`addConnection`) — o stream nunca fica pendente no servidor. A lentidão vem do
**enfileiramento no navegador**: em HTTP/1.1 o browser limita 6 conexões
simultâneas por host; a tela Atividade antiga disparava consultas pesadas em
paralelo e o `EventSource` ficava atrás delas na fila — o badge "Conectando"
perseverava exatamente na tela mais lenta. Correções efetivas: F2/F3 abaixo
(reduzem custo e volume da tela) e, em produção, o nginx já serve HTTP/2
(`http2 on` no 443) — multiplexado, o SSE não disputa slot com as consultas.
Um patch de frame inicial no servidor foi testado e revertido: redundante e
quebrava os testes de contrato do stream.

### F2 — Tela Atividade: custo por render (frontend; implementado)

O heatmap de 365 dias executava `toLocaleDateString` por evento por dia
(≈73k formatações) e tudo era recomputado **a cada render** — inclusive a cada
tecla digitada na busca. Correção: derivadas memoizadas (`useMemo`) para o
heatmap e para a lista filtrada; a contagem por dia agora vem do servidor (F3),
não de 200 eventos crus.

### F3 — Endpoint de calor da atividade (backend, aditivo; implementado)

`GET /admin/activity/heat?from&to` — `GROUP BY` diário no servidor. O heatmap
passa a refletir o volume real do período em vez de uma amostra de 200 eventos.
A rota é nova (nada existente muda): service `heatActivity()` + schema + rota.

### F4–F7 — Integração do componente (frontend)

- **F4** Vendor em `components/connection-timeline/`: Gantt, drawers, model,
  brush e repository (paginação de eventos 2.000/página, teto de 100k, 3
  empresas em paralelo). Os componentes Arc duplicados do ZIP são descartados —
  imports apontam para `@/components/arc`. A barra de filtros interna
  (`ConnectionFilterBar`) e o drawer de período do pacote **não entram**: o
  período vem do filtro "Data e hora" da própria tela (chips da barra Filtrar),
  e a busca/empresa vêm do catálogo da tela.
- **F5** Atividade (admin): card "Conexão dos dispositivos" no fim da tela;
  janela = período selecionado na tela; empresas = todas com eventos no período.
- **F6** Empresa › Dispositivos: mesmo card abaixo da frota; janela = período do
  filtro da aba; catálogo = dispositivos da empresa (já carregados).
- **F7** Clique em dispositivo: linha do Gantt abre o `ConnectionDetailsDrawer`
  do componente (faixas reais, disponibilidade, última comunicação, firmware);
  "Gerenciar dispositivo" abre o overlay de gestão existente. O overlay
  existente (`details.tsx`) passa a usar o Gantt do componente na seção de
  conexão do dispositivo (substitui as lanes antigas).

## Plano atômico de backend — escalar a 55k dispositivos

Princípio: cada item é uma mudança isolada, aditiva quando possível, sem reescrita
de rota. Ordem por risco/benefício.

| # | Mudança | Tipo | Por quê |
|---|---------|------|---------|
| B1 | `GET /admin/devices/connections?view=events&companyId=all` (super admin) com `limit/offset` globais | Aditivo | Hoje o card admin itera empresa por empresa (N requisições). Um caminho único paginado elimina a explosão de chamadas no super admin. O `deviceId` do Gantt continua sendo o seletor fino. |
| B2 | `includeCatalog` no response de eventos (devices da empresa com `id,name,serial`) OU `GET /companies/:id/devices?fields=minimal&limit&offset` | Aditivo | O catálogo completo (`listAll`) é inviável em 55k. O Gantt só precisa de identidade + snapshot; dispositivos sem eventos podem vir como linha "Sem histórico" paginada. |
| B3 | `GET /companies/:id/devices` com paginação real (`limit/offset/connection`) para as Coleções | Modificativa (params novos, default retrocompatível) | A Collection renderiza client-side; em 55k a resposta única estoura. Paginação no servidor com o mesmo schema por página. |
| B4 | Heat de atividade por dia (F3) generalizado p/ `bucket=hour\|day\|week` e `companyId` opcional | Aditivo | Atende a aba Atividade da empresa com o mesmo endpoint. |
| B5 | Rate/timeout do SSE por usuário + `SSE_HEARTBEAT_SEC=15` em produção | Config | 55k dispositivos ⇒ rajadas de transição; coalescer já existe, o heartbeat menor mantém proxies acordados. |
| B6 | Cache de leitura (60s) nos endpoints de calor/agregado | Aditivo | Janelas idênticas repetidas por vários admins custam o mesmo GROUP BY. |

### Por que o desenho atual já ajuda

- Telemetria grava **somente transições** online↔offline — estado estável não
  gera linha (55k dispositivos estáveis = 0 escritas/ciclo).
- Índices existentes: `device_connections(companyId, occurredAt)` e
  `(deviceId, occurredAt)`; `activity_log(companyId, createdAt)`.
- O repository do componente pagina eventos (2k/página) com teto de 100k e
  aborta respostas velhas.
- O Gantt é virtualizado (`useVisibleRows`) — 55k linhas não renderizam de uma vez.

### Pegadas de risco

- B3 muda o contrato das Coleções → versão por query param (`?paginated=1`) até
  todas as telas migrarem.
- B1 precisa do mesmo cuidado de autorização do `connections-routes.ts`
  (super admin bypassa empresa; membro comum continua restrito à própria).
- Migração nenhum: tudo é leitura — sem schema novo.
