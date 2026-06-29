import * as React from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Operational empty / error / loading states — terse copy, no emoji.
 * Reusable across every table/section so these states look consistent.
 */

export function Empty({
	title = 'Sem dados',
	description,
	action,
	className,
	icon,
}: {
	title?: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
	icon?: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-2 py-14 text-center',
				className,
			)}
		>
			<div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
				{icon ?? <Inbox className="h-4 w-4" />}
			</div>
			<p className="text-sm font-medium text-foreground">{title}</p>
			{description && (
				<p className="max-w-xs text-xs text-muted-foreground">{description}</p>
			)}
			{action && <div className="mt-1">{action}</div>}
		</div>
	);
}

export function ErrorState({
	message = 'Falha ao carregar.',
	onRetry,
	className,
}: {
	message?: React.ReactNode;
	onRetry?: () => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center gap-2 py-14 text-center',
				className,
			)}
		>
			<div className="flex h-9 w-9 items-center justify-center rounded-md border border-signal-fault/30 text-signal-fault">
				<AlertTriangle className="h-4 w-4" />
			</div>
			<p className="text-sm font-medium text-foreground">{message}</p>
			{onRetry && (
				<Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
					Tentar novamente
				</Button>
			)}
		</div>
	);
}

/** Loading skeleton for a table body. */
export function TableLoading({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
	return (
		<div className="divide-y divide-border">
			{Array.from({ length: rows }).map((_, r) => (
				<div key={r} className="flex items-center gap-3 px-3 py-2.5">
					{Array.from({ length: cols }).map((__, c) => (
						<Skeleton key={c} className="h-3.5 flex-1" />
					))}
				</div>
			))}
		</div>
	);
}
