# INC-675 — Catálogo contaminado: deploy serviu row 4.0.6 espúria (linhagem server-sign .bin)

> **Status: AGUARDANDO APROVAÇÃO — nenhum comando executado, nenhum código editado.**
> Classe: procedência/processo (não é bug do pipeline). Continuação da mesma classe de
> INC-658 · INC-662/664 · INC-673/674 — todas: upload de `.bin` cru via server-sign
> com versão digitada manualmente.
> Runbook base: `docs/notes/incident-673-fix-runbook.md` (as premissas "Path A" dele
> estão **invalidadas** por este incidente — ver §3).

## 1. Identificador

**INC-675** — *catalog poison / server-sign .bin lineage* (numeração acompanha os
deployment IDs do hawkBit para correlação direta: 658, 662–664, 673/674, 675).

## 2. Fatos (com prova no log do device, 21/09)

| # | Fato | Prova |
|---|---|---|
| F1 | Deploy 675 serviu tar **182.784 B** com imagem interna **179.714 B** (`0x2BE02`) | `[ddi] deployment 675: zephyr.tar 182784B` + `tamanho imagem=0002be02` |
| F2 | O arquivo do usuário tem **116.968 B** (`0x1C8E8`) — NÃO foi o artefato servido | log vs `E:\develop\Ninbus-v4\build-4.0.6\zephyr\zephyr.bin` |
| F3 | Manifesto servido: **counter=4, version=4.0.6** (`04000600`) | `counter manifesto=00000004`, `versao manifesto=04000600` |
| F4 | counter=4 = floor 3 + 1 ⇒ a row 4.0.6 foi assinada **quando o piso era 3** (após a 4.0.4-espúria existir) | `upload.ts:51-52` (`signCounter = floor+1`) |
| F5 | Tar 182.784 B = fingerprint **server-sign** (2.560+⌈(128+179714)/512⌉·512); fábrica daria 122.880 B | aritmética do tar (documentada em INC-673) |
| F6 | O nome `zephyr.tar` confirma: a row espúria **também nasceu de um `zephyr.bin`** (renomeado em `upload.ts:119`) — um rebuild ~179,7 KB da bancada (linhagem 179.489→179.584→**179.714**→179.794) | `upload.ts:119` + histórico da linhagem |
| F7 | Uploads do usuário (.tar ontem, .bin hoje) **nunca criaram row** | Índice único `(artifact_type, version)` (`schema/firmware.ts`): só pode existir UMA row 4.0.6; a servida tem imagem 179.714 B ⇒ a row existente é de outrem ⇒ upload do usuário bateu **409 DUPLICATE_VERSION** (`upload.ts:100`) |
| F8 | O piloto foi feito com `releaseId` da row 4.0.6 **já existente** (o usuário selecionou no dashboard pensando ser a sua) | consequência direta de F7 |
| F9 | Cadeia de segurança funcionou 100%: assinatura OK, anti-replay v2 correto (4>3, 4.0.6>4.0.4), staging+SHA, vetores inválidos detectados (SP/PC lixo ⇒ imagem não é app STM32), **rollback transacional, zero brick** | log completo |
| F10 | ⚠️ **O bootloader queimou piso NOVO: (counter=4, version=4.0.6)** — mesmo com apply falho (o piso queima no staging/validação; precedente: o piso (3, 4.0.4) veio de serve anterior com apply falho) | skill §Anti-replay + precedente 662→673 no próprio log (`counter aceito=3/versao aceita=4.0.4` antes do apply do 675) |

## 3. ⚠️ A armadilha do plano atual (achado crítico deste incidente)

O plano do agente embarcado ("deletar a 4.0.6 espúria → subir o tar de fábrica 4.0.6
counter=6 → esperar `versao=04000600 … → TRIAL`") **vai ser rejeitado pelo bootloader**:

- Regra v2 do device: rejeita `counter ≤ piso` OU (`version ≤ piso` E `!allow_downgrade`).
- Após 675, piso = **(4, 4.0.6)**. O tar de fábrica 4.0.6 (sem flag) tem `version == piso`
  ⇒ **rejeição na hora**, mesmo com counter 6 > 4.
- O gate de publish **não vê esse piso** (ele compara com `max(devices.firmware_version)`
  do configData = 4.0.3) — ou seja, a API vai deixar publicar e o device vai recusar.
  O journal do bootloader é invisível para o backend.

**Solução — duas opções:**

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A (recomendada): lançar como 4.0.7** | `ota_sign.py --version 4.0.7` (counter 6, SEM allow_downgrade) + `ota_pack.py` | Semântica limpa, monotonicidade preservada, sem flag de downgrade | Rebuild/re-assinatura (2 min) |
| B: 4.0.6 com `--allow-downgrade` | `ota_sign.py --version 4.0.6 --allow-downgrade` (counter 6, bit0=1) | Sem mudar o número da versão | Abusa da flag; piso version continua 4.0.6 para sempre |

Serial esperado (Opção A): `counter=6 aceito=4 · versao=04000700 · tamanho=0001c8e8`
→ vetores válidos → apply → reboot em **4.0.7**.

## 4. Estado atual inferido do catálogo (a confirmar na Fase 0)

```
firmware-ninbus (linhagem espúria server-sign):
  … rows antigas counters 1–2 (imagens 179.489/179.584 B)
  "4.0.4"  published  counter=3  img 179.794 B  ← servida 673/674 (rejeitada no anti-replay)
  "4.0.6"  draft?     counter=4  img 179.714 B  ← servida 675 (apply falho → rollback)
                                             ← created_at/created_by DESCONHECIDOS (Fase 0)
Device de bancada: rodando 4.0.3-dev, piso journal (4, 4.0.6), action 675 ROLLED_BACK
```

## 5. Plano de ação (para aprovação — nada executado ainda)

### Fase 0 — Evidência (read-only, ~5 min) — EC2
1. `bash tmp/ec2-incident673-diag.sh | tee diag-inc675.log` (query 1 = row 4.0.6:
   `created_at`, `created_by`, `original_filename`, `payload_size=179714`, `counter=4`)
2. Logs da API na janela dos uploads do usuário (ontem + hoje ~13h):
   grep `DUPLICATE_VERSION` / `[FIRMWARE]` → confirma F7 e o momento exato.
3. Decisão da versão: **A (4.0.7)** ou B — aprovar aqui.

### Fase 1 — Freio + limpeza do catálogo (API, ~10 min)
1. `POST /api/admin/firmware/<id-4.0.4>/unpublish` — mata o auto-resolve errado já.
2. Cancelar actions `active=1` restantes (two-step force, ver runbook §3.2).
3. `DELETE /api/admin/firmware/<id-4.0.6-espúria>?realignFloor=true` (foi servida ⇒ guard exige realign; piso real do device é 4 e o realign mantém o piso do catálogo em 4).
4. `DELETE /api/admin/firmware/<id-4.0.4-espúria>?realignFloor=true` (idem).
5. Revisar rows counters 1–2 da linhagem (query 1): deletar as não-servidas sem realign; servidas ⇒ realign.

### Fase 2 — Release limpa de fábrica (Opção A)
1. Embarcado: `ota_sign.py --version 4.0.7` (counter 6) + `ota_pack.py` sobre o zephyr.bin atual (116.968 B) → tar 122.880 B.
2. Upload via dashboard: file=tar, version digitada **4.0.7** (manifesto é a fonte; mismatch = 400).
3. Agora SEM 409 (row 4.0.7 não existe; counter 6 > piso catálogo 4).

### Fase 3 — Piloto + verificação na bancada
1. Deploy piloto com `releaseId` da **4.0.7** (device de bancada).
2. Serial esperado: `counter=6 aceito=4 · versao=04000700 · tamanho=0001c8e8` → vetores válidos → apply → reboot → banner `Ninbus Gateway 4.0.7` + `configData fw.ninbus=4.0.7`.
3. Se rejeitar em version ⇒ piso era (4, 4.0.6) confirmado (F10) — Opção B seria o fallback.

### Fase 4 — Publish + frota
1. `POST /:id/publish` (gate passa: v2==4.0.7, counter 6>4, fleet floor 4.0.3).
2. Monitorar `device.action.status`/`deployment.stats` nos primeiros devices.

### Fase 5 — Hardening (mudanças de código/config — aprovação separada)
1. **`FIRMWARE_ALLOW_BIN_SIGN`** (default `false` em prod): flag nova em `env.ts` + guard no caminho `.bin` de `upload.ts` + `.env.example`/`.env.test`. Mata a classe de incidente inteira (658→675).
2. Imediato sem código: garantir `FIRMWARE_SIGNING_KEY` **vazia** no `.env` da EC2 (`docker exec ninbus-api printenv FIRMWARE_SIGNING_KEY`) — se vazia, o server-sign já falha hoje (checar qual erro o dashboard mostra; se for 500, virar 400 claro).
3. Dashboard: upload com erro 409 precisa ser **impossível de ignorar** (toast error existe, 10 s — mas o usuário passou por cima sem registrar; avaliar bloqueio de tela + texto com o `release ${id}` conflitante que a API já retorna). Correlaciona com a migração shadcn em andamento.
4. Embarcado (futuro): struct de versão em offset fixo da imagem — fecha o gap de procedência que o gate não cobre.
5. Registrar em `activity log`: todo upload `.bin` server-sign com `created_by` (já existe via `logActivity`) — alertar em novos.

## 6. Perguntas abertas (Fase 0 responde)

1. Quem/quando criou a row 4.0.6 espúria (`created_by`, `created_at`)? — a row contrafatura um `zephyr.bin` de ~179,7 KB (rebuild da bancada) digitado como "4.0.6".
2. Os uploads do usuário retornaram 409 visível no dashboard e passaram despercebidos, ou o toast falhou? (logs + reprodução).
3. Por que a linhagem da bancada tem builds ~179,7 KB quando o zephyr.bin oficial é ~117 KB? (provável board/debug build errada sendo assinada — corrigir na ponta da bancada).

## 7. Lição

O backend não divergiu: o catálogo foi **contaminado pela porta de entrada legítima**
(server-sign `.bin`), e cada tentativa de conserto sem limpar o catálogo antes só
served a contaminação de novo — e queimou piso novo no device (F10). A ordem correta é:
**evidência → freio → limpeza → release nova (4.0.7) → piloto → publish → fechar a porta (.bin)**.

## 8. Latente corrigida em decorrência (feature de download)

**publication-gate.ts: `imageSha256` de evidência computado sobre o slice errado** —
usava `tar.subarray(tar.length - imageSize)`, mas o tar termina com blocos de fim +
padding; a imagem é o final do MEMBRO de dados. O sha registrado em
`firmware_releases.gate` (evidência forense!) não era o sha real da imagem. Corrigido:
`extractImageFromTar` (extração por membro, tar-validator) passou a ser a fonte única,
usada pelo gate e pelo endpoint `?part=image`. Os VEREDITOS do gate nunca dependiam
desse sha (digest do manifesto é verificado no parse) — apenas a evidência registrada
saía errada. Descoberto pelos testes de extração da própria feature.
