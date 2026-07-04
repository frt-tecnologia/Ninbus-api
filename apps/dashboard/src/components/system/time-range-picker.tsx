'use client';

import { cn } from '@/lib/utils';
import * as React from 'react';

/**
 * Time range context — shared across all sections of a single page so that a
 * change to the range re-fetches every dependent view (timeline, feed, etc.).
 * Defaults to the last 24 hours.
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
	if (!ctx) {
		throw new Error('useRange must be used within a <RangeProvider>');
	}
	return ctx;
}

// ── Presets ─────────────────────────────────────────────────────────────

export function rangeFromHours(h: number): TimeRange {
	const to = new Date();
	const from = new Date(to.getTime() - h * 3_600_000);
	return { from, to, label: h < 24 ? `Últimas ${h}h` : `Últimos ${h / 24}d` };
}

export function last1h(): TimeRange {
	return rangeFromHours(1);
}
export function last24h(): TimeRange {
	return rangeFromHours(24);
}
export function last7d(): TimeRange {
	return rangeFromHours(24 * 7);
}
export function last30d(): TimeRange {
	return rangeFromHours(24 * 30);
}

const PRESETS: { label: string; build: () => TimeRange }[] = [
	{ label: 'Última 1h', build: last1h },
	{ label: 'Últimas 24h', build: last24h },
	{ label: 'Últimos 7 dias', build: last7d },
	{ label: 'Últimos 30 dias', build: last30d },
];

const CUSTOM_LABEL = 'Personalizado';

function toLocalInput(d: Date): string {
	// datetime-local format: YYYY-MM-DDTHH:MM (local time)
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * <TimeRangePicker> — compact dropdown of preset ranges PLUS a custom range
 * (two datetime-local inputs). Sets the shared range via context.
 */
export function TimeRangePicker({ className }: { className?: string }) {
	const { range, setRange } = useRange();
	const [open, setOpen] = React.useState(false);
	const [showCustom, setShowCustom] = React.useState(false);
	const [fromVal, setFromVal] = React.useState('');
	const [toVal, setToVal] = React.useState('');

	React.useEffect(() => {
		if (open) {
			setFromVal(toLocalInput(range.from));
			setToVal(toLocalInput(range.to));
		}
	}, [open, range.from, range.to]);

	React.useEffect(() => {
		if (!open) return;
		const close = () => setOpen(false);
		window.addEventListener('click', close);
		return () => window.removeEventListener('click', close);
	}, [open]);

	function applyCustom() {
		const from = new Date(fromVal);
		const to = new Date(toVal);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return;
		setRange({ from, to, label: CUSTOM_LABEL });
		setShowCustom(false);
		setOpen(false);
	}

	const activePreset = PRESETS.find((p) => p.label === range.label);

	return (
		<div className={cn('relative z-[100]', className)}>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen((o) => !o);
				}}
				className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
				aria-expanded={open}
				aria-haspopup="listbox"
			>
				<span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
				{range.label}
			</button>
			{open && (
				<div
					role="listbox"
					onClick={(e) => e.stopPropagation()}
					className="absolute right-0 top-full z-[100] mt-1 w-72 rounded-md border border-border bg-popover py-1 shadow-lg"
				>
					{PRESETS.map((p) => (
						<button
							key={p.label}
							type="button"
							onClick={() => {
								setRange(p.build());
								setShowCustom(false);
								setOpen(false);
							}}
							className={cn(
								'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-secondary',
								range.label === p.label ? 'font-medium text-foreground' : 'text-muted-foreground',
							)}
						>
							{p.label}
							{range.label === p.label && (
								<span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
							)}
						</button>
					))}
					<button
						type="button"
						onClick={() => setShowCustom((s) => !s)}
						className={cn(
							'flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-secondary',
							range.label === CUSTOM_LABEL
								? 'font-medium text-foreground'
								: 'text-muted-foreground',
						)}
					>
						{CUSTOM_LABEL}
						{(range.label === CUSTOM_LABEL || showCustom) && (
							<span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
						)}
					</button>
					{showCustom && (
						<div className="space-y-2 border-t border-border px-3 py-2">
							<label className="block">
								<span className="text-[10px] text-muted-foreground">De</span>
								<input
									type="datetime-local"
									value={fromVal}
									onChange={(e) => setFromVal(e.target.value)}
									className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
								/>
							</label>
							<label className="block">
								<span className="text-[10px] text-muted-foreground">Até</span>
								<input
									type="datetime-local"
									value={toVal}
									onChange={(e) => setToVal(e.target.value)}
									className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs"
								/>
							</label>
							<button
								type="button"
								onClick={applyCustom}
								disabled={!fromVal || !toVal}
								className="w-full rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
							>
								Aplicar
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
