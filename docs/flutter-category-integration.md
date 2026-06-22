# Flutter — Integração de Categorização de Dispositivos

Guia de integração dos endpoints de **categorias (grupos)** e **gerenciamento de membros (dispositivos)** para o frontend Flutter.

## Visão geral

Dispositivos são agrupados em **categorias** (N:N). Cada categoria tem um `type` entre os **3 pré-existentes** usados pela interface:

| `type`      | Rótulo Flutter |
|-------------|----------------|
| `bus_line`  | Linhas         |
| `garage`    | Garagens       |
| `region`    | Regiões        |

> Os tipos `yard` e `custom` também existem no enum mas não são usados pela tela de divisão do app.

Todas as rotas são **company-scoped** (`/api/companies/:companyId/categories/...`) e exigem autenticação (cookie de sessão **ou** Bearer token) + membership na empresa. Veja o papel mínimo por operação na tabela de RBAC abaixo.

## RBAC (papel mínimo por operação)

| Operação                          | Papel mínimo |
|-----------------------------------|--------------|
| Listar grupos / listar membros    | `viewer`     |
| Criar grupo / editar nome         | `operator`   |
| Adicionar / remover / editar membros | `operator` |
| Excluir grupo                     | `admin`      |

Papéis em ordem crescente: `viewer(1) < operator(2) < admin(3) < owner(4)`.

---

## 1. Grupos (CRUD)

### Criar grupo (adesão de novo grupo)
`POST /api/companies/:companyId/categories`
```json
{
  "name": "Linha 100",
  "type": "bus_line",
  "description": "Rota centro-bairro (opcional)"
}
```
**201** → `{ "message": "...", "data": { "id": "...", "name": "...", "type": "bus_line", ... } }`

### Listar grupos
`GET /api/companies/:companyId/categories`
**200** → `{ "data": [ ... ], "total": N }`
> Dica: filtre no client por `type` para montar as abas **Linhas | Garagens | Regiões**.

### Ver um grupo
`GET /api/companies/:companyId/categories/:categoryId`
**200** → `{ "data": { ... } }` · **404** se não existir.

### Editar nome/descrição (edição do nome do grupo)
`PUT /api/companies/:companyId/categories/:categoryId`
```json
{ "name": "Linha 100 - Expressa", "description": "Atualizada" }
```
**200** → `{ "message": "...", "data": { ... } }`

### Excluir grupo (exclusão do grupo)
`DELETE /api/companies/:companyId/categories/:categoryId`
**200** → `{ "message": "Category deleted successfully" }`

> A exclusão é **cascade**: remove automaticamente todas as atribuições de membros. Os **dispositivos permanecem** na empresa — apenas saem do grupo.

---

## 2. Membros (dispositivos dentro de um grupo)

Estes endpoints são o ponto central da integração: permitem adicionar, remover, editar e listar dispositivos **dentro** de um grupo específico.

### Listar membros
`GET /api/companies/:companyId/categories/:categoryId/devices`
**200** →
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Onibus 1",
      "serialNumber": "AABBCCDD...",
      "serialDisplay": "AA.BB.CC.DD...",
      "status": "accepted",
      "connectionStatus": "disconnected",
      "hawkbitUpdateStatus": "in_sync",
      "assignedAt": "2026-06-21T01:40:30.668Z",
      ...
    }
  ],
  "total": 3
}
```
**404** se a categoria não existir.

### Adicionar membros (adesão de membros)
`POST /api/companies/:companyId/categories/:categoryId/devices`
```json
{ "deviceIds": ["uuid-1", "uuid-2", "uuid-3"] }
```
**200** →
```json
{
  "message": "Devices added to category successfully",
  "data": { "assigned": 2, "skipped": 1, "total": 3 }
}
```
- **Idempotente**: dispositivos que já são membros são contabilizados em `skipped` (não dá erro).
- **Cross-tenant seguro**: só dispositivos da mesma empresa são aceitos — IDs de outras empresas são silenciosamente ignorados.
- Um mesmo dispositivo pode pertencer a **vários grupos** (N:N).

### Substituir todos os membros (edição dos membros — bulk)
`PUT /api/companies/:companyId/categories/:categoryId/devices`
```json
{ "deviceIds": ["uuid-1", "uuid-3"] }
```
**200** → `{ "message": "...", "data": { "assigned": 2, "skipped": 0, "total": 2 } }`
- Substitui **integralmente** a lista de membros. Dispositivos ausentes da lista são removidos do grupo.
- `minItems: 1` no schema — para **limpar** todos os membros, use `DELETE` individual ou `DELETE` do próprio grupo.

### Remover um membro (exclusão de membros)
`DELETE /api/companies/:companyId/categories/:categoryId/devices/:deviceId`
**200** → `{ "message": "...", "data": { "removed": 1 } }`
- Retorna `removed: 0` (não erro) se o dispositivo não era membro.
- O dispositivo **continua na empresa** e em outros grupos.

---

## 3. Atribuição reversa (categorias de um dispositivo)

Caso o Flutter precise mostrar "em quais grupos este dispositivo está" (visão device-centrica em vez de group-centrica):

- `GET /api/companies/:companyId/devices/:deviceId/categories` → lista as categorias do dispositivo.
- `PUT /api/companies/:companyId/devices/:deviceId/categories` com `{ "categoryIds": [...] }` → **substitui** todas as categorias do dispositivo.

> Atenção: o `PUT` de device é **substituição total**. Para adicionar/remover uma categoria de um device sem afetar as outras, prefira os endpoints de membros (seção 2).

---

## 4. Exemplo de fluxo completo no Flutter

```dart
// 1) Criar grupo "Linha 100" (bus_line)
final cat = await api.post(
  '/api/companies/$companyId/categories',
  body: {'name': 'Linha 100', 'type': 'bus_line'},
);
final lineId = cat['data']['id'];

// 2) Adicionar dispositivos à linha
await api.post(
  '/api/companies/$companyId/categories/$lineId/devices',
  body: {'deviceIds': [dev1, dev2, dev3]},
);

// 3) Listar membros para exibir na UI
final members = await api.get(
  '/api/companies/$companyId/categories/$lineId/devices',
);

// 4) Remover um dispositivo do grupo (mas não da empresa)
await api.delete(
  '/api/companies/$companyId/categories/$lineId/devices/$dev2',
);

// 5) Renomear o grupo
await api.put(
  '/api/companies/$companyId/categories/$lineId',
  body: {'name': 'Linha 100 - Expressa'},
);

// 6) Excluir o grupo inteiro (membros saem, dispositivos permanecem)
await api.delete('/api/companies/$companyId/categories/$lineId');
```

---

## 5. Tratamento de erros (padrão)

| Status | Quando                                                            |
|--------|-------------------------------------------------------------------|
| 400    | Body inválido (ex: `deviceIds` vazio, `type` inválido).           |
| 401    | Sem sessão/cookie/Bearer.                                         |
| 403    | Usuário sem papel suficiente ou não-membro da empresa.            |
| 404    | Categoria (ou dispositivo) não existe ou não pertence à empresa.  |

Corpo padrão de erro: `{ "error": "Not Found", "message": "Category not found" }`.

---

## 6. Cobertura de testes

`tests/categories.test.ts` cobre 27 cenários: CRUD de grupos, validações, RBAC (401/403), **e 15 testes do bloco "Category Members"**:

- Adesão (POST), idempotência, adicionar em massa.
- Listagem com `assignedAt`.
- Remoção individual (DELETE) com `removed=1` e `removed=0`.
- Substituição total (PUT).
- Cross-tenant: dispositivo de outra empresa **não** é adicionado.
- Cascade: ao deletar o grupo, os dispositivos permanecem na empresa.
- 404/400/401/403.

Para rodar localmente:
```bash
bun test --env-file=.env.test tests/categories.test.ts
```
