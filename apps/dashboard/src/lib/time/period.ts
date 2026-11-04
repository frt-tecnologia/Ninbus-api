/**
 * Unified period model — every temporal filter flows through here.
 * Presets are RELATIVE windows (1h/24h/7d/30d) recomputed on read;
 * 'custom' carries explicit datetimes. See docs/dashboard-v3-refinement-plan.md.
 */

export const TZ = 'America/Sao_Paulo';
export const MAX_CUSTOM_DAYS = 365;

export type PeriodPresetKey = '1h' | '24h' | '7d' | '30d';

export interface RelativePeriod {
	kind: 'relative';
	preset: PeriodPresetKey;
}

export interface CustomPeriod {
	kind: 'custom';
	/** Inclusive instants (ISO 8601 with offset or full datetime). */
	from: string;
	to: string;
}

export type Period = RelativePeriod | CustomPeriod;

export const PRESET_MS: Record<PeriodPresetKey, number> = {
	'1h': 3_600_000,
	'24h': 86_400_000,
	'7d': 7 * 86_400_000,
	'30d': 30 * 86_400_000,
};

export const PRESET_LABELS: Record<PeriodPresetKey, string> = {
	'1h': 'Última hora',
	'24h': 'Últimas 24 horas',
	'7d': 'Últimos 7 dias',
	'30d': 'Últimos 30 dias',
};

export const isRelative = (p: Period): p is RelativePeriod => p.kind === 'relative';

/** Resolve a period to concrete [from, to] instants at the given clock (relative windows move). */
export function resolvePeriod(p: Period, now: Date = new Date()): { from: Date; to: Date } {
	if (p.kind === 'relative') {
		return { from: new Date(now.getTime() - PRESET_MS[p.preset]), to: now };
	}
	return { from: new Date(p.from), to: new Date(p.to) };
}

/** Validation for custom ranges: parseable, from < to, sane max span. */
export function validateCustom(
	from: string,
	to: string,
): { ok: true } | { ok: false; reason: string } {
	const f = Date.parse(from);
	const t = Date.parse(to);
	if (Number.isNaN(f) || Number.isNaN(t))
		return { ok: false, reason: 'Datas ou horários inválidos.' };
	if (f >= t) return { ok: false, reason: 'O início precisa ser anterior ao fim.' };
	if (t - f > MAX_CUSTOM_DAYS * 86_400_000)
		return { ok: false, reason: `O intervalo máximo é de ${MAX_CUSTOM_DAYS} dias.` };
	return { ok: true };
}

/** Stable cache key part for a resolved window (period + filters belong in cache keys). */
export function periodKey(p: Period, now: Date = new Date()): string {
	if (p.kind === 'relative') return p.preset;
	const { from, to } = resolvePeriod(p, now);
	return `custom:${from.getTime()}-${to.getTime()}`;
}

/** Query params (ISO with offset) shared by every period-aware endpoint. */
export function periodQuery(p: Period, now: Date = new Date()): { from: string; to: string } {
	const { from, to } = resolvePeriod(p, now);
	return { from: from.toISOString(), to: to.toISOString() };
}

/** pt-BR label for chips. */
export function periodLabel(p: Period): string {
	return p.kind === 'relative' ? PRESET_LABELS[p.preset] : 'Personalizado';
}

/** Short label for compact controls. */
export const PRESET_SHORT: Record<PeriodPresetKey, string> = {
	'1h': '1h',
	'24h': '24h',
	'7d': '7d',
	'30d': '30d',
};

/**
 * Data/hora do dia a partir de componentes locais (São Paulo) — usada pelo
 * DateRangePicker+TimePicker para montar o custom com offset correto.
 */
export function saoPauloInstant(dateYmd: string, time: string, endOfDay = false): string {
	// Interpreta no fuso de São Paulo via formato com offset fixo do dia (trata DST
	// brasileiro histórico — hoje UTC−3 sem DST).
	const t = /^([01]\d|2[0-3]):([0-5]\d)$/.test(time) ? time : endOfDay ? '23:59' : '00:00';
	const probe = new Date(`${dateYmd}T${t}:00-03:00`);
	return probe.toISOString();
}
