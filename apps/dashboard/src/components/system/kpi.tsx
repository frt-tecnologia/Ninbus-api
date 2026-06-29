import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <Kpi> — a single metric, deliberately WITHOUT the generic "icon in a colored
 * box". Identity comes from the large tabular figure + a label + optional
 * delta/sparkline slot. Anti-trope: no decorative iconography, no shadow.
 */
type KpiProps = {
	label: string;
	value: React.ReactNode;
	/** Sub-label under the value (e.g. "online de 542"). */
	hint?: React.ReactNode;
	/** Small status token slot (a <Signal> or text) next to the value. */
	indicator?: React.ReactNode;
	className?: string;
};

export function Kpi({ label, value, hint, indicator, className }: KpiProps) {
	return (
		<div className={cn('flex flex-col gap-2', className)}>
			<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="flex items-baseline gap-2">
				<span className="font-mono text-4xl font-semibold tabular-nums leading-none text-foreground">
					{value}
				</span>
				{indicator}
			</div>
			{hint && <div className="text-sm text-muted-foreground">{hint}</div>}
		</div>
	);
}
