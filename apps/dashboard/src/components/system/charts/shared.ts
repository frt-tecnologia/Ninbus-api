import type { SignalTone } from '@/lib/design/tokens';

/**
 * Chart shared helpers — the bridge between the SIGNAL token system and
 * chart rendering.
 *
 * Charts are PURE markup (HTML for bars, SVG for arcs) so they stay
 * bundle-lean and theme-aware via CSS variables — no chart library, no
 * hard-coded hex colors. Every fill reads an `hsl(var(--signal-*))` token so
 * light/dark themes share one source of truth (globals.css).
 *
 * Keep this file dependency-free so it can be imported by any chart
 * primitive (client or otherwise).
 */

/** tone → CSS color, reading the signal CSS variables (theme-aware). */
export const TONE_FILL: Record<SignalTone, string> = {
	ok: 'hsl(var(--signal-ok))',
	busy: 'hsl(var(--signal-busy))',
	fault: 'hsl(var(--signal-fault))',
	idle: 'hsl(var(--signal-idle))',
	info: 'hsl(var(--signal-info))',
};

/** tone → soft translucent fill (for the "remaining / not-updated" stacks). */
export const TONE_FILL_SOFT: Record<SignalTone, string> = {
	ok: 'hsl(var(--signal-ok) / 0.28)',
	busy: 'hsl(var(--signal-busy) / 0.28)',
	fault: 'hsl(var(--signal-fault) / 0.28)',
	idle: 'hsl(var(--signal-idle) / 0.28)',
	info: 'hsl(var(--signal-info) / 0.28)',
};

/** tone → solid text class (for labels/legends inside the chart). */
export const TONE_TEXT_CLASS: Record<SignalTone, string> = {
	ok: 'text-signal-ok',
	busy: 'text-signal-busy',
	fault: 'text-signal-fault',
	idle: 'text-signal-idle',
	info: 'text-signal-info',
};

// ── BRAND chart palette ───────────────────────────────────────────────
// The three Ninbus brand colors (from the logo + secondary). Used by the
// overview charts so they read as brand identity, not gray. Each reads its
// CSS variable so light/dark themes share one source (globals.css).
export type BrandColor = 'lime' | 'violet' | 'chartreuse';

export const BRAND_FILL: Record<BrandColor, string> = {
	lime: 'hsl(var(--brand-lime))',
	violet: 'hsl(var(--brand-violet))',
	chartreuse: 'hsl(var(--brand-chartreuse))',
};

export const BRAND_FILL_SOFT: Record<BrandColor, string> = {
	lime: 'hsl(var(--brand-lime) / 0.3)',
	violet: 'hsl(var(--brand-violet) / 0.3)',
	chartreuse: 'hsl(var(--brand-chartreuse) / 0.3)',
};

export interface ChartBar {
	/** x-axis label (e.g. day, company name). */
	label: string;
	/** numeric height of the bar. */
	value: number;
	tone?: SignalTone;
}

/**
 * Convert a polar coordinate (SVG y-down) to cartesian. Angle in degrees,
 * measured CCW from the +x axis, so 180°→left, 90°→top, 0°→right of a dome.
 * Used by the semicircle <Gauge>.
 */
export function polarToCartesian(
	cx: number,
	cy: number,
	r: number,
	angleDeg: number,
): { x: number; y: number } {
	const a = ((angleDeg - 0) * Math.PI) / 180;
	return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/**
 * SVG arc path between two angles on a circle of radius `r` centered at
 * (cx, cy). Draws clockwise (over the top for a 180°→0° sweep), which is what
 * the semicircle gauge needs. `stroke` this path for a gauge band.
 */
export function describeArc(
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
): string {
	const start = polarToCartesian(cx, cy, r, startAngle);
	const end = polarToCartesian(cx, cy, r, endAngle);
	const largeArc = Math.abs(startAngle - endAngle) > 180 ? 1 : 0;
	// sweep=1 → clockwise in SVG screen space (y-down), going over the dome.
	return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/** Clamp + guard so empty charts never render NaN heights. */
export function safePct(value: number, max: number): number {
	if (!max || !Number.isFinite(max)) return 0;
	return Math.max(0, Math.min(100, (value / max) * 100));
}
