# Plano — Adaptação do console Ninbus para Arc UI (referência: ninbus-arc)

> Working tree, sem commits. Referência visual/interação = sample `ninbus-arc`
> (Vite + Arc). Fonte de verdade do domínio = projeto atual (API real, Better
> Auth, RBAC, SSE, hawkBit).

## Decisões

1. **Instalação oficial**: componentes Arc via `npx shadcn add @uiarc/<id>`
   (registry já em components.json). Nenhum estilo interno é reescrito;
   `foundation.css` importado UMA vez no root layout. Sample usado apenas como
   referência de composição (nunca de dados/lógica).
2. **Camada de app**: portar `ui.tsx` do sample (Status/Panel/Surface/
   RefreshButton/SafeAction/PeriodFilter/Collection) para
   `src/components/arc-app/`, conectada a `useFetch`/services reais.
   `Collection` = busca/filtro/ordenação/paginação sobre a coleÇÃO CARREGADA
   (lists atuais retornam a coleção inteira — a busca cobre tudo, não só a
   página).
3. **Shell**: sidebar fixa 232px (brand, workspace, busca ⌘K, nav, perfil) +
   topbar breadcrumb — mesma estrutura do sample. Nav = rotas reais do Next.
   Tema claro/escuro via `data-theme` (toggle IconMorph como no sample).
4. **Detalhes em Surface** (Drawer desktop / BottomSheet ≤640px) como no
   sample; rotas `/[id]` existentes mantidas via redirect para a lista com o
   drawer aberto (query param) — links antigos continuam funcionando.
5. **Observabilidade preservada**: timeline de conectividade (SVG bespoke)
   vira painel "Conectividade" nos detalhes da empresa, re-estilizada com
   tokens Arc (`--success`, `--border`...). Dados = `observabilityService`.
6. **Auth**: login/sign-up/reset re-skinned com Arc (Input/PasswordField/
   Button/Alert) mantendo signIn/signUp/reset reais.

## Mapa de integração (referência → real)

| Sample | Real (client) | Observação |
|---|---|---|
| Criar empresa | companyService.create {name, ownerEmail} | convite owner = designação real |
| Membros/convites | memberService.add {email, role} / designationService.create/cancel | papéis owner/admin/operator/viewer |
| Registrar dispositivo | deviceService.provision {serialNumber, deviceKey, name?} | idêntico ao sample |
| Vincular à empresa | POST /companies/:id/devices (claim por serial) + PUT :id/link {deviceKey} | clientes a adicionar |
| Grupos | POST /companies/:id/categories {name,type,description?}, rename/remove, addMembers/removeMember (devices) | **Pessoas em grupos NÃO existe** → aba Pessoas omitida (lacuna registrada) |
| Publicar release | firmwareService.upload FormData (XHR real c/ progresso p/ FileDropzone) + publish/unpublish | |
| Preparar deploy | firmwareService.deploy(deviceIds, artifactType, releaseId) | rollout REAL |
| Rollout detail | deploymentService.targetStatuses + statusTrail | fases reais hawkBit |
| Empresa settings | companyService.update(name)/setStatus/remove | **description/guidelines/approval NÃO existem** → omitidos (lacuna) |
| Audit | observabilityService.activity (+actorUserId) | |

## Lacunas do backend (registradas, não simuladas)
- Grupos sem pessoas (apenas dispositivos).
- Empresa sem descrição/diretrizes/flag de aprovação.
- Convite sem seleção de grupos no create (role apenas).
- Sem endpoint de memberships-por-usuário (detalhe do usuário mostra atividade real; vínculos apenas contagem).

## Ordem
1. Instalar componentes Arc + foundation + fontes (Geist) + tema data-theme
2. `arc-app/` (ui.tsx portado + Status com valores reais + Collection)
3. Shell (layout admin) + busca global CommandPalette + auth re-skin
4. Páginas: overview → companies(+detail) → devices → deployments(+firmware) → users(+invites) → groups → audit
5. Drawers de detalhe + formulários reais (provision/claim/link/members/groups/upload/deploy)
6. Remoção de shadcn/system substituídos + deps órfãs
7. Validação: tsc, build, lint, navegador 390/768/1024/1440, checklist Arc
