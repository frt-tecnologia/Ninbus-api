import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <Time> / <Relative> — date rendering helpers that centralize locale formatting
 * and expose the full timestamp in a native `title` tooltip (no JS tooltip lib
 * needed for hover). Tabular figures keep columns aligned in tables.
 */
const fmt = new Intl.DateTimeFormat('pt-BR', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
});

export function Time({
	value,
	className,
	fallback = '—',
}: {
	value: string | number | Date | null | undefined;
	className?: string;
	fallback?: React.ReactNode;
}) {
	if (value === null || value === undefined || value === '') {
		return <span className="text-muted-foreground">{fallback}</span>;
	}
	const d = toDate(value);
	if (!d) return <span className="text-muted-foreground">{fallback}</span>;
	return (
		<time
			dateTime={d.toISOString()}
			title={fmt.format(d)}
			className={cn('tabular-nums text-muted-foreground', className)}
		>
			{fmt.format(d)}
		</time>
	);
}

export function Relative({
	value,
	className,
	fallback = '—',
}: {
	value: string | number | Date | null | undefined;
	className?: string;
	fallback?: React.ReactNode;
}) {
	if (value === null || value === undefined || value === '') {
		return <span className="text-muted-foreground">{fallback}</span>;
	}
	const d = toDate(value);
	if (!d) return <span className="text-muted-foreground">{fallback}</span>;
	const diff = Date.now() - d.getTime();
	return (
		<time
			dateTime={d.toISOString()}
			title={fmt.format(d)}
			className={cn('tabular-nums text-muted-foreground', className)}
		>
			{humanize(diff)}
		</time>
	);
}

function toDate(v: string | number | Date): Date | null {
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
	if (typeof v === 'number') {
		// epoch seconds (deployment createdAt) vs epoch ms (Date.now())
		const ms = v < 1e12 ? v * 1000 : v;
		const d = new Date(ms);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d;
}

function humanize(ms: number): string {
	const abs = Math.abs(ms);
	const sec = Math.round(abs / 1000);
	const min = Math.round(sec / 60);
	const hr = Math.round(min / 60);
	const day = Math.round(hr / 24);
	const suffix = ms >= 0 ? 'atrás' : 'agora';
	if (sec < 45) return 'agora';
	if (min < 60) return `há ${min} min`;
	if (hr < 24) return `há ${hr} h`;
	if (day < 30) return `há ${day} d`;
	const d = new Date(Date.now() - ms);
	return fmt.format(d);
}
