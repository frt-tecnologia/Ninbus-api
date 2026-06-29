import * as React from 'react';
import { cn } from '@/lib/utils';
import {
	type SignalToken,
	type SignalShape,
	TONE_TEXT,
} from '@/lib/design/tokens';

/**
 * <Signal> — status rendered as a TELEMETRY STRIP, not a tag cloud.
 *
 * The shape carries the state's nature; the tone carries severity. A `live`
 * token pulses gently (online dot, downloading bar). Components pass a resolved
 * `SignalToken` from `lib/design/tokens.ts` (e.g. `connectionSignal('online')`)
 * so status→visual mapping lives in ONE place.
 *
 * Shapes: dot (ok) · ring (pending/unknown) · square (active/canceled) ·
 * diamond (installing) · slash (fault). Defined as CSS classes in globals.css.
 */
type SignalProps = {
	token: SignalToken;
	/** Show only the glyph (no label) — dense tables. Defaults to false. */
	glyphOnly?: boolean;
	/** Size of the glyph. */
	size?: 'sm' | 'md';
	className?: string;
};

export function Signal({ token, glyphOnly, size = 'md', className }: SignalProps) {
	const shapeClass = SHAPE_CLASS[token.shape];
	return (
		<span
			className={cn(
				'inline-flex items-center gap-2',
				TONE_TEXT[token.tone],
				className,
			)}
			role="img"
			aria-label={token.label}
		>
			<span
				className={cn(
					'sig',
					shapeClass,
					token.live && 'sig-live',
					size === 'sm' && 'scale-90',
				)}
				aria-hidden
			/>
			{!glyphOnly && (
				<span className="text-xs font-medium">{token.label}</span>
			)}
		</span>
	);
}

/** The bare glyph — for inline use inside table cells / dense grids. */
export function SignalDot({
	token,
	className,
}: {
	token: SignalToken;
	className?: string;
}) {
	return (
		<span
			className={cn(
				'sig',
				SHAPE_CLASS[token.shape],
				token.live && 'sig-live',
				TONE_TEXT[token.tone],
				className,
			)}
			role="img"
			aria-label={token.label}
		/>
	);
}

export const SHAPE_CLASS: Record<SignalShape, string> = {
	dot: 'sig-dot',
	ring: 'sig-ring',
	square: 'sig-square',
	diamond: 'sig-diamond',
	slash: 'sig-slash',
};
