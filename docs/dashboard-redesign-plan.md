# Plano: Redesign completo da Dashboard — "Fleet Control Surface" (shadcn)

> **Status:** 🎨 PLANO — aguardando aprovação da direção visual antes do build em massa.
> Substitui os componentes atuais (genéricos) por um sistema próprio sobre **shadcn/ui**.
> Pré-requisito já entregue: `src/lib/design/tokens.ts` (sistema de sinais tipado).

---

## 0. Diagnóstico — por que o atual parece "feito por IA"

O dashboard hoje é o arquétipo do template genérico. Cada um desses é um tropo que
telegrafa "cópia de dashboard de IA":

| Tropo atual | Onde | Por que é genérico |
|---|---|---|
| `StatCard` com ícone dentro de uma caixa azul `bg-brand-50 text-brand-600` | `ui/Card.tsx` | padrão de todo template SaaS |
| Tudo em `rounded-xl` + fundo `gray-50` + `shadow-sm` | todos os Cards | visual "soft" sem identidade |
| Badge-pill colorido para **todo** status, sem hierarquia | `ui/Badge.tsx` | tag-cloud, não telemetria |
| Serial/UUID/versão na mesma fonte do corpo | tabelas | IDs são código, não prosa |
| Dica com emoji "💡" | `deployments/page.tsx` | copy de demo |
| Sidebar com linhas idênticas ícone+rótulo | `layout/Sidebar.tsx` | navegação sem densidade |
| Login: cartão flutuante centralizado + "Ninbus" em caixa azul | `auth/login` | onboarding de marketing |
| `DataTable` 131 linhas reescrevendo sort/filtro na mão | `tables/DataTable.tsx` | reinventa o que TanStack Table resolve |

**Resultado:** ninguém olha e pensa "sistema operacional de OTA". Pensa "dashboard".

---

## 1. Conceito de design — "Fleet Control Surface"

A metáfora é **mission-control / console de telemetria de uma frota OTA**. Cada decisão
visual reforça: *isto é infraestrutura que você opera, não um site de marketing*.

### 1.1 Movimentos de design intencionais (cada um é anti-genérico)

1. **Identificadores em monoespaço.** Serial, hawkBit target ID, versão, UUID → sempre
   `font-mono` com tracking sutil. *É a escolha mais distintiva e autêntica do domínio.*
   Nenhum template genérico faz isso — eles botam tudo na fonte do corpo.
2. **Status = geometria de sinal, não pill-badge.** Uma forma pequena preenchida
   (`dot`=ok · `square`=ocupado · `diamond`=instalando · `ring`=pendente · `slash`=falha)
   em tom semântico, com pulse opcional em estados "vivos" (online, baixando). Lê como
   uma faixa de telemetria. Já modelado em `tokens.ts`.
3. **Deployment = pipeline, não número.** O herói da tela de deployments é um fluxo
   horizontal `Atribuído → Baixando → Instalando → Instalado` com contagens passando
   pelos estágios, como esteira de fábrica/CI. **Isto é o que OTA significa.**
   Dashboards genéricos mostram "3 concluídos" num card.
4. **Densidade sobre respiro nas tabelas.** Frota real tem milhares de devices. Linhas
   compactas, serials em mono, signal-dots inline, header fixo, busca via command-palette.
   Densidade Linear/Vercel, não whitespace de landing-page.
5. **Command palette (⌘K).** Operador busca device por serial, pula pra empresa, roda
   "provisionar device". Console de power-user, não site de navegação. shadcn `Command`.
6. **Zero emoji, zero "💡", zero "Olá admin 👋".** Copy operacional enxuto. Empty states
   dizem *o que fazer*, não *como é delicioso*.
7. **Cor é semântica, não decorativa.** Base neutra refinada + **1** accent de ação + 5
   tons de sinal usados **só** para estado. Sem gradiente, sem glassmorphism, sem
   brand-blue-em-tudo. A identidade é a tipografia + a densidade + o sistema de sinais.
8. **"Fleet pulse" no overview.** Uma grade compacta de sinais (cada device = 1 célula,
   colorida por estado) no lugar de 4 stat-cards animados. Vê-se a saúde de 500 devices
   numa olhada. Genuinamente útil para OTA e parece nada genérico.
9. **Dark-first** (sensação de NOC), com light-mode de verdade. Ambos via tokens.
10. **Motion com significado.** Shimmer no progresso de um device baixando; pulse lento
    no dot online; flash único na linha que acabou de falhar. Nada decorativo.

---

## 2. Linguagem visual (tokens)

### 2.1 Tipografia
- **Sans:** Geist (Vercel) — grotesk moderno, distinto, **não é o Inter padrão**.
- **Mono:** Geist Mono — para **todo** identificador (serial, target ID, versão, UUID, key).
- Escala tipográfica enxuta; títulos sem decorative weight exagerado.

### 2.2 Cor (paleta de sinal)
- **Base:** neutro frio (zinc/slate). Dark-first: backgrounds ~`#0a0a0c`, superfícies
  elevadas um notch acima. Light: papel neutro (não branco puro).
- **Accent de ação (1 só):** índigo profundo refinado (`--primary`). É o único "cor de
  marca" — aparece em CTAs primários e foco, **nada mais**. *(Alternativa: cyan
  "transmissão" — uma decisão a confirmar.)*
- **Tons de sinal (5, só para estado):** `ok` (verde), `busy` (âmbar), `fault` (vermelho),
  `idle` (neutro), `info` (ciano). Definidos como CSS vars `--signal-*`, mapeados em
  `tokens.ts`. Componentes usam `TONE_SOFT`/`TONE_TEXT` — nunca hardcodeiam cor.

### 2.3 Espaçamento / densidade
- Tabelas: row `h-9`/`h-10` (compacto), header sticky, hover sutil.
- Cards de seção: `ring-1` fino no lugar de `shadow-sm` (mais "técnico", menos "fofo").
- Containers de conteúdo com `max-w` generoso em telas grandes (densidade horizontal).

### 2.4 Responsividade (concreto, não check-box)
- **AppShell:** sidebar → `Sheet` (slide-over) abaixo de `md`; topbar com trigger hamburger.
- **Tabelas:** abaixo de `sm`, cada linha colapsa num **card empilhado** (chave→valor) —
  NÃO scroll horizontal (ilegível no celular). Acima de `sm`, tabela densa normal.
- **Fleet pulse / pipeline:** grid reflow; pipeline empilha vertical no mobile.
- **Command palette:** funciona idêntico em qualquer largura (trigger ⌘K / botão).
- Breakpoints via container-queries onde fizer sentido (cards se adaptam ao container).

---

## 3. Arquitetura de componentes — camadas + containerização

"Containerizável" = cada componente é autônomo: **props in, render determinístico out**,
sem acoplamento à página. Páginas viram raízes de composição (≤40 linhas), não depósitos
de lógica. Separação **container (client, busca dados)** vs **presentacional (props)**.

```
src/components/
├── ui/                 # Camada 0 — PRIMITIVOS shadcn (gerados, intactos)
│   ├── button.tsx  card.tsx  table.tsx  dialog.tsx  sheet.tsx
│   ├── command.tsx  dropdown-menu.tsx  select.tsx  input.tsx
│   ├── tooltip.tsx  tabs.tsx  avatar.tsx  badge.tsx  skeleton.tsx
│   └── ... (adicionados sob demanda; nunca editados à mão)
│
├── system/             # Camada 1 — DESIGN SYSTEM Ninbus (reutilizáveis simples)
│   ├── index.ts        # barrel ÚNICO: `import { Kpi, Signal, Pipeline } from '@/system'`
│   ├── id.tsx          # <Id>      identificador monoespaço (+copy opcional)
│   ├── signal.tsx      # <Signal>  geometria de status + <SignalDot>
│   ├── phase.tsx       # <Phase>   chip de fase do deployment
│   ├── pipeline.tsx    # <Pipeline> funil de estágios OTA (signature)
│   ├── kpi.tsx         # <Kpi>     métrica única (SEM ícone-na-caixa)
│   ├── section.tsx     # <Section>/<SectionHeader>  container de conteúdo + slot de ação
│   ├── toolbar.tsx     # <Toolbar> barra de filtro/busca/ação (slots)
│   ├── state.tsx       # <Empty>/<Error>/<Loading>  estados operacionais enxutos
│   ├── time.tsx        # <Time>/<Relative>  data formatada + title
│   └── copyable.tsx    # <Copyable> click-to-copy (serials/keys)
│
├── layout/             # Camada 1 — SHELL / navegação
│   ├── app-shell.tsx       # <AppShell> sidebar + topbar + content (container)
│   ├── sidebar.tsx         # nav colapsável (shadcn navigation-menu / personalizado)
│   ├── topbar.tsx          # breadcrumb + trigger ⌘K + user menu
│   ├── command-palette.tsx # ⌘K (busca device serial, jump empresa, ações)
│   └── page-header.tsx     # <PageHeader> título + descrição + slot de ações
│
├── data/               # Camada 1 — exibição de dados genérica
│   ├── data-table.tsx      # shadcn Table + TanStack Table v8 (sort/filter headless)
│   ├── search-field.tsx    # input de busca com atalho ⌘K
│   └── filter-select.tsx   # select de filtro (wrapper shadcn Select)
│
└── domain/             # Camada 2 — COMPOSTOS de domínio (autônomos)
    ├── devices/
    │   ├── fleet-pulse.tsx        # grade de sinais (cada device = 1 célula)
    │   ├── device-table.tsx       # tabela densa (usa <DataTable> + <Signal> + <Id>)
    │   ├── device-row-mobile.tsx  # card empilhado p/ mobile
    │   ├── provision-dialog.tsx   # cadastrar por serial
    │   └── device-filters.tsx     # empresa + ordenação (slots no <Toolbar>)
    ├── deployments/
    │   ├── deployment-pipeline.tsx # <Pipeline> alimentado por statistics
    │   ├── deployment-table.tsx
    │   └── status-trail.tsx        # timeline por device (download→install→success/fault)
    ├── companies/
    │   ├── company-card.tsx        # card de tenant (status signal, contagens)
    │   ├── company-dialog.tsx      # precadastro
    │   ├── members-manager.tsx     # atribuir/remover/promover (tabela + ações)
    │   └── designation-row.tsx     # pendência (claim/cancel)
    └── users/
        ├── user-row.tsx
        └── role-badge.tsx
```

**Exemplo de uma página vira composição limpa:**
```tsx
// app/(admin)/devices/page.tsx — ~25 linhas
export default function DevicesPage() {
  const { data, loading, error, refetch } = useFetch(() => deviceService.listAll());
  return (
    <PageHeader title="Dispositivos" description="Frota OTA — estado em tempo real">
      <ProvisionDialog onSuccess={refetch} />
    </PageHeader>
    <DeviceTable devices={data?.data} loading={loading} error={error} onRetry={refetch} />
  );
}
```

---

## 4. Mapeamento domínio → UI (ataca os 8 pilares)

| Pilar | Hoje | Redesign |
|---|---|---|
| R1 provisionar por serial | Dialog genérico | `<ProvisionDialog>` com `<Id mono>` do serial gerado + `<Copyable>` |
| R2 listar/buscar/filtrar | tabela + busca client | `<DeviceTable>` TanStack + ⌘K + `<DeviceFilters>` |
| R3 ordenar | dropdown reescrevendo sort | TanStack column sorting (setas, multi-sort) |
| R4 usuários | read-only | `<UserTable>` + role-badge (logados depende de endpoint F-A) |
| R5 categorias | N chamadas | `<CategoryFilter>` agregado (depende de F-B) |
| R6 empresas + membros | tabela 226 linhas | `<CompanyCard>` grid + `<MembersManager>` (table+diálogo) |
| R7 observabilidade | status em badges | **`<Pipeline>` + `<StatusTrail>`** (timeline visual) + export |
| R8 eventos | ausente | feed/timeline (depende de F-D) |

---

## 5. Plano de migração — fases, commit por fase

Cada fase = 1 commit. Componentes velhos só são deletados **depois** do substituto em pé.

| Fase | O quê | Entrega |
|---|---|---|
| **0** ✅ | Alicerce: `lib/design/tokens.ts` (sistema de sinais tipado) | feito |
| **1** | Fundação visual: `components.json` + shadcn init + `globals.css` (vars `--signal-*`, dark-first) + Tailwind theme (Geist/Geist-Mono) + fontes. Remove `brand-*` blue. | tokens aplicáveis |
| **2** | Camada `system/` + `layout/` shell: `<Signal>` `<Id>` `<Kpi>` `<Section>` `<Toolbar>` `<Empty/Error>` + `<AppShell>` `<Sidebar>` `<Topbar>` `<CommandPalette>` `<PageHeader>`. **Substitui o layout admin** (primeiro lugar onde se vê a nova cara). | shell + primitives |
| **3** | Auth: redesign login + reset-password (porta de entrada — prova o conceito). | 2 telas |
| **4** | Overview: **`<FleetPulse>`** (signature) + `<Pipeline>` + `<Kpi>`s. | overview |
| **5** | Devices: `<DeviceTable>` (TanStack) + `<FleetPulse>` + `<ProvisionDialog>` + export. | devices |
| **6** | Deployments: `<DeploymentPipeline>` + tabela + `<StatusTrail>` (timeline). | deployments |
| **7** | Companies: `<CompanyCard>` grid + `<MembersManager>` + designations. | companies |
| **8** | Users + limpeza: remover TODOS os componentes antigos (`ui/*` manual, `tables/*`), QA responsivo mobile/desktop, polimento. | zero mortos |

> Fases 1–2 liberam a "cara nova" sem risco (são infraestrutura). Aprovação visual
> acontece **depois da Fase 2/3** — aí decido se sigo 4→8 em sequência.

---

## 6. Clean code / padrões (regras do projeto aplicadas)

- **Arquivo ≤ 250 linhas** (regra do repo). Composto grande = split por responsabilidade.
- **Barrel único** em `system/index.ts` → imports limpos (`import { Kpi, Signal } from '@/system'`).
- **Container vs presentacional:** páginas/server-buscam-dados; tabelas/dialog = client que
  recebem `data` por props. Lógica de fetch só em hooks (`useFetch`/`useMutation`).
- **Status→cor em UM lugar** (`lib/design/tokens.ts`). Zero hardcode de cor de estado.
- **Composição via slots**, não props-bombas: `<Section header={...} action={...}>{children}</Section>`.
- **TanStack Table v8** headless sob o `data-table.tsx` — elimina o sort/filter manual.
- **Acessibilidade:** shadcn já traz Radix (focus-trap, aria, keyboard); `<Signal>` tem
  `aria-label` com o texto do estado; ⌘K navegável por teclado.

---

## 7. Dependências a adicionar / remover

**Adicionar (shadcn):** `@radix-ui/*` (via CLI, só o que usar), `class-variance-authority`,
`tailwindcss-animate` (ou `tw-animate-css` p/ Tailwind v4), `cmdk`, `tanstack/react-table`,
`next-themes` (toggle dark/light), fontes Geist (`geist` package).

**Remover (ao final):** os componentes manuais `ui/Button|Card|Input|Badge|Modal|State`,
`tables/DataTable|SearchToolbar` (substituídos por `data/` + TanStack), `layout/Sidebar`
antigo. `jspdf`/`xlsx`/`lucide-react`/`ky`/`better-auth` **permanecem**.

---

## 8. Decisões que preciso (antes da Fase 1)

1. **Accent:** índigo profundo **ou** cyan "transmissão"? (proponho índigo; cyan é mais
   temático p/ OTA mas mais ousado).
2. **Dark-first ou light-first?** (proponho **dark-first** — NOC/telemetria).
3. **"Fleet pulse" no overview** (grade de sinais por device) — aprova o conceito-chave?
4. Approvo seguir **Fases 0→3** (fundação + shell + auth) e então você valida a cara antes
   de eu mass-convert devices/deployments/companies?

> Princípio arquitetural (a registrar): *a identidade visual de um dashboard de domínio
> vem de codificar a semântica do domínio no design system (IDs em mono, sinais como
> geometria, pipeline OTA) — não de uma cor de marca ou de tropos de template.*
