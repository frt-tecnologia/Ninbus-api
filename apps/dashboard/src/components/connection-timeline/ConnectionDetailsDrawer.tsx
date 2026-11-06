'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';
import s from './ConnectionDetailsDrawer.module.css';
import { elapsed, stateLabels } from './model';
import type { ConnectionSegment, TimelineDevice, TimelineRecord } from './types';

interface Props<T extends TimelineDevice> {
	record: TimelineRecord<T> | null;
	onClose: () => void;
	onFocusDevice?: (device: T) => void;
	onManage?: (device: T) => void;
	selectedSegment?: ConnectionSegment | null;
	children?: ReactNode;
	timeZone?: string;
	locale?: string;
}

export function ConnectionDetailsDrawer<T extends TimelineDevice>({
	record,
	onClose,
	onFocusDevice,
	onManage,
	selectedSegment,
	children,
	timeZone = 'America/Sao_Paulo',
	locale = 'pt-BR',
}: Props<T>) {
	const item = useDrawerItem(record);
	const date = new Intl.DateTimeFormat(locale, {
		timeZone,
		day: '2-digit',
		month: '2-digit',
	});
	const time = new Intl.DateTimeFormat(locale, {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
	});
	const stamp = (at: number) => `${date.format(at)}, ${time.format(at)}`;
	return (
		<Drawer
			open={record !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DrawerContent
				title={item?.device.name ?? 'Dispositivo'}
				description={item?.device.companyName}
			>
				{item && (
					<div className={s.content}>
						<div className={s.identity}>{item.device.subtitle ?? item.device.id}</div>
						<div className={s.summary}>
							{(['online', 'offline', 'unknown'] as const).map((state) => (
								<div key={state}>
									<span>
										<i className={s[state]} />
										{stateLabels[state]}
									</span>
									<strong>
										{elapsed(
											state === 'online'
												? item.onlineMs
												: state === 'offline'
													? item.offlineMs
													: item.unknownMs,
										)}
									</strong>
								</div>
							))}
						</div>
						{children}
						<ol className={s.intervals}>
							{item.segments.map((segment) => (
								<li
									key={`${segment.start}:${segment.state}`}
									className={selectedSegment?.start === segment.start ? s.selected : undefined}
								>
									<i className={s[segment.state]} />
									<div>
										<strong>{stateLabels[segment.state]}</strong>
										<span>
											{stamp(segment.start)} → {stamp(segment.end)}
										</span>
									</div>
									<small>{elapsed(segment.end - segment.start)}</small>
								</li>
							))}
						</ol>
						{(onFocusDevice || onManage) && (
							<div className={s.actions}>
								{onFocusDevice && (
									<Button variant="secondary" onClick={() => onFocusDevice(item.device)}>
										Ver só este dispositivo
									</Button>
								)}
								{onManage && <Button onClick={() => onManage(item.device)}>Gerenciar</Button>}
							</div>
						)}
					</div>
				)}
			</DrawerContent>
		</Drawer>
	);
}
