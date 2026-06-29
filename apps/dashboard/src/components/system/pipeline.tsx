import * as React from 'react';
import { cn } from '@/lib/utils';
import { DEPLOYMENT_PIPELINE, type PipelineStage } from '@/lib/design/tokens';
import { TONE_TEXT } from '@/lib/design/tokens';
import { SHAPE_CLASS } from './signal';

/**
 * <Pipeline> — the SIGNATURE component of the dashboard.
 *
 * A deployment is rendered as an OTA FLOW: Atribuído → Baixando → Instalando →
 * Instalando → Instalado, with each stage a node and counts flowing along the
 * connectors. This is what OTA actually MEANS (a firmware funnel), as opposed
 * to the generic "3 completed" count card. Reads like a factory/CI conveyor.
 *
 * `counts` maps stage.phase → number of devices currently at that stage; the
 * filled width of each connector reflects the fraction that has progressed.
 */
type PipelineProps = {
	/** Per-stage counts. Missing stages render as 0. */
	counts?: Record<string, number>;
	/** Custom stage order/labels; defaults to the canonical OTA funnel. */
	stages?: PipelineStage[];
	className?: string;
};

export function Pipeline({ counts = {}, stages = DEPLOYMENT_PIPELINE, className }: PipelineProps) {
	const total = stages.reduce((sum, s) => sum + (counts[s.phase] ?? 0), 0) || 1;

	return (
		<div className={cn('flex items-stretch gap-0 overflow-x-auto', className)}>
			{stages.map((stage, i) => {
				const n = counts[stage.phase] ?? 0;
				const isLast = i === stages.length - 1;
				return (
					<React.Fragment key={stage.phase}>
						<div className="flex min-w-[7rem] flex-col gap-1.5">
							<div
								className={cn(
									'flex items-center gap-1.5 text-[0.7rem] font-medium uppercase tracking-wide',
									TONE_TEXT[stage.tone],
								)}
							>
								<span className={cn('sig sig-dot', TONE_TEXT[stage.tone])} aria-hidden />
								{stage.label}
							</div>
							<div className="font-mono text-2xl font-semibold tabular-nums text-foreground">
								{n}
							</div>
							<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
								<div
									className={cn('h-full rounded-full', TONE_BG_BAR[stage.tone])}
									style={{ width: `${(n / total) * 100}%` }}
								/>
							</div>
						</div>
						{!isLast && (
							<div
								className="mx-2 mb-4 mt-auto h-px flex-1 self-end bg-border"
								aria-hidden
							/>
						)}
					</React.Fragment>
				);
			})}
		</div>
	);
}

const TONE_BG_BAR: Record<string, string> = {
	ok: 'bg-signal-ok',
	busy: 'bg-signal-busy',
	fault: 'bg-signal-fault',
	idle: 'bg-signal-idle',
	info: 'bg-signal-info',
};
