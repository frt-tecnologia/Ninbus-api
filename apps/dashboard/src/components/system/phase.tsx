import * as React from 'react';
import { cn } from '@/lib/utils';
import { phaseSignal } from '@/lib/design/tokens';
import { Signal } from './signal';

/**
 * <Phase> — a single deployment-phase chip (soft-toned, shape-led).
 * Thin wrapper over <Signal> resolving the OTA phase token by name.
 */
export function Phase({
	phase,
	glyphOnly,
	className,
}: {
	phase: string;
	glyphOnly?: boolean;
	className?: string;
}) {
	return (
		<Signal
			token={phaseSignal(phase)}
			glyphOnly={glyphOnly}
			className={cn('rounded-md bg-muted/40 px-1.5 py-0.5', className)}
		/>
	);
}
