# 📋 Plano de Otimização: Download hawkBit → Embarcado (NFX)

> **Data:** 2026-05-27
> **Arquivo analisado:** `00_test_nfx_vini_no_optimized.txt`
> **Dispositivo:** ESP32 @ COM3, WiFi local, hawkBit `192.168.1.112:8080`
> **Firmware type:** NFX (gzip compactado, `.tar` wrapper)

---

## 1. DIAGNÓSTICO — Timeline Completa do Log

| Fase | Início | Fim | Duração | % do Total |
|------|--------|-----|---------|------------|
| **Boot + WiFi connect** | 13:35:02 | 13:35:06 | 4s | 0.3% |
| **Poll hawkBit** | 13:35:06 | 13:35:43 | 37s | 2.7% |
| **Get deployment detail** | 13:35:43 | 13:36:16 | 33s | 2.4% |
| **🔴 DOWNLOAD artifact** | 13:36:16 | 13:43:41 | **7min 25s** | **53.6%** |
| **Feedback "downloaded"** | 13:43:42 | 13:44:14 | 32s | 3.8% |
| **Process + install staging** | 13:44:14 | 13:45:52 | 98s | 11.8% |
| **Reboot + re-connect** | 13:45:52 | 13:50:39 | ~5min | — |
| **🟡 CAN TX → Controller** | 13:46:15 | 13:50:19 | **4min 4s** | 29.4% |
| **TOTAL (download → install)** | — | — | **~13min** | 100% |

### Métricas-Chave do Download

| Métrica | Valor | Problema? |
|---------|-------|-----------|
| Tamanho do artifact | 1,061,376 bytes (~1MB) | — |
| Tempo total de download | 446 segundos | 🔴 **CRÍTICO** |
| Throughput efetivo | **2 KB/s** | 🔴 **CRÍTICO** — WiFi deveria dar 500+ KB/s |
| Chunk size | 2,048 bytes (2KB) | 🔴 Muito pequeno |
| Batch size | 4 chunks (8KB) | 🔴 Limitado pela heap |
| **Free heap** | **7,320 bytes** | 🔴 **GARGALO PRINCIPAL** — só 7KB livre |
| Stack HWM | 414 words (livre) | 🟡 Apertado mas ok |
| Tempo por batch (8KB) | ~3.4-3.5 segundos | 🔴 Deveria ser <100ms |
| Feedback POST latência | 22-32 segundos | 🔴 **CRÍTICO** — hawkBit + Neon DB |
| Polling interval | 5 minutos | 🟡 Padrão hawkBit |

### Diagrama do Fluxo Atual

```
[ESP32]                    [hawkBit :8080]              [Neon PostgreSQL]
   │                            │                            │
   │── GET /controller/v1/ ────>│──── SELECT target ────────>│
   │<── 200 + sleep=5min ──────│<───────────────────────────│
   │                            │                            │
   │── GET deploymentBase ─────>│──── SELECT deployment ────>│
   │<── 200 + artifact URL ────│<───────────────────────────│
   │                            │                            │
   │── GET /artifacts/X.tar ───>│── read disk/S3 (1MB) ─────>│
   │<── chunk 2KB ─────────────│<──── 2KB por vez ──────────│
   │   (repetir 518x)          │                            │
   │                            │                            │
   │── POST feedback ──────────>│──── UPDATE status ────────>│ (sa-east-1 cloud!)
   │<── 200 (32s depois) ──────│<───────────────────────────│
```

---

## 2. GARGALOS IDENTIFICADOS (em ordem de impacto)

### 🔴 G1. Heap do ESP32 insuficiente (CAUSA RAIZ do download lento)
**Impacto:** ~95% da lentidão do download

O ESP32 tem apenas **7,320 bytes** de heap livre durante o download. Isso força:
- Chunk size máximo de 2KB
- Batch de apenas 4 chunks (8KB)
- Alocação/dealocação constante

Com heap suficiente para buffer de 16-32KB, o throughput saltaria de 2 KB/s para potencialmente **50-100+ KB/s**.

### 🔴 G2. Feedback POST com latência de 22-32s (Cloud DB)
**Impacto:** Adiciona ~2 min ao processo total

hawkBit grava cada feedback no banco (Neon PostgreSQL em `sa-east-1`). Cada UPDATE = round trip para a cloud.
- `proceeding` → 200 (ok, ~1s)
- `downloaded` → 200 (32s!)
- `installing` → 200 (32s!)
- `NFX staged` → 200 (20s)

### 🔴 G3. hawkBit serve artifacts sem otimização
**Impacto:** Contribui para o throughput baixo

O hawkBit (Java/Spring) serve o artifact com:
- Sem compressão gzip (o `.tar` já contém gzip, mas o servidor não ajuda)
- Sem HTTP Range requests otimizados para embedded
- Sem caching headers
- Limitado a 1 CPU e 768MB heap

### 🟡 G4. Polling interval de 5 minutos
**Impacto:** Atraso de até 5 min para detectar novo deployment

### 🟡 G5. Latência de init hawkBit (16s)
**Impacto:** Boot lento

`[13:50:39] hawkbit setup start` → `[13:50:56] ok` = 16s para inicializar o client hawkBit.

---

## 3. PLANO DE AÇÃO — Otimizações Possíveis

### Dividido em 3 camadas: Firmware / Servidor / Infraestrutura

---

### 📌 AÇÃO 1: Otimizar heap do ESP32 (FIRMWARE) ⭐ PRIORIDADE MÁXIMA
**Responsável:** Time de Firmware
**Ganho estimado:** Download de 7min → **1-2 min** (5-7x mais rápido)

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 1a. **Aumentar buffer de download** | Reduzir stack de outras tasks ou usar PSRAM (se disponível) para alocar buffer de 16-32KB | Média |
| 1b. **Chunk size 4KB ou 8KB** | Com mais heap, usar chunks maiores. HTTP client ESP32 suporta. | Fácil |
| 1c. **Batch size 8-16 chunks** | Reduzir número de rounds de write → flash. Cada batch de 64KB em vez de 8KB. | Fácil |
| 1d. **HTTP Read timeout otimizado** | Aumentar `read_timeout` para não abortar prematuramente com chunks maiores | Fácil |
| 1e. **Desabilitar logs durante download** | `printf` a cada batch consome tempo. Usar flag para silenciar durante DL crítico | Fácil |

**Cálculo de ganho com buffer de 32KB:**
- 1MB / 32KB = 32 batches
- Se cada batch leva ~200ms (realista com WiFi local + buffer maior) = 6.4 segundos
- Ou seja: **7min 25s → ~10 segundos** (teórico, se o servidor acompanhar)

---

### 📌 AÇÃO 2: Proxy de Artifact no Ninbus API (SERVIDOR) ⭐ ALTA PRIORIDADE
**Responsável:** Time Backend
**Ganho estimado:** 2-3x mais rápido, + controle sobre cache/compressão

Criar endpoint de proxy/cache no Ninbus API que serve o artifact com otimizações:

```
GET /api/artifacts/download/:artifactId?token=<ddi-token>
```

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 2a. **Proxy com cache em disco** | Baixar do hawkBit/S3 uma vez, cachear no filesystem do container | Média |
| 2b. **Support HTTP Range requests** | Permitir que o ESP32 faça resume e paralelize downloads | Média |
| 2c. **Response headers otimizados** | `Content-Length`, `Accept-Ranges: bytes`, `ETag`, `Cache-Control` | Fácil |
| 2d. **Compressão transparente** | Se o artifact `.tar` não estiver gzipado, gzipar on-the-fly | Fácil |
| 2e. **Direto do S3 (se habilitado)** | Bypassar hawkBit, servir URL assinada do S3/MinIO diretamente | Média |

**Vantagem:** O Ninbus API (Bun) é muito mais rápido para servir arquivos estáticos que o hawkBit (Java/Spring).

---

### 📌 AÇÃO 3: Migrar hawkBit DB para PostgreSQL local (INFRA) ⭐ ALTA PRIORIDADE
**Responsável:** Time DevOps/Backend
**Ganho estimado:** Feedback de 32s → **<1s**, polling 2x mais rápido

O banco Neon (cloud `sa-east-1`) adiciona 50-200ms de latência por query. hawkBit faz múltiplas queries por poll e por feedback.

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 3a. **PostgreSQL local no Docker** | Adicionar serviço `db-hawkbit` no docker-compose.yml com volume persistente | Fácil |
| 3b. **Migrar dados existentes** | pg_dump do Neon → restore local | Média |
| 3c. **Manter Neon como backup** | Configurar replica ou dump periódico para disaster recovery | Média |

**Cálculo de impacto:**
- Cada feedback POST: 32s → ~0.5s (economia de ~30s × 4 feedbacks = **2 min**)
- Cada poll: 37s → ~5s (economia de ~32s)
- Get detail: 33s → ~3s (economia de ~30s)

---

### 📌 AÇÃO 4: hawkBit JVM Tuning (INFRA)
**Responsável:** Time DevOps
**Ganho estimado:** 10-20% mais rápido em artifact serving

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 4a. **Aumentar heap para 1GB** | `HAWKBIT_XMX=1024m` | Fácil |
| 4b. **Aumentar CPUs para 2** | `HAWKBIT_CPUS=2.0` | Fácil |
| 4c. **G1GC tuning** | Adicionar `-XX:MaxGCPauseMillis=100` | Fácil |
| 4d. **Connection pool** | `SPRING_DATASOURCE_HIKARI_MAXIMUM_POOL_SIZE=20` | Fácil |

---

### 📌 AÇÃO 5: Reduzir polling interval (SERVIDOR + FIRMWARE)
**Responsável:** Backend + Firmware
**Ganho estimado:** Detecção de update 5x mais rápida

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 5a. **Polling de 1 min** | Device responde `_sleep=00:01:00` ao invés de 5 min | Fácil (firmware) |
| 5b. **Configurável via hawkBit** | hawkBit suporta configurar polling por target via attribute `polling_sleep` | Fácil |
| 5c. **Polling adaptativo** | Fazer poll mais frequente quando em `pending` state | Média |

---

### 📌 AÇÃO 6: Pre-sign S3 URLs para download direto (SERVIDOR)
**Responsável:** Time Backend
**Ganho estimado:** Elimina hawkBit do path de download

Se o S3/MinIO estiver habilitado, gerar URL assinada e retornar ao device:

```
http://minio:9000/ninbus-artifacts/artifact-7.tar?X-Amz-Signature=...
```

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 6a. **Presigned URL no deploymentBase** | Customizar response do DDI para apontar direto ao S3 | Alta |
| 6b. **MinIO na mesma rede do device** | Device acessa MinIO diretamente, bypassando hawkBit | Média |

---

### 📌 AÇÃO 7: Otimizar CAN TX para Controller (FIRMWARE)
**Responsável:** Time de Firmware
**Ganho estimado:** CAN TX de 4min → **1-2 min**

| Sub-ação | Descrição | Dificuldade |
|----------|-----------|-------------|
| 7a. **Aumentar baud rate CAN** | Se o hardware suportar, subir de 500k para 1M baud | Média |
| 7b. **Pipelining CAN** | Enviar próximo chunk antes do ACK do anterior (window=2-4) | Alta |
| 7c. **Batch maior no CAN** | Enviar múltiplos frames sem esperar ACK entre eles | Média |

**Throughput atual CAN:**
- 2048 bytes a cada ~280ms = 7.3 KB/s
- Para 1MB = ~137 segundos = 2min 17s
- Com pipelining (window=4): potencialmente ~35s

---

## 4. RESUMO — Impacto e Priorização

| # | Ação | Responsável | Ganho | Esforço | Prioridade |
|---|------|-------------|-------|---------|------------|
| 1 | **Heap ESP32 + buffer maior** | Firmware | **5-7x download** | Médio | 🔴 P0 |
| 2 | **Proxy artifact no Ninbus API** | Backend | **2-3x download** | Médio | 🔴 P0 |
| 3 | **DB hawkBit local** | DevOps | **-2 min feedback** | Fácil | 🔴 P0 |
| 4 | **JVM tuning hawkBit** | DevOps | 10-20% serving | Fácil | 🟡 P1 |
| 5 | **Polling 1 min** | Firmware | Detecção 5x mais rápida | Fácil | 🟡 P1 |
| 6 | **Presigned S3 URLs** | Backend | Elimina hop | Médio | 🟢 P2 |
| 7 | **CAN TX otimização** | Firmware | **2-3x CAN** | Médio | 🟢 P2 |

### Projeção com ações 1+2+3 implementadas:

| Fase | Antes | Depois | Economia |
|------|-------|--------|----------|
| Poll + detail | 70s | ~8s | -62s |
| **Download 1MB** | **7min 25s** | **~30-60s** | **~6 min** |
| Feedback (4x) | ~2 min | ~2s | ~2 min |
| CAN TX | 4 min | 4 min | 0 (ação 7) |
| **TOTAL** | **~13 min** | **~5-6 min** | **~7-8 min** |

---

## 5. AÇÕES IMEDIATAS (o que o Backend pode fazer AGORA)

### Ações que NÃO dependem de firmware:

1. **Adicionar PostgreSQL local no docker-compose** (ação 3) — 1h de trabalho
2. **Tuning hawkBit** (ação 4) — 15 min, só mudar env vars
3. **Criar proxy de artifact com cache** (ação 2) — 2-3 dias

### Ações que o Firmware pode fazer:

1. **Aumentar buffer/chunk** (ação 1) — investigar PSRAM ou reduzir stack de outras tasks
2. **Polling de 1 min** (ação 5a) — mudar 1 linha no firmware
3. **Silenciar logs em DL** (ação 1e) — flag condicional

---

## 6. NOTAS TÉCNICAS

### Por que o download está tão lento (2 KB/s)?

O gargalo **NÃO é a rede WiFi** (que deveria dar 500+ KB/s). É a combinação:

1. **Buffer minúsculo (2KB)** — o ESP32 só consegue receber 2KB por vez do socket TCP
2. **Heap esgotado (7KB)** — não há espaço para aumentar o buffer sem mudanças no firmware
3. **Write síncrono entre receive e flash** — a cada 4 chunks (8KB), faz write na flash e espera completar
4. **hawkBit Java overhead** — Spring MVC serve o arquivo com buffering interno Java, adiciona latência

### Por que o feedback POST demora 30s?

```
ESP32 → hawkBit:8080 → UPDATE sp_action_status → Neon PostgreSQL (sa-east-1)
                                         ↑ Round trip para AWS = 50-200ms por query
                                         ↑ hawkBit faz 3-5 queries por feedback
                                         ↑ Total: 300-1000ms de SQL + Java overhead
                                         ↑ MAS o log mostra 22-32s!
```

A latência de 30s sugere que hawkBit está **esperando lock** no banco ou **fazendo polling interno**. Com DB local, isso cai para <1s.

### Diagrama da Arquitetura Otimizada (Proposta):

```
[ESP32]              [Ninbus API :8081]        [hawkBit :8080]     [PG Local]
   │                        │                        │                 │
   │── poll ───────────────>│── proxy poll ─────────>│── SELECT ──────>│
   │<── deploymentBase ────│<─── com cache ─────────│<────────────────│
   │                        │                        │                 │
   │── GET /api/artifacts/─>│── cache hit ───────────│                 │
   │<── chunk 8-16KB ──────│<── (serve direto) ────│                 │
   │   (80-100 KB/s)       │                        │                 │
   │                        │                        │                 │
   │── POST feedback ──────>│── proxy feedback ─────>│── UPDATE ──────>│
   │<── 200 (<1s) ─────────│<───────────────────────│<────────────────│
```

---

## 7. PRÓXIMOS PASSOS

1. **Reunião com time de Firmware** para discutir ação 1 (heap/chunk)
2. **Implementar ação 3** (DB local) — ganho imediato em feedback
3. **Implementar ação 4** (JVM tuning) — só env vars
4. **Planejar ação 2** (proxy artifact) — sprint seguinte
5. **Teste comparativo** após cada ação para medir ganho real
