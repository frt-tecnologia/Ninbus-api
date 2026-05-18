# Plano de Ação: hawkBit DMF via RabbitMQ — Substituir Polling por Event-Driven

> **Status**: PROPOSTA (aguardando aprovação)  
> **Data**: 2026-05-17  
> **Autor**: pi (assistente de código)

---

## 1. EXECUTIVO

### Problema Atual
O backend Ninbus sincroniza com hawkBit via **polling HTTP** (`sync.ts` + `sync-helpers.ts` = 574 linhas). A cada 30s, faz N requisições REST ao hawkBit para detectar mudanças em targets. Isso gera:

- **Latência de até 30s** entre um evento no hawkBit e sua refletância no backend
- **Custo computacional constante** — mesmo sem mudanças, o backend faz queries
- **Escalabilidade limitada** — 50k devices = centenas de chamadas REST/ciclo

### Proposta
Substituir o polling por **hawkBit DMF (Device Management Federation)** via RabbitMQ. O hawkBit já possui suporte nativo a AMQP/RabbitMQ — quando um deployment é criado, um target é registrado, ou uma action muda de status, o hawkBit publica eventos automaticamente no exchange `dmf.exchange`. O backend consome esses eventos em tempo real.

---

## 2. COMO O hawkBit DMF FUNCIONA (estudo do código-fonte)

### 2.1 Arquitetura DMF

```
┌──────────┐    AMQP     ┌────────────┐    REST     ┌──────────┐
│ Ninbus   │◄────────────│  RabbitMQ  │◄────────────│ hawkBit  │
│ Backend  │             │            │             │ Server   │
│ (consumer│  dmf.exchange│           │  publica    │          │
│  dmf_    │◄────────────│            │  eventos    │          │
│  receiver│             │            │             │          │
└──────────┘             └────────────┘             └──────────┘
```

**Fluxo**:
1. hawkBit detecta evento (target registrou, action mudou status, DS assignado)
2. `AmqpMessageDispatcherService` publica mensagem no exchange `dmf.exchange` (fanout)
3. A mensagem cai na queue `dmf_receiver` (bindada ao exchange)
4. O backend consome de `dmf_receiver` e atualiza o DB local

### 2.2 Mensagens DMF que o hawkBit ENVIA (outbound — dispatcher)

O hawkBit envia mensagens quando eventos internos acontecem:

| Evento hawkBit | Topic Header | Body | Quando |
|---|---|---|---|
| Assignar DS a target | `DOWNLOAD_AND_INSTALL` | `DmfDownloadAndUpdateRequest` | Deployment criado |
| Cancelar download | `CANCEL_DOWNLOAD` | `DmfActionRequest` | Action cancelada |
| Pedir update attributes | `REQUEST_ATTRIBUTES_UPDATE` | vazio | Admin solicita attrs |
| Deletar target | `THING_DELETED` | vazio | Target deletado |

**⚠️ IMPORTANTE**: Essas mensagens são enviadas pelo hawkBit para um **DMF connector** (serviço externo que fala AMQP com devices). O Ninbus backend NÃO é o destinatário natural dessas mensagens — elas são para conectores de dispositivos.

### 2.3 Mensagens DMF que o hawkBit RECEBE (inbound — handler)

O hawkBit processa mensagens que chegam na queue `dmf_receiver`:

| Tipo | Header `type` | Ação |
|---|---|---|
| `THING_CREATED` | Registra target + responde com update command |
| `THING_REMOVED` | Deleta target |
| `EVENT` / `UPDATE_ACTION_STATUS` | Atualiza status de uma action |
| `EVENT` / `UPDATE_ATTRIBUTES` | Atualiza atributos do target |
| `PING` | Health check |

**⚠️ ISSO É INBOUND** — o backend manda essas mensagens PARA o hawkBit (como um proxy de device), não o contrário.

### 2.4 O Problema Real

O DMF do hawkBit foi desenhado para **device connectors** (gateways que intermediam a comunicação com dispositivos físicos). O fluxo é:

```
Device ←→ DMF Connector ←→ RabbitMQ ←→ hawkBit
```

O Ninbus backend não é um device connector — ele é um **consumidor de eventos de management**. O DMF não publica eventos de "target atualizou status" ou "deployment criado via Management API" para consumidores arbitrários.

---

## 3. ANÁLISE DE ALTERNATIVAS

### 3.1 Opção A: DMF AMQP Completo (o que foi pedido)

**Como funcionaria**:
- Adicionar RabbitMQ ao stack (container ou Amazon MQ)
- Habilitar `hawkbit.dmf.enabled=true` no hawkBit
- Backend implementa um "DMF connector" que:
  - Publica `THING_CREATED` quando provisiona um device
  - Recebe `DOWNLOAD_AND_INSTALL` quando hawkBit quer fazer deploy
  - Publica `UPDATE_ACTION_STATUS` quando o device reporta status

**Problemas**:
- ❌ O DMF é para **device connectors**, não para backend sync
- ❌ O backend teria que agir COMO SE FOSSE um device — enviando THING_CREATED, respondendo com UPDATE_ACTION_STATUS
- ❌ Não resolve o caso principal: "backend precisa saber que hawkBit registrou um novo target via DDI"
- ❌ HawkBit NÃO publica eventos de "novo target registrou via DDI" no DMF — isso só acontece via THING_CREATED do connector
- ❌ Adiciona RabbitMQ como dependência de infraestrutura (+$15-40/mês na AWS)
- ❌ Complexidade altíssima para o ganho

**Veredito**: ❌ **NÃO RECOMENDADO** — é o caso de uso errado para DMF.

### 3.2 Opção B: Polling Otimizado (ATUAL + melhorias)

**O que já temos** (`hybrid` mode):
- Apenas empresas com sessões ativas são sincronizadas
- Incremental sync via `lastModifiedAt` timestamp
- Stale-while-revalidate para device individual

**Melhorias possíveis**:
- Reduzir intervalo para 10s (trade-off custo/latência)
- Webhook reverso: hawkBit → backend (não suportado nativamente)
- Long-polling (hawkBit suporta `Last-Modified` header)

**Custo**: $0 adicional

**Veredito**: ✅ **ACEITÁVEL** mas não resolve a latência fundamental.

### 3.3 Opção C: hawkBit Repository Events via Spring AMQP (HYBRID)

**O que é**: O hawkBit tem um sistema interno de eventos (`TargetAssignDistributionSetEvent`, `TargetDeletedEvent`, etc.) que são publicados via Spring `ApplicationEvent`. Quando `hawkbit.events.remote.enabled=true` e RabbitMQ está configurado, esses eventos são publicados no exchange do Spring Cloud Bus.

**Como funcionaria**:
1. Habilitar `spring.autoconfigure.exclude=` (remover a exclusão do RabbitAutoConfiguration)
2. Habilitar `hawkbit.events.remote.enabled=true`
3. Adicionar RabbitMQ ao stack
4. Backend consome eventos Spring do hawkBit (não DMF, mas **repository events**)

**Eventos disponíveis**:
- `TargetAssignDistributionSetEvent` — DS assignado a target
- `CancelTargetAssignmentEvent` — Assignment cancelado
- `TargetDeletedEvent` — Target deletado
- `TargetAttributesRequestedEvent` — Atributos solicitados
- `TargetPollEvent` — **Target fez poll DDI** (quando `publish-target-poll-event=true`)

**⚠️ PROBLEMA**: Esses eventos usam Spring Cloud Stream / Spring AMQP interno. O formato é serialização Java (não JSON amigável). Consumir de fora do ecossistema Spring requer entendimento do formato de serialização.

### 3.4 Opção D: DMF como "Connector Virtual" + Event Bridge (RECOMENDADO)

**A melhor abordagem para o Ninbus**:

Em vez de usar DMF ou Spring Events, criar um **mecanismo de webhook leve** usando o que hawkBit já suporta:

1. **Manter o polling como fallback** (garantia de consistência eventual)
2. **Adicionar SSE (Server-Sent Events)** no backend Ninbus para o Flutter
3. **Reduzir o intervalo de polling para 10s** no modo hybrid
4. **Adicionar on-demand sync granular**: quando o Flutter pede status de um device, o backend faz uma query REST instantânea ao hawkBit (1 device, não todos)

**Custo**: $0 adicional. Reduz latência percebida pelo usuário de 30s para <1s.

### 3.5 Opção E: DMF com Backend como Connector (ALTERNATIVA VIÁVEL)

Se o objetivo é **eliminação total do polling**, é possível usar o DMF de forma criativa:

1. Habilitar DMF no hawkBit + RabbitMQ
2. Backend registra-se como "DMF connector" para todos os targets
3. Quando hawkBit quer fazer deploy, envia `DOWNLOAD_AND_INSTALL` para o backend via AMQP
4. Backend atualiza o status do device no DB instantaneamente
5. Backend mantém polling leve (5min) apenas como reconciliação

**Isso requer**:
- RabbitMQ (~$15/mês Amazon MQ t3.micro ou $0 com container)
- Backend fala AMQP (biblioteca `amqplib` para Bun)
- Aproximadamente 200-250 linhas de código novo
- Remoção de ~400 linhas do sync engine atual

---

## 4. COMPARATIVO DETALHADO

| Métrica | Atual (Hybrid Polling) | Opção D (Polling Otimizado) | Opção E (DMF + Polling Leve) |
|---|---|---|---|
| **Latência p95** | 30s | 10s | <1s (eventos) / 5min (reconciliação) |
| **Latência percebida Flutter** | 30s | <1s (SSE) | <1s (SSE) |
| **Chamadas hawkBit/dia** (100 users, 1k devices) | ~28.800 | ~8.640 | ~288 (reconciliação) + eventos |
| **Infra adicional** | $0 | $0 | $15-40/mês (RabbitMQ) |
| **Complexidade código** | 574 linhas (sync) | 574 linhas (sync) | ~250 linhas (DMF) + 200 linhas (reconciliação) |
| **Ponto de falha** | hawkBit down = sync para | hawkBit down = sync para | RabbitMQ down = volta a polling |
| **Setup AWS** | Neon + hawkBit + MinIO | Neon + hawkBit + MinIO | Neon + hawkBit + MinIO + Amazon MQ |

---

## 5. ANÁLISE DE CUSTO AWS (região sa-east-1, 3 instâncias)

### 5.1 Cenário Atual (sem RabbitMQ)

| Serviço | Config | Custo/mês |
|---|---|---|
| Neon DB (Ninbus) | Free tier / Launch 0.5 CU | $0-19 |
| Neon DB (hawkBit) | Free tier / Launch 0.5 CU | $0-19 |
| ECS/Fargate API | 0.5 vCPU, 512MB | ~$15 |
| ECS/Fargate hawkBit | 1 vCPU, 1GB | ~$30 |
| MinIO (R2/S3) | <1GB | ~$0.01 |
| **Total** | | **$45-83/mês** |

### 5.2 Cenário com RabbitMQ (Amazon MQ)

| Serviço | Config | Custo/mês |
|---|---|---|
| Tudo acima | | $45-83 |
| Amazon MQ (RabbitMQ) | t3.micro (1 vCPU, 1GB) | ~$15 |
| EBS (Amazon MQ) | 5GB gp3 | ~$0.50 |
| **Total** | | **$60-98/mês** |

### 5.3 Cenário com RabbitMQ (Container no ECS)

| Serviço | Config | Custo/mês |
|---|---|---|
| Tudo acima | | $45-83 |
| ECS/Fargate RabbitMQ | 0.25 vCPU, 512MB | ~$8 |
| **Total** | | **$53-91/mês** |

**Delta RabbitMQ**: +$8-15/mês (~7-18% de aumento)

---

## 6. RECOMENDAÇÃO FINAL

### Minha recomendação: **Opção D (Polling Otimizado + SSE)** agora, **Opção E (DMF)** quando escalar.

**Justificativa**:

1. **O DMF do hawkBit é para device connectors, não para backend sync.** Usar DMF para sincronizar o backend com o hawkBit é usar a ferramenta errada. O DMF pressupõe que o consumidor é um gateway que controla dispositivos físicos.

2. **O ganho real de latência é percebido pelo usuário Flutter**, não pelo backend. SSE resolve isso com $0 de custo adicional.

3. **A escala atual não justifica RabbitMQ.** Com 100-1000 devices, o polling hybrid a cada 10s é perfeitamente viável e gera <10k chamadas REST/dia.

4. **Quando atingir 10k+ devices**, a Opção E (DMF) se justifica. Aí sim o RabbitMQ compensa.

### Plano de implementação da Opção D (Polling Otimizado):

1. **Reducir `HAWKBIT_SYNC_INTERVAL_SEC` para 10s** (env var)
2. **Adicionar SSE endpoint** no Ninbus backend (`GET /api/events`):
   - Usar Elysia `stream()` para SSE
   - Publicar eventos de device update quando o sync detecta mudanças
   - Flutter assina o stream e atualiza UI instantaneamente
3. **On-demand sync para device individual** — já existe (`syncSingleDeviceSwr`) com cache de 60s
4. **Custo**: $0, ~100-150 linhas de código novo

### Quando migrar para a Opção E (DMF):

- **Trigger**: >5k devices OU latência de 10s inaceitável para o negócio
- **Investimento**: ~$15/mês adicional + 2-3 dias de desenvolvimento
- **Complexidade**: Moderada (AMQP consumer + integração com hawkBit DMF)

---

## 7. SE AINDA QUISER FAZER A OPÇÃO E (DMF), AQUI ESTÁ O PLANO

> ⚠️ Este plano é para referência futura. NÃO implementar sem aprovação.

### 7.1 Infraestrutura

```yaml
# docker-compose.yml — adicionar RabbitMQ
rabbitmq:
  image: rabbitmq:3-management-alpine
  container_name: rabbitmq
  ports:
    - "5672:5672"    # AMQP
    - "15672:15672"  # Management UI
  environment:
    RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-ninbus}
    RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-ninbus123}
  volumes:
    - rabbitmq-data:/var/lib/rabbitmq
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
    interval: 15s
    timeout: 10s
    retries: 5
```

### 7.2 hawkBit — Habilitar DMF

```yaml
# Variáveis de ambiente do hawkBit no docker-compose.yml:
# REMOVER: spring.autoconfigure.exclude (para habilitar RabbitAutoConfiguration)
# ADICIONAR:
hawkbit.dmf.enabled=true
hawkbit.events.remote.enabled=true
spring.rabbitmq.host=rabbitmq
spring.rabbitmq.username=${RABBITMQ_USER:-ninbus}
spring.rabbitmq.password=${RABBITMQ_PASS:-ninbus123}
```

**⚠️ PROBLEMA**: A imagem Docker `hawkbit/hawkbit-update-server:1.0.3` exclui `RabbitAutoConfiguration` em seu `application.properties`. Para habilitar RabbitMQ, precisamos SOBRESCREVER essa propriedade via env var ou mount de application.properties customizado.

### 7.3 Backend — AMQP Consumer

```
src/common/amqp/
  connection.ts    — Conexão RabbitMQ (amqplib), reconnect automático (~50 linhas)
  consumer.ts      — Consome dmf_receiver, dispatch handlers (~100 linhas)
  types.ts         — Tipos DMF (MessageType, EventTopic, headers) (~30 linhas)
```

### 7.4 Fluxo de Dados DMF

```
hawkBit (assigna DS ao target)
  → Publica DOWNLOAD_AND_INSTALL no dmf.exchange
  → RabbitMQ roteia para dmf_receiver
  → Backend consume dmf_receiver
  → Atualiza status do device no DB instantaneamente
  → Emite SSE para Flutter (se conectado)

Device (poll DDI)
  → hawkBit atualiza pollStatus/updateStatus
  → Backend detecta via reconciliação a cada 5min
```

### 7.5 Arquivos a Modificar

| Arquivo | Ação | Linhas Estimadas |
|---|---|---|
| `src/common/amqp/connection.ts` | **NOVO** | ~50 |
| `src/common/amqp/consumer.ts` | **NOVO** | ~100 |
| `src/common/amqp/types.ts` | **NOVO** | ~30 |
| `src/common/config/env.ts` | Adicionar vars AMQP | +15 |
| `src/common/config/hawkbit.ts` | Adicionar accessor AMQP config | +10 |
| `src/modules/devices/sync.ts` | Simplificar para reconciliação | -130 |
| `src/modules/devices/sync-helpers.ts` | Manter apenas batchUpdate + syncNew | -150 |
| `src/app.ts` | Iniciar AMQP consumer no startup | +5 |
| `docker-compose.yml` | Adicionar RabbitMQ service | +20 |
| `docker/hawkbit/Dockerfile` | Nenhuma mudança (env vars suficiente) | 0 |
| `.env.example` | Adicionar AMQP vars | +5 |
| `package.json` | Adicionar `amqplib` | +1 |

**Total**: ~180 linhas novas, ~280 linhas removidas, ~35 linhas alteradas. Delta líquido: **-100 linhas**.

### 7.6 Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| hawkBit não publica eventos esperados no dmf.exchange | Média | Testar com Docker antes de implementar |
| Serialização AMQP incompatível | Média | Usar Jackson JSON (padrão do hawkBit DMF) |
| RabbitMQ cai | Baixa | Fallback automático para polling |
| hawkBit Docker image hardcode exclude RabbitAutoConfig | Alta | Montar application.properties customizado |

---

## 8. RESUMO COMPARATIVO

```
┌─────────────────────────────────────────────────────────────────┐
│                    CENÁRIO ATUAL (Hybrid Polling)               │
├─────────────────────────────────────────────────────────────────┤
│ Latência:         30s (configurável)                            │
│ Custo AWS:        $45-83/mês                                    │
│ Complexidade:     574 linhas sync                              │
│ Dependabilidade:  hawkBit REST deve estar up                    │
│ Escala máxima:    ~5k devices                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              OPÇÃO D: Polling Otimizado + SSE (RECOMENDADO)     │
├─────────────────────────────────────────────────────────────────┤
│ Latência:         10s (backend) + <1s (percebida pelo Flutter)  │
│ Custo AWS:        $45-83/mês (= $0 adicional)                  │
│ Complexidade:     574 linhas sync + ~120 linhas SSE             │
│ Dependabilidade:  hawkBit REST deve estar up                    │
│ Escala máxima:    ~10k devices                                  │
│ Esforço:          ~1 dia                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              OPÇÃO E: DMF via RabbitMQ (FUTURO)                 │
├─────────────────────────────────────────────────────────────────┤
│ Latência:         <1s (eventos) + 5min (reconciliação)          │
│ Custo AWS:        $60-98/mês (+$15/mês)                        │
│ Complexidade:     ~180 linhas novas (AMQP consumer)             │
│ Dependabilidade:  hawkBit + RabbitMQ devem estar up             │
│ Escala máxima:    100k+ devices                                 │
│ Esforço:          ~2-3 dias                                     │
│ Trigger:          >5k devices OU requisito de latência <10s     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. DECISÃO NECESSÁRIA

1. **Opção D** (Polling otimizado + SSE, $0 extra, 1 dia)? → Recomendado para agora
2. **Opção E** (DMF + RabbitMQ, +$15/mês, 2-3 dias)? → Recomendado para >5k devices
3. **Manter como está** (30s polling)? → Aceitável para <1k devices

---

*Este documento NÃO altera nenhum código. Aguardando aprovação do plano.*
