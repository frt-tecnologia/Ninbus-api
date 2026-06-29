import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <Id> — render a MACHINE IDENTIFIER in monospace.
 *
 * The single most distinctive, domain-authentic typographic choice: serials,
 * hawkBit target IDs, versions, UUIDs and keys read as CODE, not prose. A
 * faint muted prefix conveys "this is a system value".
 *
 * `copy` adds a click-to-copy glyph.
 */
type IdProps = {
	value: React.ReactNode;
	copy?: boolean;
	truncate?: boolean;
	prefix?: string;
	className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'value'>;

export function Id({
	value,
	copy,
	truncate,
	prefix,
	className,
	...rest
}: IdProps) {
	const text = typeof value === 'string' ? value : null;
	const display = truncate && text && text.length > 13
		? `${text.slice(0, 8)}…`
		: value;

	return (
		<span
			className={cn(
				'inline-flex items-baseline gap-1 font-mono text-sm tabular-nums tracking-tight',
				className,
			)}
			{...rest}
		>
			{prefix && <span className="text-muted-foreground/60">{prefix}</span>}
			<span className="text-foreground/90">{display}</span>
			{copy && text && <CopyGlyph value={text} />}
		</span>
	);
}

function CopyGlyph({ value }: { value: string }) {
	const [done, setDone] = React.useState(false);
	return (
		<button
			type="button"
			aria-label="Copiar"
			onClick={(e) => {
				e.stopPropagation();
				void navigator.clipboard?.writeText(value);
				setDone(true);
				window.setTimeout(() => setDone(false), 1200);
			}}
			className="ml-0.5 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
		>
			{done ? '✓' : '⧉'}
		</button>
	);
}
