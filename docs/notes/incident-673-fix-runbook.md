# Runbook — Correção do incidente 673/674 em produção

> Incidente: devices 673/674 receberam tar 182.784 B (manifesto v2 counter=3,
> version=4.0.4) com imagem interna 179.794 B que não bate com nenhuma build
> conhecida. Consenso fechado em `ota-v2-research.md` (17/04): **release espúria
> "4.0.4" publicada no catálogo + resolvedor published-only**. Não é bug do
> pipeline: ele serve fielmente o que está PUBLICADO.

## 0. Resumo executivo (verificado em código nesta sessão)

| Fato | Evidência |
|---|---|
| O funil sem `releaseId` resolve SÓ `status='published'` | `catalog.ts:35` (`publishedOnly`) — usado por status mobile (`status-service.ts`), trigger mobile (`schemas.ts: TriggerFirmwareBodySchema` não tem `releaseId`) e deploy admin sem `releaseId` (`deploy-trigger.ts`) |
| A "4.0.4" espúria (server-sign de `.bin` cru, counter=3) é a maior PUBLICADA | aritmética do tar fecha: 2.560+⌈(128+179794)/512⌉·512 = **182.784 B** = `buildNinbusTar` (server-sign), não `ota_pack.py` (que daria 184.320 B) |
| O tar 4.0.6 legítimo de fábrica tem 122.880 B, counter=6, v=0x04000600 | 10.240·⌈(2.560+⌈(128+116984)/512⌉·512)/10.240⌉ = **122.880 B** |
| O "lock" do artefato no hawkBit NÃO bloqueia a correção | `DELETE /api/admin/firmware/:id` trata 409/423 do hawkBit como `hawkbitKept=true` — remove a row do catálogo e deixa o binário como histórico de auditoria (comportamento desejado) |
| Deletar a 4.0.4 servida exige `?realignFloor=true` se ela for a única portadora do counter 3 | `delete.ts: assertCounterFloorPreserved` → `realignFloorToOlderRelease` transfere o piso p/ release mais antiga |
| Publish da 4.0.6 passaria no gate HOJE | checks: tar-integrity (re-download OK), manifest-v2-version (0x04000600 == "4.0.6"), counter-monotonic (6 > 3, publishedOnly excl. self), fleet-version-floor (4.0.6 > piso frota 4.0.4) — `publication-gate.ts` |

**Discriminador A vs B (uma query)**: row `4.0.6` existe?
- **A (draft 4.0.6 existe)** → conserto 100% processual: piloto + publish. Sem re-upload.
- **B (não existe)** → o upload da 4.0.6 falhou/nunca foi feito → re-upload do tar de fábrica (único índice `(artifact_type, version)` pode exigir delete de row antiga antes).

## 1. Acesso

- SSH da estação local está **filtrado** (SG permite só IPs conhecidos; IP atual
  `179.63.84.75` fora). RDS é IP privado (`172.31.96.15`) — só via EC2.
- Caminhos: **(i)** liberar SSH p/ o IP atual no SG da EC2 → agente executa tudo;
  **(ii)** operador executa na EC2 (comandos abaixo); **(iii)** via API pública com
  token super admin (`admin@ninbus.com.br` — `SUPER_ADMIN_EMAILS` do prod).
- EC2: `ec2-54-92-129-240.compute-1.amazonaws.com` (user `ec2-user`,
  key `NINBUS_API.pem`); repo em `~/Ninbus-api`; API responde em
  `http://localhost:8081` na própria EC2.

## 2. Passo 1 — Evidência (read-only, na EC2)

```bash
cd ~/Ninbus-api && bash tmp/ec2-incident673-diag.sh 2>&1 | tee diag-$(date +%m%d-%H%M).log
```

Ler o resultado:
- Query 1 define **A vs B** (presença/ausência da row 4.0.6 + `original_filename`).
- Query 3: snapshot das 673/674 com `phase:'error'` (rejeição correta do bootloader).
- Query 6: actions com `active=1` → lista p/ cancelamento no passo 3.

## 3. Passo 2A — Caminho A: draft 4.0.6 existe (hipótese quase certa)

Token (na EC2 ou em qualquer lugar com acesso à API):

```bash
TOKEN=$(curl -s -X POST https://api.ninbus.frt.com.br/api/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ninbus.com.br","password":"<SENHA>"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)
```

1. **Freio de emergência** — tira a espúria do funil mobile NA HORA (deployments em curso continuam):
   ```bash
   curl -s -X POST https://api.ninbus.frt.com.br/api/admin/firmware/<ID-4.0.4>/unpublish \
     -H "Authorization: Bearer $TOKEN"
   ```
2. **Cancelar actions abertas** da 4.0.4 (só as `active=1` da query 6; two-step force):
   ```bash
   curl -s -u "admin:${HAWKBIT_ADMIN_PASSWORD}" -X DELETE \
     http://hawkbit:8080/rest/v1/deploymentactions/<actionId>            # step 1
   curl -s -u "admin:${HAWKBIT_ADMIN_PASSWORD}" -X DELETE \
     "http://hawkbit:8080/rest/v1/deploymentactions/<actionId>?force=true" # step 2 (se 409)
   ```
3. **Piloto com `releaseId` explícito** (canal que o código fornece; gate 'pilot' estrutural):
   via dashboard (**Firmware → Testar/Force → selecionar release 4.0.6 draft**) ou:
   ```bash
   curl -s -X POST https://api.ninbus.frt.com.br/api/admin/firmware/deploy \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"deviceIds":["<deviceId-bancada>"],"releaseId":"<ID-4.0.6>"}'
   ```
   Esperado na bancada: boot aceita (counter 6 > piso queimado 3; 4.0.6 > 4.0.4).
4. **Publish** (gate completo roda: re-download, sha, v2==4.0.6, counter 6>3, fleet floor):
   ```bash
   curl -s -X POST https://api.ninbus.frt.com.br/api/admin/firmware/<ID-4.0.6>/publish \
     -H "Authorization: Bearer $TOKEN"
   ```
5. **Higiene (opcional, depois do publish)** — remover a espúria do catálogo; binário fica no hawkBit (lock esperado, auditoria):
   ```bash
   curl -s -X DELETE "https://api.ninbus.frt.com.br/api/admin/firmware/<ID-4.0.4>?realignFloor=true" \
     -H "Authorization: Bearer $TOKEN"
   ```
   `?realignFloor=true` só é preciso se a 4.0.4 for a única portadora do counter 3 (409 `COUNTER_FLOOR_BURNED`).

## 4. Passo 2B — Caminho B: 4.0.6 não existe no catálogo

1. Idem 2A-1 (unpublish) e 2A-2 (cancel).
2. Se existir row 4.0.6 órfã/corrompida (ex.: upload falhou depois do INSERT), deletar antes
   (nunca foi servida → sem guard de piso; DUPLICATE_VERSION do índice único exige isso):
   ```bash
   curl -s -X DELETE https://api.ninbus.frt.com.br/api/admin/firmware/<ID-4.0.6-row-velha> \
     -H "Authorization: Bearer $TOKEN"
   ```
3. Upload do **tar canônico de fábrica** (repo `Ninbus-v4`, assinado com
   `ota_sign.py --version 4.0.6`, counter 6, `ota_pack.py`) via dashboard ou:
   ```bash
   curl -s -X POST https://api.ninbus.frt.com.br/api/admin/firmware \
     -H "Authorization: Bearer $TOKEN" \
     -F file=@update-app.tar -F version=4.0.6 -F name='4.0.6 — release oficial' \
     -F artifactType=firmware-ninbus
   ```
4. Piloto + publish (idem 2A-3/2A-4).

## 5. Fallback via banco (SOMENTE se a API estiver inoperante)

Mutação mínima equivalente ao unpublish (não precisa tocar hawkBit):

```sql
-- na EC2, banco ninbus_api_db (RDS)
UPDATE firmware_releases SET status='draft', updated_at=now()
 WHERE artifact_type='firmware-ninbus' AND version='4.0.4' AND status='published'
 RETURNING id, version;
```

**NUNCA** flipar `status='published'` da 4.0.6 por SQL direto — o publish exige o
veredito do gate (`runPublicationGate`) persistido em `gate`/`gate_at`. Sem a API,
não existe caminho seguro de publish.

## 6. Verificação final

- Serial esperado na bancada: `counter=6 aceito=3 · versao=04000600 · tamanho=0001c8f8`.
- Probe DDI independente (token key-test do embarcado): tar **122.880 B**, manifesto
  v2 counter=6 version=4.0.6 flags=0, imagem 116.984 B.
- Dashboard: status mobile passa a oferecer **4.0.6** (`update_available`).
- `GET /api/admin/firmware/latest` → 4.0.6 published.

## 7. Hardening sistêmico (pendências do consenso)

1. **`FIRMWARE_ALLOW_BIN_SIGN=false` em produção** — AINDA NÃO IMPLEMENTADO (grep:
   zero refs em `src/`/`env.ts`). Implementar: flag em `env.ts` + guard no início do
   caminho `.bin` de `upload.ts`; default `false` em prod. Enquanto isso, manter
   `FIRMWARE_SIGNING_KEY` VAZIA no `.env` da EC2 já mata o server-sign na prática —
   conferir: `docker exec ninbus-api printenv FIRMWARE_SIGNING_KEY`.
2. Struct de versão em offset fixo na imagem (embarcado) — fecha o gap de procedência.
3. Surfar `imageSize`/sha256 no console + resposta do deploy.
4. Regras de monitoramento: `REJECTED_ARTIFACT`, `draftWarning` e `PILOT:` merecem
   alerta, não só log.

## 8. Latentes registradas (sem ação agora)

- TOCTOU do counter no server-sign (dois .bin concorrentes → mesmo floor+1).
- Guard anti-re-offer olha só a última deployment (escape por deployment intermediária).
- `resolveDraftWarning` é warning — não compete com botão "atualizar".
- Fingerprint de proveniência: `package_size % 10240 == 0` ⇒ tar de fábrica.
