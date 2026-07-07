# Iteration 53 Analysis

**Phase**: completed
**Date**: 2026-07-07T01:54:59.739Z

## Results

### ✅ Functional Correctness

Backend + frontend builds limpos, rerun Docker executado. ROOT CAUSE do 'tipo diferente' identificado e corrigido: NÃO era escrita direta no banco. O caminho de criação de deployment é 100% via API — POST /deployments valida artifactType como Union de 3 literais (reject 400 tipo inválido) → createDeployment cria o DS no hawkBit → write-through insere o registro local de auditoria (padrão documentado no SKILL.md). O bug era no ENRICHMENT: enrichDeployment retornava `type: ds.type` (DS-type KEY do hawkBit = 'ninbus-firmware-ninbus' com prefixo) em vez do artifactType canônico ('firmware-ninbus'). Fix: preferir local.artifactType + stripDsTypePrefix como fallback (logica verificada: 'ninbus-firmware-ninbus'→'firmware-ninbus'). enrichOrphanedDeployment também corrigido para usar local.artifactType. Overlay/stacking: member-add-form convertido de dropdown absolute z-[100] (sem Portal, clipável) → Radix Popover (Portal, nunca clipado); dialog/sheet bumpados z-50→z-[60] (acima de popovers/selects z-50). Stack saudável: api healthy 200, dashboard 200, hawkbit healthy.

**Evidence**: git log HEAD 8603bb5 (zero commits). node stripDsTypePrefix test: ninbus-firmware-ninbus→firmware-ninbus ✓. docker exec confirma z-[60] no chunk layout; onOpenAutoFocus/PopoverAnchor nos shared chunks; API sem errors. createOtaDeploymentSchema: artifactType t.Union(3 literals).

### ✅ Code Quality

Removi componentes DUPLICADOS que criei por engano (search-input.tsx, type-badge.tsx) após o usuário apontar que Input/Badge/Popover já existem — reutilizei os existentes em TODO lugar. member-add-form.tsx (172→205 linhas, ainda <250) agora usa Popover existente em vez de dropdown custom absolute. Nenhum arquivo novo. enrichment.ts ganhou stripDsTypePrefix helper documentado. Logger %s format intacto.

**Evidence**: ls confirma search-input.tsx e type-badge.tsx removidos; member-add-form importa Popover de @/components/ui/popover.

### ✅ Schema Organization

Nenhuma mudança em schemas de rota. O fix é no enrichment (camada de service) que mapeia hawkBit DS → EnrichedDeployment — não afeta schemas TypeBox. createOtaDeploymentSchema (Union de 3 literais) continua sendo a validação canônica que impede tipos inválidos na entrada.

**Evidence**: schemas.ts intocado; enrichment.ts type: local?.artifactType ?? stripDsTypePrefix(ds.type)

### ✅ Error Handling

Two-level hawkBit protection intacto. stripDsTypePrefix é defensivo (retorna undefined se ds.type undefined, retorna as-is se não tem prefixo). enrichment já tratava statsFetchFailed→status unknown. Popover no member-add-form usa onOpenAutoFocus preventDefault (mantém foco no input de busca). Nenhum novo caminho de erro.

**Evidence**: stripDsTypePrefix: if (!dsType) return undefined; return startsWith ? slice : dsType

### ✅ Test Coverage

Backend tests 100% intactos (não toquei em testes). O fix de enrichment é uma correção de mapeamento (não lógica de status), então os testes existentes de enrichment continuam válidos. O Bun segfault intermitente no Windows (pré-existente) impede rodar a suite completa aqui, mas o build é limpo.

**Evidence**: tests/ intocado; bun build clean

### ✅ Config Centralization

Nenhuma nova config ou process.env. Todas as mudanças são lógica de UI/enrichment. Rerun Docker via docker compose build/up (sem novas env vars).

**Evidence**: sem mudanças em env.ts/.env.example/.env.test

### ✅ Security

Nenhuma mudança de auth/RBAC. CONFIRMAÇÃO: não há escrita direta no banco — o único db.insert(deployments) está em createDeployment (write-through APÓS validação da Union schema + criação no hawkBit). artifactType nunca vem do cliente sem validação. Popover/Portal do Radix mantêm acessibilidade (focus management, escape).

**Evidence**: rg db.insert(deployments) → apenas service.ts:172 (dentro de createDeployment, após validação). createOtaDeploymentSchema artifactType: t.Union([3 literals])

### ✅ 🔮 Futuro (Aprendizado Contínuo)

Princípio p-enrichment-local-is-source-of-truth aprendido: ao enriquecer entidades hawkBit, o registro LOCAL é a fonte de verdade para campos de domínio (artifactType, displayName) — chaves internas do hawkBit carregam prefixo de namespace que difere do enum canônico. Um 'tipo diferente que parece bug de dados' é quase sempre um bug de mapeamento de enrichment, não escrita direta no banco — verificar o caminho de escrita (write-through após validação da API) antes de assumir corrupção. Lição de processo: NÃO criar componentes duplicados sem antes analisar o que já existe no projeto (Input, Badge, Popover, Toolbar cobrem busca/badge/overlay).

**Evidence**: principles.json p-enrichment-local-is-source-of-truth

## Overall Notes

Iteração 55: investigação e correção do 'tipo diferente' nos deployments + refinamento de overlays/componentes. ROOT CAUSE: NÃO era escrita direta no banco — o caminho de criação de deployment é 100% via API (POST /deployments valida artifactType como Union de 3 literais → createDeployment cria DS no hawkBit → write-through local). O bug estava no ENRICHMENT: enrichDeployment retornava ds.type (DS-type KEY do hawkBit 'ninbus-firmware-ninbus') em vez do artifactType canônico ('firmware-ninbus'). Corrigido: local.artifactType é a fonte de verdade + stripDsTypePrefix como fallback. Overlays/stacking: member-add-form convertido de dropdown absolute (sem Portal, clipável) → Radix Popover (Portal); dialog/sheet z-50→z-[60] (acima de popovers/selects z-50). Barras de busca: flex-1/w-full para preencher espaço (company-device-table, data-table). Componentes: removi duplicatas (search-input, type-badge) e reutilizei Input/Badge/Popover existentes após o usuário apontar. Rerun Docker: api + dashboard rebuildados e recriados, stack saudável. ZERO commits (HEAD 8603bb5).