import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
	'inline-flex items-center rounded-full px-2.5 py-0.5 t-badge transition-colors focus:outline-none',
	{
		variants: {
			variant: {
				default: 'bg-frt-blue-soft text-frt-blue',
				secondary: 'bg-bg2 text-ink-2',
				outline: 'bg-surface-soft text-ink-2 shadow-e1',
				destructive: 'bg-frt-red-soft text-frt-red',
				success: 'bg-frt-green-soft text-frt-green',
			},
		},
		defaultVariants: { variant: 'default' },
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
