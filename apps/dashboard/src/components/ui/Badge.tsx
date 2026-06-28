import { type ReactNode } from 'react';
import { cn, type StatusMeta } from '@/lib/utils';

/**
 * Badge — colored pill for status display.
 * Centralizes the variant→class mapping so every status renders consistently.
 */
const VARIANTS: Record<StatusMeta['variant'], string> = {
	success: 'bg-green-100 text-green-800 border-green-200',
	warning: 'bg-amber-100 text-amber-800 border-amber-200',
	danger: 'bg-red-100 text-red-800 border-red-200',
	info: 'bg-blue-100 text-blue-800 border-blue-200',
	neutral: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function Badge({
	children,
	variant = 'neutral',
	className,
}: {
	children: ReactNode;
	variant?: StatusMeta['variant'];
	className?: string;
}) {
	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
				VARIANTS[variant],
				className,
			)}
		>
			{children}
		</span>
	);
}

/** Convenience: build a Badge directly from a StatusMeta (label+variant). */
export function StatusBadge({
	meta,
	label,
}: {
	meta: StatusMeta;
	label?: string;
}) {
	return <Badge variant={meta.variant}>{label ?? meta.label}</Badge>;
}
