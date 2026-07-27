# Plano de Ação REVISADO — Edição de Dispositivos e Artefatos (v2)

> **Status:** PLANEJAMENTO — aguardando aprovação. Incorpora as 3 observações do revisor.
> **Princípios:** mínimo de alterações, DB local canônico, não interferir no fluxo do hawkBit, harness ativa para qualidade.

---

## PARTE A — Resposta direta às 3 perguntas

### Pergunta 1 — "Esses dados (descrição / artifactName / originalFile / payloadBytes) não seriam melhores como colunas no banco via migration?"

**Resposta: SIM — e as colunas JÁ EXISTEM.** Sua intuição está corretíssima e bate com o princípio do projeto ("DB é canônico" / write-through).

Verificando `src/common/db/schema/artifacts.ts`, a tabela **já tem** todas essas colunas:

| Segmento da string composta do hawkBit | Coluna equivalente no DB local | Status |
|----------------------------------------|-------------------------------|--------|
| `{descrição}` | `artifacts.description` | ✅ existe |
| `artifactName: {nome visível}` | `artifacts.name` | ✅ existe |
| `originalFile: {arquivo}` | `artifacts.original_filename` | ✅ existe |
| `payloadBytes: {tamanho}` | `artifacts.payload_size` | ✅ existe |
| (tamanho do .tar) | `artifacts.package_size` | ✅ existe |

**O problema atual:** o código ESCREVE essas colunas no upload (write-through correto), **mas LÊ o `name` de exibição fazendo *parse* de uma string composta** no `description` do Software Module do hawkBit (`extractDisplayName()` em `service.ts:54`). Ou seja: temos colunas canônicas mas ignoramos elas na leitura — fragilidade desnecessária.

**Decisão de design (ADOTADA):** tornar o **DB local a fonte canônica** dos metadados de exibição do artefato. O hawkBit fica responsável **somente pelo binário (S3, por ID)** e pelos metadados operacionais (locked, version, type, hashes, DS de bloqueio). Isso:
- Remove o parse/reconstrução frágil da string composta.
- Simplifica drasticamente o PATCH (só atualiza colunas locais — sem "rebuild" de string).
- Mantém o fluxo do hawkBit **intacto** (continuamos escrevendo a string composta no upload por compatibilidade com a UI do hawkBit, mas ela passa a ser **não-authoritativa**).
- É exatamente o padrão já usado em **devices** (`devices.name` canônico + name-sync best-effort).

➡️ **Consequência:** o PATCH de artefato vira uma operação puramente local (update de colunas), com sync best-effort opcional para o hawkBit. **Zero parsing de string composta.**

---

### Pergunta 2 — "O campo descrição nos dispositivos vai ser adicionado? E o campo da etiqueta dele também vai ser modificado?"

- **`description` (dispositivo):** SIM, será adicionado — 1 coluna nova `devices.description` (text, nullable) + 1 migration. Exposta automaticamente nos GETs (lista e detalhe) via `selectDeviceSchema` auto-derivado.
- **"Etiqueta" do dispositivo:** = o campo **`name`** (rótulo/legenda amigável que o usuário dá ao dispositivo). **Já existe e já é editável** via `PUT /:deviceId` hoje. O novo **`PATCH /:deviceId`** também o edita (`{ name?, description? }`). Ao mudar o `name`, o name-sync propaga (best-effort) para o `Target.name` do hawkBit — igual ao fluxo atual.

Resumindo: nesta iteração, o dispositivo ganha `description` (novo) e o `name` (etiqueta) passa a ser editável também via PATCH (hoje só via PUT).

---

### Pergunta 3 — "A etiqueta fica só na API hoje, não vai ao embarcado, correto? Ao conectar no hawkBit com auth, dá pra enviar essa etiqueta ao dispositivo e sincronizar com o que a API guardou?"

**Confirmação (correto):**
- Hoje a etiqueta (`devices.name`) vive em **2 lugares**, ambos **nível API/servidor**:
  1. `devices.name` no DB Ninbus (canônico).
  2. `Target.name` no hawkBit (via name-sync, best-effort) — usada **só para a lista de targets na UI do hawkBit**.
- **Nada disso chega ao firmware do dispositivo.** O `Target.name` é metadado de gerência; o device **nunca o recebe** via DDI.

**Viabilidade de enviar a etiqueta ao dispositivo — SIM, é possível, mas é um recurso SEPARADO:**

O hawkBit entrega dados/configuração a um device **apenas via Distribution Set (atribuição de deployment)**. O Ninbus **já tem o tipo de artefato certo para isso**: `configuration-nfx` (software module de configuração). Portanto, o caminho seria:

> Ao detectar a conexão do device (poll DDI → o sync engine já detecta `pollStatus`/eventos de conexão), a API criaria/atribuiria um **Distribution Set de configuração** carregando a etiqueta (e/ou outros metadados), que o device baixaria e aplicaria no próximo ciclo DDI.

**Por que NÃO entra nesta iteração:**
- Tem complexidade própria: ciclo de vida do config-DS (criar/versão/idempotência), interação com deployments de firmware ativos (conflito de DS), definição do que o device FARIA com o config recebido (precisa de contrato firmware), e persistência de "última etiqueta entregue" para re-sincronizar.
- Escopo desta tarefa = edição de metadados (name/description). Misturar entrega de config ao device infla risco.

➡️ **Ação:** registro como **item futuro** na seção E (Pós-iteração), com esboço de design para aprovação em momento oportuno. **Não implementado agora.**

---

## PARTE B — Design revisado (o que muda do plano v1)

### B.1 Artefato: DB local canônico (MUDANÇA PRINCIPAL)

`enrichSoftwareModule()` passa a **preferir o registro local** para `name` e `description`:

```ts
export async function enrichSoftwareModule(
  sm: HawkbitSoftwareModule,
  companyId?: string,
  local?: Pick<Artifact, 'name' | 'description'>,   // ← NOVO parâmetro opcional
): Promise<EnrichedSoftwareModule> {
  ...
  return {
    ...sm,
    name: local?.name ?? extractDisplayName(sm),          // local优先; fallback p/ hawkBit
    description: local?.description ?? sm.description,    // local优先; fallback p/ hawkBit
    ...
  };
}
```

- `listArtifacts()`: já busca os registros locais → monta `Map<hawkbitSmId, local>` e passa para o enrich.
- `getArtifact()`: hoje só faz `requireOwnership` (traz só `companyId`). Passa a trazer o registro completo (name/description) para passar ao enrich.
- `extractDisplayName()` **permanece como fallback defensivo** (para SMs antigos ou caminhos sem registro local) — **não é removido** (evita regressão).
- O `description` do SM no hawkBit **continua sendo escrito** no upload (compatibilidade com UI do hawkBit) mas **deixa de ser authoritativo**.

### B.2 Artefato: PATCH simplificado (sem rebuild de string)

```ts
export async function patchArtifact(companyId, smId, updates: { name?: string; description?: string }) {
  await requireOwnership(companyId, smId);          // ownership local (lança 404)
  requireHawkbit();                                  // guard (400 se desabilitado)
  // 1. Update DB local (canônico)
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.description !== undefined) set.description = updates.description === '' ? null : updates.description;
  await db.update(artifacts).set(set).where(eq(artifacts.hawkbitSmId, smId));
  // 2. Sync best-effort ao hawkBit (description composto) — NÃO bloqueia, NÃO é authoritativo
  await syncArtifactDescriptionToHawkbit(smId, { ...updates }).catch(() => {});
  // 3. Retorna enriched (lendo do DB local agora)
  const [local] = await db.select().from(artifacts).where(eq(artifacts.hawkbitSmId, smId));
  return enrichSoftwareModule(await hawkbitSoftwareModules.get(smId), companyId, local);
}
```

> Nota: o sync best-effort do description ao hawkBit é **opcional** (mantém a UI do hawkBit razoável). Se preferir "zero interferência no hawkBit", podemos **removê-lo** e o PATCH fica 100% local. **Decisão pendente de aprovação** — default: manter best-effort.

### B.3 Dispositivo: inalterado do v1 (mínimo)

- Coluna `devices.description` + migration.
- `updateDevice()` ampliado para aceitar `description?: string | null` (normaliza `''`→`null`).
- Nova rota `PATCH /:deviceId` ({ name?, description? }), role `operator`, response `DeviceUpdateResponseSchema`.
- PUT existente **intacto**.

---

## PARTE C — Plano de edição (diff esperado, mínimo)

| # | Arquivo | Mudança | Linhas ≈ |
|---|---------|---------|----------|
| 1 | `src/common/db/schema/devices.ts` | + coluna `description: text('description')` | 1 |
| 2 | `drizzle/0013_device_description.sql` (+ meta) | `ALTER TABLE "devices" ADD COLUMN "description" text;` | — |
| 3 | `src/modules/devices/schemas.ts` | + `patchDeviceSchema` (body) | 6 |
| 4 | `src/modules/devices/service.ts` | ampliar tipo de `updateDevice` p/ `description` + normalizar `''`→null | 4 |
| 5 | `src/modules/devices/index.ts` | + rota `PATCH /:deviceId` (operator) | ~28 |
| 6 | `src/modules/artifacts/schemas.ts` | + `patchArtifactSchema` (body) | 6 |
| 7 | `src/modules/artifacts/service.ts` | `enrichSoftwareModule` +param `local`; `listArtifacts` passa lookup; `getArtifact` traz registro local; + `patchArtifact()` | ~35 |
| 8 | `src/modules/artifacts/manage-routes.ts` | + rota `PATCH /:artifactId` (operator) | ~30 |
| 9 | `tests/devices.test.ts` | PATCH atualiza name+desc; GET inclui description; PATCH 404; PATCH 400 nome vazio | ~40 |
| 10 | `tests/artifacts.test.ts` | PATCH 404 (não-dono); PATCH 400 (hawkbit off); PATCH sem body | ~25 |

**Migrations:** **1** (`devices.description`). Artefato = **0** (colunas já existem).
**Arquivos novos:** **0**. **Breaking changes:** **0**.

---

## PARTE D — Tratamento de erros (2 níveis, por princípio)

- **Dispositivo PATCH:** 404 (não encontrado) · 403 (companyRole operator) · 400 (nome vazio via schema `minLength:1`).
- **Artefato PATCH:** 404 (`ArtifactNotFoundError`/ownership) · 400 (`ArtifactValidationError`/`HAWKBIT_NOT_ENABLED`) · 409 (se hawkBit retornar conflito — propagado defensivamente) · 503 (rede/hawkBit indisponível, via catch `HawkbitApiError`).
- O `409` da string composta **não ocorre na prática** (o `name` do SM continua `sm-{uuid}`, nunca muda). Mantido só por defesa.

---

## PARTE E — Itens futuros (registro, NÃO nesta iteração)

1. **Entrega de etiqueta/config ao dispositivo** (pergunta 3): via Distribution Set de configuração (`configuration-nfx`) ao detectar conexão. Esboço:
   - Trigger: evento de conexão (`device_connections`) ou mudança de `name`.
   - Criar/versão de config-DS leve carregando a etiqueta; atribuir ao target.
   - Persistir `lastConfigPushedAt`/`lastLabelPushed` p/ re-sincronização e idempotência.
   - Contrato firmware necessário (o que o device faz com o config). **Aprovação separada.**
2. (Opcional) Expor `originalFilename`/`payloadSize` locais no response do artefato (já são colunas).

---

## PARTE F — Engajamento da harness e processo

1. Após implementar, rodar **`bun test --env-file=.env.test`** + **`bun build`** + typecheck/lint.
2. Aplicar migration nos 3 bancos (local, test, cloud) e **verificar via `information_schema.columns`** (princípio do projeto).
3. Rodar **`harness_analyze`** contra os 8 critérios (Functional Correctness, Code Quality, Schema Organization, Error Handling, Test Coverage, Config Centralization, Security, Futuro).
4. **`harness_submit`** honesto — se algum critério falhar, registro o aprendizado (`harness_learn_principle`) e itero.
5. Aguardar revisão humana; só depois `harness_advance`.

---

## PARTE G — Decisões pendentes de aprovação (sim/não)

| # | Decisão | Default proposto |
|---|---------|------------------|
| D1 | Adotar DB local canônico para artefato (ler name/desc do DB, não do parse hawkBit) | ✅ SIM |
| D2 | Manter o sync best-effort do `description` ao hawkBit no PATCH do artefato (UI hawkBit) — OU zero interferência (100% local)? | **Manter best-effort** |
| D3 | Adicionar `patchDeviceSchema` novo em vez de reusar `updateDeviceSchema` (PUT tem serialNumber, PATCH não) | ✅ SIM (schema novo) |
| D4 | `manage-routes.ts` fica ~315 linhas (acima meta 250) — split agora ou depois? | **Depois** (mínimo churn) |
| D5 | Entrega de etiqueta ao device (config-DS) | **Futuro** (não agora) |

---

**Aguardando aprovação do plano (Parte A–G) antes de editar qualquer código.**
