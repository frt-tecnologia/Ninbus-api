import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <PageHeader> — page title + description + a right-aligned action slot.
 * Replaces the old generic header. Kept deliberately spare: no eyebrow text,
 * no avatar greeting, no decorative icon. Operational.
 */
type PageHeaderProps = {
	title: React.ReactNode;
	description?: React.ReactNode;
	/** Right-aligned actions (e.g. "Cadastrar device", theme toggle). */
	action?: React.ReactNode;
	className?: string;
};

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
	return (
		<div
			className={cn(
				'mb-6 flex flex-col gap-2 pb-[22px] sm:flex-row sm:items-end sm:justify-between',
				className,
			)}
		>
			<div className="min-w-0">
				<h1 className="t-hero text-foreground">{title}</h1>
				{description && <p className="t-meta mt-1 text-muted-foreground">{description}</p>}
			</div>
			{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
		</div>
	);
}
