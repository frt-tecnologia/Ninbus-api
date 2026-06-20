# 🔍 Análise Forense — Discrepância Serial Number (ATUALIZADO)

## Conclusão Final

**O código do servidor está CORRETO. Não há bug na conversão BCD.**

3 de 4 casos validados confirmam que `decimalSerialToHex()` e `hexToDecimalSerial()`
produzem resultados idênticos ao firmware do controlador EEPROM.

O caso `26.5.15.001.00777` é uma anomalia — o serial escrito na plataforma
NÃO corresponde ao serial que estava gravado no EEPROM daquele dispositivo.

---

## Validação Cruzada — 4 Casos

### ✅ Caso 1: `26.6.15.001.00000`
```
API:     1A 61 50 01 00 00 0F FF  →  1A61500100000FFF
EEPROM:  1A 61 50 01 00 00 0F FF  →  1A61500100000FFF
MATCH: ✓ PERFEITO
```

### ✅ Caso 2: `26.6.15.001.31312`
```
API:     1A 61 50 01 31 31 2F FF  →  1A61500131312FFF
EEPROM:  1A 61 50 01 31 31 2F FF  →  1A61500131312FFF
MATCH: ✓ PERFEITO
```

### ✅ Caso 3: `26.C.15.001.03414`
```
API:     1A C1 50 01 03 41 4F FF  →  1AC1500103414FFF
EEPROM:  1A C1 50 01 03 41 4F FF  →  1AC1500103414FFF
MATCH: ✓ PERFEITO
```

### ❌ Caso 4 (anomalia): `26.5.15.001.00777`
```
API:     1A 51 50 01 00 77 7F FF  →  1A51500100777FFF
EEPROM:  1A 41 50 01 00 07 7F FF  →  1A41500100077FFF
MATCH: ✗ DIVERGE

EEPROM decodifica como: 26.4.15.001.00077 (serial DIFERENTE)
```

---

## Análise da Anomalia

O EEPROM do dispositivo contém o serial `26.4.15.001.00077`:
- Mês: 4 (Abril) — não 5 (Maio)
- Sequencial: 00077 — não 00777

### Hipóteses para a anomalia (ordenadas por probabilidade)

| # | Hipótese | Prob | Explicação |
|---|---------|------|-----------|
| H1 | **Serial diferente foi digitado na plataforma** | 60% | Usuário digitou `26.5.15.001.00777` mas o dispositivo real era `26.4.15.001.00077` |
| H2 | **Dispositivo errado foi lido** | 25% | A leitura "do controlador" veio de outro dispositivo físico |
| H3 | **EEPROM foi reprogramado** | 10% | O serial foi alterado no EEPROM após a gravação na plataforma |
| H4 | **Bug no firmware desse dispositivo específico** | 5% | Erro pontual na gravação EEPROM daquele dispositivo |

---

## Plano de Ação Revisado

### ~~ETAPA 1 — Corrigir BUG #1 (mês)~~ → CANCELADA

**O código do servidor está correto.** O mês é 1-indexado tanto no display
quanto no EEPROM. Confirmado por 3 casos independentes:
- M=6 → nibble 6 → byte 0x6_ ✓
- M=C → nibble C → byte 0xC_ ✓

**Nenhuma alteração em `decimalSerialToHex()` ou `hexToDecimalSerial()`.**

### ETAPA 1 (revisada) — Investigar anomalia do dispositivo `[AÇÃO DO USUÁRIO]`

1. **Verificar etiqueta física** do dispositivo que foi gravado como `26.5.15.001.00777`
   - O serial na etiqueta é `26.5.15.001.00777` ou `26.4.15.001.00077`?
2. **Confirmar dispositivo** — a leitura EEPROM `1A41500100077FFF` veio do
   MESMO dispositivo que foi registrado como `1A51500100777FFF`?
3. Se confirmado que foi erro de digitação:
   - Deprovisionar `1A51500100777FFF` via `DELETE /api/devices/deprovision/1A51500100777FFF`
   - Provisionar novamente com o serial correto `26.4.15.001.00077`

### ETAPA 2 — Proteção contra erro de digitação `[MELHORIA OPCIONAL]`

Para evitar que usuários registrem seriais errados no futuro:

- **Opção A**: Antes de provisionar, exigir que o dispositivo confirme o serial
  via polling hawkBit (device lê seu próprio EEPROM e envia como controllerId)
- **Opção B**: Campo de confirmação no frontend (digitar 2x)
- **Opção C**: Validação visual — mostrar HEX gerado e pedir confirmação

### ETAPA 3 — Testes unitários (recomendado, sem urgência)

Criar `tests/serial-number.test.ts` com os 4 casos acima como fixtures:

```typescript
// Casos validados contra EEPROM real
expect(decimalSerialToHex('26.6.15.001.00000')).toBe('1A61500100000FFF');
expect(decimalSerialToHex('26.6.15.001.31312')).toBe('1A61500131312FFF');
expect(decimalSerialToHex('26.C.15.001.03414')).toBe('1AC1500103414FFF');

// Roundtrip
expect(hexToDecimalSerial('1A61500100000FFF')).toBe('26.6.15.001.00000');
expect(hexToDecimalSerial('1AC1500103414FFF')).toBe('26.C.15.001.03414');
```

---

## Resumo

| Item | Status |
|------|--------|
| Conversão BCD (display → HEX) | ✅ Correta |
| Conversão inversa (HEX → display) | ✅ Correta |
| Mês (indexação) | ✅ 1-indexado, sem conversão necessária |
| NNNNN (sequencial) | ✅ 5 dígitos, correto |
| Reserved bytes (FFF) | ✅ Correto |
| Anomalia 26.5.15.001.00777 | ⚠️ Serial diferente no dispositivo — investigar |
| **Ação no código** | **NENHUMA — código está correto** |
