import { describe, expect, test } from 'bun:test';
import {
	MAX_CUSTOM_DAYS,
	periodKey,
	periodLabel,
	periodQuery,
	resolvePeriod,
	saoPauloInstant,
	validateCustom,
} from './period';

const NOW = new Date('2026-10-22T15:00:00Z');

describe('period model', () => {
	test('relative presets resolve to moving windows', () => {
		const { from, to } = resolvePeriod({ kind: 'relative', preset: '24h' }, NOW);
		expect(to.getTime()).toBe(NOW.getTime());
		expect(to.getTime() - from.getTime()).toBe(86_400_000);
		const h1 = resolvePeriod({ kind: 'relative', preset: '1h' }, NOW);
		expect(h1.to.getTime() - h1.from.getTime()).toBe(3_600_000);
	});

	test('relative windows move with the clock (recompute on refresh)', () => {
		const later = new Date(NOW.getTime() + 600_000);
		const a = resolvePeriod({ kind: 'relative', preset: '1h' }, NOW);
		const b = resolvePeriod({ kind: 'relative', preset: '1h' }, later);
		expect(b.from.getTime()).toBe(a.from.getTime() + 600_000);
	});

	test('custom keeps explicit instants', () => {
		const p = {
			kind: 'custom',
			from: '2026-10-20T00:00:00-03:00',
			to: '2026-10-21T23:59:00-03:00',
		} as const;
		const { from, to } = resolvePeriod(p, NOW);
		expect(from.toISOString()).toBe('2026-10-20T03:00:00.000Z');
		expect(to.toISOString()).toBe('2026-10-22T02:59:00.000Z');
	});

	test('validateCustom rejects inverted and oversized ranges', () => {
		expect(validateCustom('2026-10-22T10:00:00-03:00', '2026-10-22T09:00:00-03:00').ok).toBe(false);
		expect(validateCustom('não-data', 'também não').ok).toBe(false);
		const far = `${NOW.getFullYear() - 2}-01-01T00:00:00-03:00`;
		expect(validateCustom(far, '2026-10-22T00:00:00-03:00').ok).toBe(false);
		expect(validateCustom('2026-10-01T00:00:00-03:00', '2026-10-22T23:00:00-03:00').ok).toBe(true);
		expect(MAX_CUSTOM_DAYS).toBe(365);
	});

	test('query serialization is ISO UTC with offset-independent instants', () => {
		const q = periodQuery({
			kind: 'custom',
			from: '2026-10-22T10:00:00-03:00',
			to: '2026-10-22T12:00:00-03:00',
		});
		expect(q.from).toBe('2026-10-22T13:00:00.000Z');
		expect(q.to).toBe('2026-10-22T15:00:00.000Z');
	});

	test('cache key is stable per preset and explicit for custom', () => {
		expect(periodKey({ kind: 'relative', preset: '7d' })).toBe('7d');
		const p = { kind: 'custom', from: '2026-10-20T00:00:00Z', to: '2026-10-21T00:00:00Z' } as const;
		expect(periodKey(p)).toBe(`custom:${Date.parse(p.from)}-${Date.parse(p.to)}`);
	});

	test('saoPauloInstant maps local day/time to correct UTC instant', () => {
		expect(saoPauloInstant('2026-10-22', '08:30')).toBe('2026-10-22T11:30:00.000Z');
		expect(saoPauloInstant('2026-10-22', '23:59', true)).toBe('2026-10-23T02:59:00.000Z');
		expect(saoPauloInstant('2026-10-22', 'bogus')).toBe('2026-10-22T03:00:00.000Z');
	});

	test('labels are pt-BR', () => {
		expect(periodLabel({ kind: 'relative', preset: '1h' })).toBe('Última hora');
		expect(periodLabel({ kind: 'relative', preset: '30d' })).toBe('Últimos 30 dias');
		expect(periodLabel({ kind: 'custom', from: '', to: '' } as const)).toBe('Personalizado');
	});
});
