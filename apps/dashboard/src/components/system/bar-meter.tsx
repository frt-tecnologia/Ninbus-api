import * as React from 'react';
import { cn } from '@/lib/utils';
import type { SignalTone } from '@/lib/design/tokens';

/**
 * <BarMeter> — a horizontal proportion meter: a labeled bar whose filled
 * width reflects `value/max`. The fill uses a SIGNAL tone so it reads as
 * fleet state, not decoration. Used on the overview to show, e.g.,
 * "12 of 16 devices online".
 *
 * Pure CSS (no chart lib) — keeps the bundle lean and the look consistent
 * with the signal system.
 */
export function BarMeter({
	label,
	value,
	max,
	tone = 'ok',
	hint,
	className,
}: {
	label: string;
	value: number;
	max: number;
	tone?: SignalTone;
	hint?: React.ReactNode;
	className?: string;
}) {
	const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
	return (
		<div className={cn('flex flex-col gap-1.5', className)}>
			<div className="flex items-baseline justify-between">
				<span className="text-sm font-medium text-foreground">{label}</span>
				<span className="font-mono text-sm tabular-nums text-muted-foreground">
					{value}
					<span className="text-muted-foreground/60"> / {max}</span>
				</span>
			</div>
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div
					className={cn('h-full rounded-full transition-all', TONE_BAR[tone])}
					style={{ width: `${pct}%` }}
				/>
			</div>
			{hint && <span className="text-xs text-muted-foreground">{hint}</span>}
		</div>
	);
}

const TONE_BAR: Record<SignalTone, string> = {
	ok: 'bg-signal-ok',
	busy: 'bg-signal-busy',
	fault: 'bg-signal-fault',
	idle: 'bg-signal-idle',
	info: 'bg-signal-info',
};
