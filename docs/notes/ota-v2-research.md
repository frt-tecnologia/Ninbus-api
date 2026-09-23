# Notas de pesquisa — Contrato OTA NPM v2 (version-piso)

Data: 2025-04 (iteração 54) · Repo API: `E:/develop/Ninbus-api` · Firmware: `E:/develop/Ninbus-v4`

## Fatos confirmados (evidência)

| # | Fato | Fonte | Confiança |
|---|------|-------|-----------|
| F1 | Oracle `tools/ota_sign.py` **já atualizado** no repo do firmware (v1+v2, `--version`, `--allow-downgrade`) | leitura direta do arquivo | 100% |
| F2 | Layout v2: magic `NPM\x02` · size@4 · digest@8 · counter@40 · **version@44** · **flags@48** · siglen@52 · DER@53 · pad 0xFF até 128 | ota_sign.py `build_manifest` | 100% |
| F3 | Digest v2 = SHA256(image ‖ counter_le ‖ size_le ‖ version_le ‖ flags_le); v1 inalterado (trailer 8 B) | ota_sign.py `sign_digest`/`build_manifest` | 100% |
| F4 | `parse_version` do oracle: X.Y.Z[.B], dígitos apenas, cada ≤255 — **sujeira de sufixo é erro**; flags só bit0 (`flags & ~0x1` → erro) | ota_sign.py `parse_version` | 100% |
| F5 | Fonte da versão no build: `apps/ninbus_controller/VERSION` (Zephyr/west: MAJOR/MINOR/PATCHLEVEL/TWEAK/EXTRAVERSION) — working copy em 4.0.3-dev | arquivo presente | 95% |
| F6 | **NÃO existe versão embutida em offset fixo da imagem .bin** (sem struct/seção version em apps/) — greps dirigidos não acharam | busca no repo | 85% |
| F7 | Signer server-side atual (`ota-signer.ts`) é port fiel do v1; validador (`tar-validator.ts`) idem; round-trip com Python comprovado | leitura dos arquivos | 100% |
| F8 | Episódios 660–664: mesmo tar 182.272 B servido 4× (DS novo por deploy, mesmo SM), counter=1 ≤ piso 1 → rejeição anti-replay em 663/664 | relato do agente embarcado + código deploy | 90% |
| F9 | Re-assinatura de counter repetido NÃO veio do path server-sign (max+1 por construção); veio de re-oferecer o mesmo artifact e/ou re-upload .tar verbatim com counter do arquivo | análise do código `service.ts:97-99` | 80% |
| F10 | `triggerFirmwareUpdate` com `releaseId` explícito aceita release em **qualquer status** (draft incluso) — buraco restante do item 4 deles | status-service.ts | 100% |

## Hipóteses concorrentes (como o counter "falhou 4×")

- **H-A (95%)**: nenhuma re-assinatura ocorreu — o mesmo SM/artifact foi re-servido por deploys novos (deploy cria DS novo referenciando o SM da release published antiga). Floor veio do manifesto counter=1 do 660.
- **H-B (<10%)**: re-upload do mesmo .tar de fábrica (path verbatim) teria re-introduzido counter=1 — impossibilitado por DUPLICATE_VERSION a menos que a release tivesse sido deletada antes.
- **H-C (0%)**: bug em `max+1` do server-sign — refutado por leitura (coalesce max + 1, inclui drafts).

## Decisões de design (backend v2)

1. **Versão — fonte vs conferência**:
   - `.tar` de fábrica (canônico/produção): `manifest.version` é a **FONTE**; a versão digitada no upload vira **conferência** (mismatch = bloqueio).
   - `.bin` server-sign (dev/bancada): versão digitada é empacotada no manifesto v2 — exige X.Y.Z[.B] estrito (sufixo `-dev` → erro ensinando o caminho .tar). Documentado como postura dev; produção usa .tar de fábrica onde a versão está criptograficamente ligada.
   - Futuro (pergunta aberta p/ embarcados): embutir struct de versão em offset fixo na imagem → server extrai e verifica. Aguarda decisão firmware-side.
2. **Counter monotônico**: server-sign = max(catálogo)+1 (já); **.tar ninbus passa a exigir counter > max(catálogo)** — mata o replay verbatim por upload.
3. **Gate de publicação** (item 3 deles): roda no publish, persiste evidência JSONB na release (`gate`, `gate_at`). Checa: tar íntegro (re-download + validate), sha256 da imagem, v2 + version==digitada, counter > max published, version > piso da frota (max `devices.firmware_version`) salvo flag allow_downgrade. **Publish v1 ninbus → bloqueado** (item 6: novas releases são v2).
4. **Re-oferecimento bloqueado** (item 5): trigger falha 409 `REJECTED_ARTIFACT` quando a última deployment do tipo terminou em falha referenciando o MESMO SM da release e não há release publicada mais nova desde então.
5. **Compat**: validador aceita v1 e v2 (leitura); signer emite v2 quando versão fornecida, v1 quando não (paridade total com o oracle).

## Migração 0022

`firmware_releases` += `manifest_version` int null (u32 empacotado) · `manifest_flags` int null (bit0) · `gate` jsonb null · `gate_at` timestamptz null.

## Progresso

- [x] Fatos F1–F10 coletados
- [x] Hipóteses + refutações
- [x] Migração 0022
- [x] ota-signer.ts v2 (+parseVersionPacked)
- [x] tar-validator.ts v1+v2 (flags reserved-bits, digest estendido)
- [x] service.ts: conferência de versão no .tar, counter estrito no .tar, persistir manifest_version/flags
- [x] release-gate.ts: runPublicationGate + publish exige gate
- [x] status-service.ts: releaseId exige published; bloqueio de re-oferecimento
- [x] verify-rollout-artifact.mjs: parse v2
- [x] schemas.ts: expor campos novos
- [x] testes unitários v2 (round-trip, tamper, flags, sufixo, counter)
- [x] tsc sem erros novos + build + bun test
- [x] commits (feat/migrate/test)

## Perguntas deles — respostas

1. **Fonte da versão**: factory → `apps/*/VERSION` (west/CMake) via `ota_sign.py --version`; server-sign .bin → campo do upload empacotado (dev). F6: imagem não auto-descreve versão hoje.
2. **Fonte do counter**: `max(firmware_releases.counter)+1` no server-sign (inclui drafts); .tar verbatim com counter do manifesto — e a partir de agora validado `> max(catálogo)`. Falhou 4× porque não houve re-assinatura: o mesmo artifact foi re-servido (H-A) + releaseId explícito aceitava draft (F10).
3. **Registro do gate**: `firmware_releases.gate` JSONB + `gate_at` (evidência anexada à release, retornada pela API).

---

## Incidente 673 — "o backend está servindo um binário que não é nosso" (17/04)

### Evidência do embarcado (probe DDI independente, token key-test)
- tar 182.784 B sha `2247bec1…`; manifesto v2 counter=3 version=4.0.4 flags=0
- imagem interna 179.794 B sha `c0aaca9d067e…` — não bate com nenhuma build conhecida
  (4.0.4=116.928 B `1f3309f8…`, 4.0.5 errada=f59982c6…, antiga=004c8da8…)
- software module `sm-9cfb2e5e-…`
- Histórico de tamanhos: 79.360 (665) → 182.272 → 182.784

### Árvore de hipóteses (confiança calibrada)
- **H1 (~85%): upload de `.bin` errado via server-sign, de novo.** O backend não
  builda nada (grep: zero refs a zephyr/west/cmake/toolchain em src/). O server-sign
  assina OS BYTES RECEBIDOS com a versão DIGITADA e counter max+1. Imagem 179.794 B
  = o arquivo que ALGUÉM subiu (perfil HIL/debug da bancada); "4.0.4" = o que essa
  pessoa digitou; counter 3 = max+1 na hora. Os pares 182.272/182.784 = re-upload do
  mesmo arquivo (conters 3 e 4). Mesma classe de falha do 665, arquivo diferente.
- **H2 (<5%): tar de fábrica assinado por terceiro** — exigiria a chave dev fora do
  time embarcado. Counter/version do manifesto bateriam exatamente (batem), mas
  `original_filename` terminaria em `.tar`.
- **H3 (~0%): "o backend builda firmware próprio"** — impossível por construção
  (sem toolchain, sem checkout do repo de firmware, sem rede de build; código
  auditado).
- **Discriminador DECISIVO (uma query)**: `original_filename`, `created_by`,
  `payload_size` da row que aponta o SM. `.bin` + 179.794 + usuário da bancada ⇒ H1.

### Sobre "o gate não pega isso" — correto e documentado desde o 665
O gate valida **consistência** (re-download, sha recomputado, v2==declarada, counter
monotônico, piso da frota), não **procedência** — a imagem não se auto-descreve.
Mitigações na fila: struct de versão em offset fixo (embarcado), surfar
imageSize/sha no console + resposta do deploy, `FIRMWARE_ALLOW_BIN_SIGN=false` em
produção (mata o server-sign de .bin cru).

### Bundle de diagnóstico na EC2 (rodar e colar o output)
```bash
cd ~/Ninbus-api && docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
"SELECT version, status, counter, manifest_version mv, original_filename, payload_size,
        package_size, hawkbit_sm_id, created_by, created_at, gate_at,
        gate->>'imageSha256' img_sha, left(gate::text,200) gate_head
 FROM firmware_releases ORDER BY created_at DESC LIMIT 8;"
```
(SEM psql no container: `docker compose exec -T api node -e` com o postgres do
node_modules, ou rodar o SQL via Neon console com o DATABASE_URL do .env da EC2.)

## CONSENSO FINAL (17/04, agente embarcado + backend alinhados)

O pipeline não diverge de nada — serve fielmente o artefato PUBLICADO no
catálogo. A divergência 673/674 nasce da combinação:
1. Release espúria "4.0.4" (imagem 179.794 B, counter=3) nascida no caminho
   de server-sign de `.bin` cru (versão digitada) e publicada — o gate de
   consistência não vê procedência;
2. Todo o funil de deploy sem `releaseId` resolve "maior versão publicada",
   que era a espúria.

Episódios 660-664, 665 e 673/674 = mesma classe: **procedência na ponta de
cima**, nunca falha de pipeline. Runbook: cancelar actions abertas → delete
`?realignFloor=true` → upload tar de fábrica → piloto com `releaseId` →
publish. Sistêmico: `FIRMWARE_ALLOW_BIN_SIGN=false` (prod), struct de versão
em offset fixo (embarcado), surfar imageSize/sha no console + deploy.
