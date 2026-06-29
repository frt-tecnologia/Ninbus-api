import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * <Id> — render a MACHINE IDENTIFIER in monospace.
 *
 * This is the single most distinctive, domain-authentic typographic choice in
 * the dashboard: serials, hawkBit target IDs, versions, UUIDs and keys read as
 * CODE, not prose. A frosted, slightly-muted surface + tabular figures + a
 * faint leading slash convey "this is a system value".
 *
 * Optional `copy` makes it click-to-copy (delegates to <Copyable>).
 */
type IdProps = {
	value: React.ReactNode;
	/** Render the value truncated with a copy affordance. */
	copy?: boolean;
	/** Shorten very long UUIDs by default (keep first 8 chars). */
	truncate?: boolean;
	/** Prefix shown muted before the value, e.g. "SM-" */
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
				'inline-flex items-baseline gap-1 font-mono text-[0.8125rem] tabular-nums tracking-tight',
				className,
			)}
			{...rest}
		>
			{prefix && (
				<span className="text-muted-foreground/60">{prefix}</span>
			)}
			<span className="text-foreground/90">{display}</span>
			{copy && text && <CopyGlyph value={text} />}
		</span>
	);
}

/** Lightweight inline copy glyph (avoids pulling a clipboard lib). */
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
			className="ml-0.5 text-[0.65rem] text-muted-foreground/50 transition-colors hover:text-foreground"
		>
			{done ? '✓' : '⧉'}
		</button>
	);
}
