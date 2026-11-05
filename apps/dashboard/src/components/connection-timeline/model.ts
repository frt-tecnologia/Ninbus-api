import type {
	ConnectionSegment,
	TimelineDevice,
	TimelineRecord,
	TimelineRow,
	TimeRange,
} from './types';

export const stateLabels = {
	online: 'Conectado',
	offline: 'Desconectado',
	unknown: 'Sem histórico',
};
export function elapsed(ms: number) {
	const minutes = Math.max(0, Math.round(ms / 60000));
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60),
		rest = minutes % 60;
	return rest ? `${hours}h ${String(rest).padStart(2, '0')}min` : `${hours}h`;
}
export function buildSegments(
	sessions: readonly { start: number; end: number }[],
	range: TimeRange,
): ConnectionSegment[] {
	const [from, to] = range;
	if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
	const merged: { start: number; end: number }[] = [];
	for (const session of sessions
		.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
		.slice()
		.sort((a, b) => a.start - b.start)) {
		const previous = merged.at(-1);
		if (previous && session.start <= previous.end)
			previous.end = Math.max(previous.end, session.end);
		else merged.push({ ...session });
	}
	const result: ConnectionSegment[] = [];
	let cursor = from,
		observed = merged.some((s) => s.start < from);
	const append = (start: number, end: number, state: ConnectionSegment['state']) => {
		if (end > start) result.push({ start, end, state });
	};
	for (const session of merged) {
		if (session.end <= from) {
			observed = true;
			continue;
		}
		if (session.start >= to) break;
		const start = Math.max(from, session.start),
			end = Math.min(to, session.end);
		append(cursor, start, observed ? 'offline' : 'unknown');
		append(start, end, 'online');
		cursor = Math.max(cursor, end);
		observed = true;
	}
	append(cursor, to, observed ? 'offline' : 'unknown');
	return result;
}
export function createConnectionRecord<T extends TimelineDevice>(
	device: T,
	sessions: readonly { start: number; end: number }[],
	range: TimeRange,
): TimelineRecord<T> {
	const segments = buildSegments(sessions, range);
	const total = (state: ConnectionSegment['state']) =>
		segments.filter((s) => s.state === state).reduce((sum, s) => sum + s.end - s.start, 0);
	const onlineMs = total('online'),
		offlineMs = total('offline'),
		unknownMs = total('unknown');
	return {
		device,
		segments,
		onlineMs,
		offlineMs,
		unknownMs,
		availability: onlineMs + offlineMs ? onlineMs / (onlineMs + offlineMs) : null,
	};
}
export function getPageRows<T extends TimelineDevice>(
	rows: readonly TimelineRow<T>[],
	page: number,
	size: number,
): TimelineRow<T>[] {
	const start = page * size,
		chunk = rows.slice(start, start + size);
	if (start && chunk[0]?.kind === 'device') {
		for (let i = start - 1; i >= 0; i--)
			if (rows[i].kind === 'company') {
				chunk.unshift(rows[i]);
				break;
			}
	}
	return chunk;
}
export function rowWindow(
	offset: number,
	height: number,
	rowHeight: number,
	total: number,
	overscan = 6,
) {
	const start = Math.min(total, Math.max(0, Math.floor(offset / rowHeight) - overscan));
	return {
		start,
		end: Math.max(
			start,
			Math.min(total, Math.ceil((offset + Math.max(0, height)) / rowHeight) + overscan),
		),
	};
}
export function timeTicks(range: TimeRange, width: number) {
	const span = range[1] - range[0];
	if (span <= 0) return [];
	const capacity = Math.max(2, Math.floor(width / 95));
	const candidates = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440, 2880, 10080].map(
		(m) => m * 60000,
	);
	const step = candidates.find((value) => value >= span / capacity) ?? span;
	const ticks = [range[0]];
	for (let tick = range[0] + step; tick < range[1] - step * 0.45; tick += step) ticks.push(tick);
	ticks.push(range[1]);
	return ticks;
}
