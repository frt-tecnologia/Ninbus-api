'use client';

import { type ReactNode, useState } from 'react';
import { Alert } from '@/components/arc/alert/alert';
import { Button } from '@/components/arc/button/button';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import { ConnectionDetailsDrawer } from './ConnectionDetailsDrawer';
import s from './ConnectionHistoryCard.module.css';
import { ConnectionTimeline } from './ConnectionTimeline';
import type {
	ConnectionSegment,
	ConnectionTimelineProps,
	TimelineDevice,
	TimelineRecord,
} from './types';

export interface ConnectionHistoryCardProps<T extends TimelineDevice>
	extends ConnectionTimelineProps<T> {
	title?: string;

	totalCount?: number;

	titleAccessory?: ReactNode;

	headerActions?: ReactNode;

	filters?: ReactNode;

	onFocusDevice?: (device: T) => void;

	onManageDevice?: (device: T) => void;

	deviceDetails?: (device: T) => ReactNode;

	loading?: boolean;

	error?: string | null;

	onRetry?: () => void;
}

export function ConnectionHistoryCard<T extends TimelineDevice>({
	title = 'ConexÃ£o',

	totalCount,

	titleAccessory,

	headerActions,

	filters,

	onFocusDevice,

	onManageDevice,

	deviceDetails,
	loading = false,
	error,
	onRetry,

	onDeviceSelect,

	className,

	...timeline
}: ConnectionHistoryCardProps<T>) {
	const [selectionState, setSelection] = useState<{
		record: TimelineRecord<T>;
		context: string;

		segment?: ConnectionSegment;
	} | null>(null);

	const selectionContext = `${timeline.range[0]}:${timeline.range[1]}:${timeline.resetKey ?? ''}`;
	const selection = selectionState?.context === selectionContext ? selectionState : null;

	const count = totalCount ?? timeline.rows.filter((row) => row.kind === 'device').length;

	return (
		<section className={[s.card, className].filter(Boolean).join(' ')} aria-label={title}>
			<header className={s.header}>
				<div className={s.title}>
					<h2>{title}</h2>

					<span>{count.toLocaleString(timeline.locale ?? 'pt-BR')}</span>

					{titleAccessory}
				</div>

				{headerActions && <div className={s.actions}>{headerActions}</div>}
			</header>

			{filters && <div className={s.filters}>{filters}</div>}

			{error ? (
				<div className={s.feedback}>
					<Alert tone="danger" title="Não foi possível carregar o histórico">
						{error}
					</Alert>
					{onRetry && (
						<Button variant="secondary" onClick={onRetry}>
							Tentar novamente
						</Button>
					)}
				</div>
			) : loading ? (
				<div className={s.feedback} aria-busy="true">
					<Skeleton label="Carregando histórico" lines={10} />
				</div>
			) : (
				<ConnectionTimeline
					{...timeline}
					onDeviceSelect={(record, segment) => {
						setSelection({ record, segment, context: selectionContext });

						onDeviceSelect?.(record, segment);
					}}
				/>
			)}

			<ConnectionDetailsDrawer
				record={selection?.record ?? null}
				selectedSegment={selection?.segment}
				onClose={() => setSelection(null)}
				timeZone={timeline.timeZone}
				locale={timeline.locale}
				onFocusDevice={
					onFocusDevice
						? (device) => {
								setSelection(null);

								onFocusDevice(device);
							}
						: undefined
				}
				onManage={onManageDevice}
			>
				{selection && deviceDetails?.(selection.record.device)}
			</ConnectionDetailsDrawer>
		</section>
	);
}
