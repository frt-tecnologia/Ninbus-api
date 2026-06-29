import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <Toolbar> — the standard filter/search/action bar above a data view.
 * Pure slot composition: left side (children = filters/search), right side
 * (actions). Keeps pages declarative and the bar consistent.
 */
export function Toolbar({
	children,
	actions,
	className,
}: {
	children?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
				className,
			)}
		>
			<div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			)}
		</div>
	);
}
