'use client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search, X } from 'lucide-react';

/**
 * <SearchField> — reusable search input with a leading search icon and an
 * optional clear button. Used across all tables and dialogs that need
 * client-side filtering by name / serial.
 *
 * Presentational + controlled (value/onChange) so the parent owns the filter
 * state and applies it to its own data set.
 */
export interface SearchFieldProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	/** Auto-focus on mount (useful in dialogs). */
	autoFocus?: boolean;
}

export function SearchField({
	value,
	onChange,
	placeholder = 'Buscar…',
	className,
	autoFocus,
}: SearchFieldProps) {
	return (
		<div className={cn('relative', className)}>
			<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input
				ref={autoFocus ? (el) => el?.focus() : undefined}
				type="text"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="h-8 pl-8 pr-7 text-xs"
			/>
			{value && (
				<button
					type="button"
					onClick={() => onChange('')}
					className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
					aria-label="Limpar busca"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			)}
		</div>
	);
}
