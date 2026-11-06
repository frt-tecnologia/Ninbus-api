export type Range = readonly [number, number];
export type DragMode = 'start' | 'end' | 'pan' | 'new';
export function fitRange(range: Range, domain: Range, minSpan: number): [number, number] {
	const full = Math.max(1, domain[1] - domain[0]);
	const least = Math.min(Math.max(1, minSpan), full);
	const raw = Number.isFinite(range[1] - range[0]) ? range[1] - range[0] : full;
	const span = Math.max(least, Math.min(full, raw));
	const start = Math.max(
		domain[0],
		Math.min(domain[1] - span, Number.isFinite(range[0]) ? range[0] : domain[0]),
	);
	return [Math.round(start), Math.round(start + span)];
}
export function dragRange(
	mode: DragMode,
	original: Range,
	anchor: number,
	at: number,
	domain: Range,
	minSpan: number,
): [number, number] {
	const least = Math.min(minSpan, domain[1] - domain[0]);
	const [start, end] = original;
	if (mode === 'pan') return fitRange([start + at - anchor, end + at - anchor], domain, minSpan);
	if (mode === 'start')
		return fitRange([Math.max(domain[0], Math.min(at, end - least)), end], domain, minSpan);
	if (mode === 'end')
		return fitRange([start, Math.max(start + least, Math.min(at, domain[1]))], domain, minSpan);
	const lo = Math.min(anchor, at),
		hi = Math.max(anchor, at);
	return fitRange(
		at >= anchor ? [lo, Math.max(hi, lo + least)] : [Math.min(lo, hi - least), hi],
		domain,
		minSpan,
	);
}
