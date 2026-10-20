import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <Section> — the standard content container: a bordered surface with a header
 * row (title + description + an `action` slot) and a body. Composable via slots
 * rather than prop-bombs. `flush` removes body padding (for tables).
 */
type SectionProps = {
	title?: React.ReactNode;
	description?: React.ReactNode;
	/** Right-aligned action area (buttons, filters). */
	action?: React.ReactNode;
	flush?: boolean;
	className?: string;
	bodyClassName?: string;
	children: React.ReactNode;
};

export function Section({
	title,
	description,
	action,
	flush,
	className,
	bodyClassName,
	children,
}: SectionProps) {
	return (
		<section className={cn('rounded-md bg-card shadow-e1', className)}>
			{(title || action) && (
				<header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
					<div className="min-w-0">
						{title && <h2 className="t-title truncate text-foreground">{title}</h2>}
						{description && <p className="t-meta mt-0.5 text-muted-foreground">{description}</p>}
					</div>
					{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
				</header>
			)}
			<div className={cn(!flush && 'p-4', flush && 'overflow-hidden', bodyClassName)}>
				{children}
			</div>
		</section>
	);
}

/** Standalone section header (when the body is rendered separately). */
export function SectionHeader({
	title,
	description,
	action,
	className,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<header className={cn('flex items-end justify-between gap-3 pb-3', className)}>
			<div className="min-w-0">
				<h2 className="t-title text-foreground">{title}</h2>
				{description && <p className="t-meta mt-0.5 text-muted-foreground">{description}</p>}
			</div>
			{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
		</header>
	);
}
