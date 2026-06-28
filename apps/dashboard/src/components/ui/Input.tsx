import {
	type InputHTMLAttributes,
	type SelectHTMLAttributes,
	type ReactNode,
	forwardRef,
} from 'react';
import { cn } from '@/lib/utils';

const base =
	'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
	'placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 ' +
	'focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-gray-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
	function Input({ className, ...rest }, ref) {
		return <input ref={ref} className={cn(base, className)} {...rest} />;
	},
);

export const Select = forwardRef<
	HTMLSelectElement,
	SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
	return (
		<select ref={ref} className={cn(base, className)} {...rest}>
			{children}
		</select>
	);
});

export function Field({
	label,
	htmlFor,
	error,
	hint,
	children,
}: {
	label: string;
	htmlFor?: string;
	error?: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className="space-y-1">
			<label
				htmlFor={htmlFor}
				className="block text-sm font-medium text-gray-700"
			>
				{label}
			</label>
			{children}
			{hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
			{error && <p className="text-xs text-red-600">{error}</p>}
		</div>
	);
}
