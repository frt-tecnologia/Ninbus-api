import * as React from 'react';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';

/**
 * <Field> — label + control wrapper for forms. Pairs with shadcn <Input> /
 * <Select>. Containerizable: pass any control as children; the label is bound
 * via htmlFor. Error text slot keeps form validation feedback consistent.
 */
type FieldProps = {
	label: React.ReactNode;
	htmlFor?: string;
	hint?: React.ReactNode;
	error?: React.ReactNode;
	required?: boolean;
	className?: string;
	children: React.ReactNode;
};

export function Field({
	label,
	htmlFor,
	hint,
	error,
	required,
	className,
	children,
}: FieldProps) {
	return (
		<div className={cn('flex flex-col gap-1.5', className)}>
			<Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
				{label}
				{required && <span className="ml-0.5 text-signal-fault">*</span>}
			</Label>
			{children}
			{hint && !error && (
				<p className="text-xs text-muted-foreground">{hint}</p>
			)}
			{error && <p className="text-xs text-signal-fault">{error}</p>}
		</div>
	);
}
