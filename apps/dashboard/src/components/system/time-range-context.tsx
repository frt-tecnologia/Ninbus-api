'use client';

import * as React from 'react';

/**
 * Time range context — shared across all sections of a single page so a range
 * change re-fetches every dependent view (timeline, feed, charts…).
 * Defaults to the last 24 hours. Lift the provider to the page root.
 */

export interface TimeRange {
	from: Date;
	to: Date;
	label: string;
}

export interface RangeContextValue {
	range: TimeRange;
	setRange: (r: TimeRange) => void;
}

const RangeContext = React.createContext<RangeContextValue | null>(null);

export function RangeProvider({
	children,
	initial,
}: {
	children: React.ReactNode;
	initial?: TimeRange;
}) {
	const [range, setRange] = React.useState<TimeRange>(initial ?? last24h());
	const value = React.useMemo(() => ({ range, setRange }), [range]);
	return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange(): RangeContextValue {
	const ctx = React.useContext(RangeContext);
	if (!ctx) throw new Error('useRange must be used within a <RangeProvider>');
	return ctx;
}

/** Resolve a TimeRange from hours. */
export function rangeFromHours(h: number): TimeRange {
	const to = new Date();
	const from = new Date(to.getTime() - h * 3_600_000);
	return { from, to, label: h < 24 ? `Últimas ${h}h` : `Últimos ${h / 24}d` };
}
export const last1h = () => rangeFromHours(1);
export const last24h = () => rangeFromHours(24);
export const last7d = () => rangeFromHours(24 * 7);
export const last30d = () => rangeFromHours(24 * 30);

export interface Preset {
	label: string;
	short: string;
	build: () => TimeRange;
}
export const PRESETS: Preset[] = [
	{ label: 'Última hora', short: '1h', build: last1h },
	{ label: 'Últimas 24 horas', short: '24h', build: last24h },
	{ label: 'Últimos 7 dias', short: '7d', build: last7d },
	{ label: 'Últimos 30 dias', short: '30d', build: last30d },
];

export const CUSTOM_LABEL = 'Personalizado';

export function toLocalInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
