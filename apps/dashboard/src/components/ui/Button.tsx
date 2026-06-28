import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
	primary: 'bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-500',
	secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 focus-visible:ring-gray-400',
	danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
	ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400',
	outline:
		'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400',
};

const SIZES: Record<Size, string> = {
	sm: 'h-8 px-3 text-xs',
	md: 'h-10 px-4 text-sm',
	lg: 'h-11 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
	loading?: boolean;
	children: ReactNode;
}

export function Button({
	variant = 'primary',
	size = 'md',
	loading = false,
	disabled,
	className,
	children,
	...rest
}: ButtonProps) {
	return (
		<button
			className={cn(
				'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
				'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
				'disabled:cursor-not-allowed disabled:opacity-50',
				VARIANTS[variant],
				SIZES[size],
				className,
			)}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			{...rest}
		>
			{loading && <Spinner className="h-4 w-4" />}
			{children}
		</button>
	);
}

function Spinner({ className }: { className?: string }) {
	return (
		<svg
			className={cn('animate-spin', className)}
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle
				className="opacity-25"
				cx="12"
				cy="12"
				r="10"
				stroke="currentColor"
				strokeWidth="4"
			/>
			<path
				className="opacity-75"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
			/>
		</svg>
	);
}
