# Plano Detalhado — Opção D: Polling Otimizado + SSE

> **Status**: PROPOSTA (aguardando aprovação)  
> **Esforço**: ~1 dia de trabalho  
> **Custo adicional**: $0/mês  
> **Sem alteração de infraestrutura**

---

## 1. VISÃO GERAL DA ARQUITETURA

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ANTES (atual)                               │
│                                                                     │
│  Flutter ──GET /devices──▶ API ──▶ DB local (stale até 30s)        │
│  Flutter ──GET /deployments──▶ API ──▶ hawkBit REST (cada request) │
│                                                                     │
│  Sync engine: background a cada 30s, hybrid mode                   │
│  Latência percebida: até 30s para mudanças de status de device     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         DEPOIS (Opção D)                            │
│                                                                     │
│  Flutter ──GET /devices──▶ API ──▶ DB local (stale até 10s)        │
│  Flutter ──GET /sse──▶ SSE stream ──▶ push instantâneo de eventos  │
│                                                                     │
│  Sync engine: background a cada 10s, hybrid mode                   │
│  SSE: push em tempo real quando sync detecta mudanças               │
│  Latência percebida: <1s (push via SSE)                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. O QUE MUDA E O QUE NÃO MUDA

### NÃO muda (endpoint REST normal, sem SSE):
- Todos os endpoints REST existentes continuam iguais
- GET /devices, POST /devices, PUT /:id, DELETE /:id — sem alteração
- GET /deployments, POST /deployments, GET /:id/statistics — sem alteração
- GET /artifacts, POST /artifacts, DELETE /artifacts — sem alteração
- Auth, companies, categories, provisioning — sem alteração

### MUDA (SSE adicionado):
- **1 endpoint novo**: `GET /api/companies/:companyId/sse` — stream de eventos em tempo real
- **1 módulo novo**: `src/common/sse/` — Event Emitter + gerenciamento de conexões
- **Sync engine**: intervalo cai de 30s → 10s (apenas config, sem mudança de código)
- **Sync engine**: emite eventos SSE quando detecta mudanças durante o sync
- **Sync engine**: emite eventos SSE quando sync individual detecta mudança

---

## 3. O ENDPOINT SSE — COMO FUNCIONA

### 3.1 Conexão (Flutter → API)

```
GET /api/companies/{companyId}/sse
Cookie: auth.session_token=abc123
Accept: text/event-stream
```

**Resposta** (stream contínuo):
```
event: connected
data: {"companyId":"uuid","timestamp":"2026-05-17T19:00:00Z"}

event: device.updated
data: {"deviceId":"uuid","changes":["connectionStatus","hawkbitUpdateStatus"]}

event: deployment.status
data: {"deploymentId":5,"statistics":{"pending":3,"success":7}}

event: heartbeat
data: {"timestamp":"2026-05-17T19:00:15Z"}

event: device.updated
data: {"deviceId":"uuid","changes":["connectionStatus"]}
```

### 3.2 Eventos que o SSE emite

| Evento | Quando | Payload |
|---|---|---|
| `connected` | Conexão estabelecida | `{ companyId, timestamp }` |
| `device.updated` | Sync detectou mudança em device | `{ deviceId, changes[] }` |
| `devices.batch` | Sync batch atualizou N devices | `{ count, companyScopes[] }` |
| `deployment.created` | Deployment criado via POST | `{ deploymentId, name }` |
| `heartbeat` | A cada 30s (keepalive) | `{ timestamp }` |

### 3.3 Flutter só recebe eventos da SUA empresa

O endpoint é `GET /api/companies/:companyId/sse`. O auth-guard valida:
1. Usuário autenticado (cookie de sessão)
2. Usuário é membro daquele companyId
3. Role mínimo: `viewer`

Se o usuário sair da empresa ou a sessão expirar, o stream é encerrado.

---

## 4. COMO O FLUTTER CONSUME

### 4.1 Conexão com EventSource (package `eventsource` ou dart nativo)

```dart
// Usando o package sse_client ou eventsource
import 'package:eventsource_client/eventsource_client.dart';

// Conecta ao SSE da empresa
final uri = Uri.parse('$apiBase/api/companies/$companyId/sse');
final client = EventSource(
  uri: uri,
  closeSelector: lifecycleClose, // fecha quando app vai pra background
  headers: { 'Cookie': sessionCookie },
);

// Escuta eventos
client.stream.listen((event) {
  switch (event.event) {
    case 'device.updated':
      final data = jsonDecode(event.data!);
      // Atualiza o device na lista local
      ref.read(devicesProvider.notifier).refreshDevice(
        data['deviceId'],
        changedFields: data['changes'],
      );
      break;

    case 'devices.batch':
      // Vários devices mudaram — faz refresh da lista inteira
      ref.read(devicesProvider.notifier).fetchAll();
      break;

    case 'deployment.status':
      final data = jsonDecode(event.data!);
      ref.read(deploymentProvider.notifier).updateStats(
        data['deploymentId'],
        data['statistics'],
      );
      break;

    case 'heartbeat':
      // Conexão viva — atualiza indicador visual
      break;
  }
});
```

### 4.2 Padrão no Flutter (Riverpod example)

```dart
@riverpod
class SseConnection extends _$SseConnection {
  EventSource? _client;

  @override
  Stream<SseEvent> build(String companyId) {
    final session = ref.read(authProvider).sessionToken;
    _client = EventSource(
      uri: Uri.parse('$apiBase/api/companies/$companyId/sse'),
      headers: { 'Cookie': 'auth.session_token=$session' },
    );

    ref.onDispose(() => _client?.close());

    return _client!.stream;
  }
}
```

### 4.3 Quando o Flutter NÃO tem SSE ativo (app em background)

O SSE é um **optimistic push**. Se o Flutter não está conectado:
- O app faz GET /devices normal ao voltar para foreground
- O sync background mantém o DB atualizado a cada 10s
- Zero perda de dados — SSE é apenas para UX (velocidade percebida)

---

## 5. ALTERAÇÕES NO BACKEND — ARQUIVO POR ARQUIVO

### 5.1 NOVO: `src/common/sse/emitter.ts` (~80 linhas)

**Função**: Event Emitter company-scoped. Gerencia conexões SSE ativas.

```
Responsabilidades:
- Map<companyId, Set<Response>> — track de conexões ativas por empresa
- emit(companyId, event, data) — envia evento para TODOS os clientes daquela empresa
- addConnection(companyId, response) — registra nova conexão
- removeConnection(companyId, response) — remove conexão (disconnect)
- cleanup() — remove conexões mortas a cada 60s
- heartbeat — envia heartbeat a cada 30s para cada conexão ativa
```

**Formato SSE** (especificação W3C):
```
event: device.updated\n
data: {"deviceId":"uuid","changes":["status"]}\n
\n
```

**Detalhe técnico**: O Bun suporta `ReadableStream` nativo. O Elysia expõe isso via `context.set.headers` + retorno de stream. O emitter guarda referências aos controllers dos streams.

### 5.2 NOVO: `src/common/sse/index.ts` (~10 linhas)

Barrel re-export. Exporta `sseEmitter` singleton e tipos.

### 5.3 NOVO: `src/modules/sse/index.ts` (~60 linhas)

**O endpoint SSE**:

```
GET /api/companies/:companyId/sse
- auth: true (sessão Better Auth via cookie)
- companyRole: 'viewer' (qualquer membro pode assinar)
- Retorna: text/event-stream (long-lived connection)
```

**Implementação**:
```typescript
// Pseudocódigo do handler
async ({ params, user, set }) => {
  // Validação: auth-guard já verificou sessão + membership

  // Cria ReadableStream com controller
  const stream = new ReadableStream({
    start(controller) {
      // Envia evento "connected"
      controller.enqueue(formatSSE('connected', { companyId, timestamp }));
      
      // Registra no emitter
      sseEmitter.addConnection(params.companyId, controller);
      
      // Cleanup quando cliente desconecta
      // (request.signal.aborted ou close)
    }
  });

  set.headers['Content-Type'] = 'text/event-stream';
  set.headers['Cache-Control'] = 'no-cache';
  set.headers['Connection'] = 'keep-alive';
  
  return stream;
}
```

**Detalhe CORS**: SSE usa GET com `Accept: text/event-stream`. O CORS do Elysia já suporta isso (credentialed=true). O cookie de sessão é enviado automaticamente pelo navegador.

### 5.4 ALTERAR: `src/modules/devices/sync.ts` (~15 linhas adicionadas)

**Onde emite eventos SSE**: dentro de `syncHybrid()` e `syncPeriodic()`, após `batchUpdateDevicesFromTargets()`.

```
Depois de batchUpdate:
  if (updatedCount > 0) {
    // Para cada empresa que teve devices atualizados
    for (const companyId of updatedCompanyIds) {
      sseEmitter.emit(companyId, 'devices.batch', { count: updatedCount });
    }
  }
```

**Como saber o companyId**: O `batchUpdateDevicesFromTargets` precisa retornar companyId junto com o count. Atualmente retorna só `number`. Mudança: retorna `Map<companyId, count>`.

### 5.5 ALTERAR: `src/modules/devices/sync-helpers.ts` (~20 linhas)

**`batchUpdateDevicesFromTargets`**: Retornar `Map<string, number>` (companyId → count) em vez de `number` total.

Isso requer JOIN com a tabela devices para obter o companyId. Query atual:
```sql
SELECT id, hawkbitTargetId FROM devices WHERE status = 'accepted'
```
Mudança:
```sql
SELECT id, hawkbitTargetId, companyId FROM devices WHERE status = 'accepted'
```

O parâmetro `devicesToUpdate` muda de `{ id, hawkbitTargetId }[]` para `{ id, hawkbitTargetId, companyId }[]`.

### 5.6 ALTERAR: `src/modules/deployments/index.ts` (~3 linhas)

**Após criar deployment** (POST /): emitir evento SSE.

```typescript
// Depois de: const deployment = await service.createDeployment(...)
sseEmitter.emit(params.companyId, 'deployment.created', {
  deploymentId: deployment.id,
  name: deployment.name,
});
```

### 5.7 ALTERAR: `src/common/config/env.ts` (~5 linhas)

Adicionar variável de configuração do SSE:

```typescript
// Dentro do EnvSchema:
SSE_ENABLED: Type.Boolean({ default: true }),
SSE_HEARTBEAT_SEC: Type.Optional(Type.Number({ default: 30, minimum: 10 })),
SSE_MAX_CONNECTIONS_PER_COMPANY: Type.Optional(Type.Number({ default: 50 })),
```

### 5.8 ALTERAR: `src/common/config/hawkbit.ts` (~3 linhas)

Adicionar accessor:

```typescript
get syncIntervalSec(): number {
  return env.HAWKBIT_SYNC_INTERVAL_SEC ?? 10;  // Era 30, agora 10
},
```

### 5.9 ALTERAR: `src/app.ts` (~3 linhas)

Registrar o módulo SSE:

```typescript
import { sseModule } from '@modules/sse';
// ...
app.use(sseModule);
```

### 5.10 ALTERAR: `.env.example` (~3 linhas)

```
SSE_ENABLED=true
SSE_HEARTBEAT_SEC=30
SSE_MAX_CONNECTIONS_PER_COMPANY=50
```

### 5.11 ALTERAR: `docker-compose.yml` (~0 linhas)

Nenhuma mudança. O SSE roda na mesma porta 8081 do API.

---

## 6. ARQUIVO NÃO ALTERADOS

| Arquivo | Motivo |
|---|---|
| `src/modules/devices/index.ts` | Endpoints REST iguais |
| `src/modules/devices/hawkbit-routes.ts` | Endpoints REST iguais |
| `src/modules/devices/service.ts` | Lógica de negócio igual |
| `src/modules/devices/provision-routes.ts` | Já é super-admin-only |
| `src/modules/deployments/device-routes.ts` | Endpoints REST iguais |
| `src/modules/deployments/service.ts` | Lógica hawkBit igual |
| `src/modules/artifacts/*` | Upload/download sem SSE |
| `src/common/hawkbit/*` | Cliente hawkBit sem mudança |
| `src/common/middleware/auth-guard.ts` | Macro `companyRole` reutilizada como está |
| `src/common/db/schema/*` | Schema sem mudança |
| `Dockerfile` | Sem mudança |

---

## 7. FLUXO DE DADOS COMPLETO (depois da mudança)

### 7.1 Device faz poll DDI no hawkBit

```
1. Device (STM32) → GET /DEFAULT/controller/v1/{controllerId} → hawkBit
2. hawkBit atualiza pollStatus (lastRequestAt, overdue=false)
3. Sync engine (a cada 10s) detecta mudança via hawkBit REST
4. batchUpdateDevicesFromTargets() atualiza DB local
5. sseEmitter.emit(companyId, 'devices.batch', { count: 3 })
6. Flutter recebe evento via SSE → atualiza UI instantaneamente
```

**Latência**: ≤10s (sync interval) + <50ms (SSE push) ≈ **10s máximo**

### 7.2 Admin cria deployment

```
1. Flutter → POST /api/companies/{id}/deployments → API
2. API cria DS no hawkBit, assigna targets
3. sseEmitter.emit(companyId, 'deployment.created', { id, name })
4. Flutter recebe evento → atualiza lista de deployments
5. Próximo poll do device → hawkBit entrega deploymentBase
6. Device baixa artifact, instala, reporta status
7. Sync detecta mudança → SSE push 'devices.batch'
```

**Latência para o admin**: **<100ms** (evento SSE no mesmo request-response do POST)

### 7.3 Flutter app vai para background

```
1. Flutter detecta lifecycle pause → fecha SSE connection
2. Sync engine continua rodando (10s) mantendo DB atualizado
3. Flutter volta para foreground → abre nova conexão SSE
4. GET /devices → dados frescos do DB local (≤10s de staleness)
```

---

## 8. CONSIDERAÇÕES TÉCNICAS

### 8.1 Escalabilidade das conexões SSE

- Cada conexão SSE é 1 socket TCP aberto + thread leve (Bun usa event loop)
- Limite por empresa: 50 conexões (configurável via `SSE_MAX_CONNECTIONS_PER_COMPANY`)
- Se exceder: conexão mais antiga é derrubada
- Com 100 empresas, 50 conexões cada = 5.000 sockets. Bun suporta 100k+.
- Consumo de memória: ~2KB por conexão → 10MB para 5.000 conexões

### 8.2 Reconexão automática

O protocolo SSE (W3C) suporta `Last-Event-ID` header. O emitter pode incluir `id` em cada evento. Se a conexão cai:
- O navegador/EventSource reconecta automaticamente
- Envia `Last-Event-ID: <último ID recebido>`
- O servidor pode (opcionalmente) reenviar eventos perdidos

Na primeira versão, não implementamos reenvio — o Flutter faz GET normal ao reconectar.

### 8.3 Auth na conexão SSE

O SSE usa cookies (como qualquer GET). O `auth-guard` macro valida a sessão na abertura. Se a sessão expirar durante a conexão, o heartbeat falha e a conexão é limpa no próximo ciclo.

**Não há refresh de token durante SSE** — se a sessão expirar, o cliente reconecta (o Better Auth renova o cookie no próximo sign-in).

### 8.4 CORS + SSE

O CORS do Elysia já está configurado com `credentials: true`. O SSE funciona com cookies cross-origin desde que:
- `Access-Control-Allow-Credentials: true` ✅ (já configurado)
- `Access-Control-Allow-Origin` não é `*` ✅ (já configurado com lista específica)

### 8.5 Proxy/Load Balancer

Se usar ALB ou nginx na frente:
- ALB: Suporta SSE com `Connection: keep-alive`. Timeout default 60s — aumentar para 300s.
- nginx: Precisa de `proxy_buffering off;` e `proxy_read_timeout 300s;`

Isso é config de infra, não de código.

---

## 9. ORDEM DE IMPLEMENTAÇÃO

| Passo | Arquivo | Descrição | Linhas |
|---|---|---|---|
| 1 | `src/common/sse/emitter.ts` | Criar Event Emitter | ~80 |
| 2 | `src/common/sse/index.ts` | Barrel re-export | ~10 |
| 3 | `src/common/config/env.ts` | Adicionar SSE_ENABLED, SSE_HEARTBEAT_SEC, SSE_MAX_CONNECTIONS | +15 |
| 4 | `src/common/config/hawkbit.ts` | Mudar default sync interval 30→10 | ~1 |
| 5 | `src/modules/sse/index.ts` | Endpoint SSE com auth-guard | ~60 |
| 6 | `src/modules/devices/sync-helpers.ts` | Retornar companyId no batchUpdate | ~20 |
| 7 | `src/modules/devices/sync.ts` | Emitir SSE após sync + imports | ~15 |
| 8 | `src/modules/deployments/index.ts` | Emitir SSE após create deployment | ~3 |
| 9 | `src/app.ts` | Registrar sseModule | ~3 |
| 10 | `.env.example`, `.env`, `.env.test` | Adicionar vars SSE | +9 |
| 11 | Testes | Teste de conexão SSE + eventos | ~60 |

**Total**: ~175 linhas novas, ~25 linhas alteradas, 0 linhas removidas.

---

## 10. O QUE O FLUTTER PRECISA FAZER (lado de lá)

### 10.1 Adicionar dependência

```yaml
# pubspec.yaml
dependencies:
  eventsource_client: ^2.0.0  # ou sse_client
```

### 10.2 Provider de conexão SSE

```dart
// lib/features/sse/sse_provider.dart
@riverpod
class CompanySse extends _$CompanySse {
  EventSource? _client;

  @override
  Stream<SseEvent> build(String companyId) {
    final apiBase = ref.read(apiConfigProvider).baseUrl;
    final token = ref.read(authProvider).sessionToken;
    
    _client = EventSource(
      uri: Uri.parse('$apiBase/api/companies/$companyId/sse'),
      headers: {'Cookie': 'auth.session_token=$token'},
    );
    
    ref.onDispose(() {
      _client?.close();
      _client = null;
    });
    
    return _client!.stream;
  }
}
```

### 10.3 Reagir a eventos

```dart
// No widget da lista de devices
ref.listen(companySseProvider(companyId), (previous, next) {
  if (next case SseEvent(:final event, :final data)) {
    switch (event) {
      case 'device.updated':
        final json = jsonDecode(data!);
        ref.read(devicesProvider.notifier).invalidateDevice(json['deviceId']);
      case 'devices.batch':
        ref.read(devicesProvider.notifier).invalidateAll();
      case 'deployment.created':
        ref.read(deploymentsProvider.notifier).invalidateAll();
    }
  }
});
```

### 10.4 Lifecycle (connect/disconnect)

```dart
// No main widget ou app observer
class AppLifecycleObserver extends WidgetsBindingObserver {
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      // Fecha SSE para economizar bateria
      ref.read(companySseProvider(companyId).notifier).close();
    } else if (state == AppLifecycleState.resumed) {
      // Reconecta SSE + refresh imediato
      ref.invalidate(companySseProvider(companyId));
      ref.read(devicesProvider.notifier).fetchAll();
    }
  }
}
```

---

## 11. RESUMO DO IMPACTO

| Métrica | Antes | Depois |
|---|---|---|
| **Latência device status → Flutter** | até 30s | ≤10s (sync) + <100ms (SSE push) |
| **Latência deployment criado → Flutter** | próximo GET manual | <100ms (SSE push imediato) |
| **Endpoints novos** | 0 | 1 (`GET /sse`) |
| **Linhas de código** | 0 | ~175 novas |
| **Infra adicional** | nenhuma | nenhuma |
| **Custo AWS adicional** | $0 | $0 |
| **Complexidade Flutter** | polling manual | EventSource + listeners |
| **Bateria do celular** | polling a cada N segundos | SSE (push, zero polling) |
| **Endpoints que mudam** | 0 REST endpoints | 0 REST endpoints (SSE é ADD only) |

---

*Aguardando aprovação para implementar.*
