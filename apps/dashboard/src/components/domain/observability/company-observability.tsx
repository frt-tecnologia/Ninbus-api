'use client';

import { RangeProvider, Section, TimeRangePicker, last24h, useRange } from '@/components/system';
import { useFetch } from '@/hooks/useFetch';
import {
	type ActivityLogEntry,
	type SessionBand,
	deviceService,
	observabilityService,
} from '@/lib/api';
import * as React from 'react';
import { useCallback } from 'react';
import { ActivityFeed } from './activity-feed';
import { ConnectionTimeline } from './connection-timeline';
import { DeviceConnectionList } from './device-connection-list';
import { GroupOrganizer } from './group-organizer';

/**
 * <CompanyObservability> — the CONTAINER for the company observability page.
 *
 * Wires the three sections to the shared RangeProvider so a range change
 * re-fetches the timeline and feed. Holds the focused-device state shared
 * between the timeline and the device list (clicking a device focuses its lane).
 *
 * This is a CLIENT container: it fetches via the same-origin proxy and composes
 * the presentational children. The page that renders it just passes a companyId.
 */
export function CompanyObservability({ companyId }: { companyId: string }) {
	return (
		<RangeProvider initial={last24h()}>
			<ObservabilityBody companyId={companyId} />
		</RangeProvider>
	);
}

function ObservabilityBody({ companyId }: { companyId: string }) {
	const { range } = useRange();
	const [focusedDeviceId, setFocusedDeviceId] = React.useState<string | null>(null);

	// Devices of this company (for the side list — not range-dependent).
	const devices = useFetch(
		useCallback(() => deviceService.listByCompany(companyId), [companyId]),
		[companyId],
		false,
	);

	// Connection timeline sessions for the selected range.
	const connections = useFetch(
		useCallback(
			() =>
				observabilityService.connections({
					companyId,
					from: range.from,
					to: range.to,
					view: 'session',
				}),
			[companyId, range.from, range.to],
		),
		[companyId, range.from, range.to],
		false,
	);

	// Audit feed for this company in the selected range.
	const activity = useFetch(
		useCallback(
			() =>
				observabilityService.activity({
					companyId,
					from: range.from,
					to: range.to,
					limit: 50,
				}),
			[companyId, range.from, range.to],
		),
		[companyId, range.from, range.to],
		false,
	);

	// Aggregated categories for this company (group organizer).
	const categories = useFetch(
		useCallback(() => observabilityService.categories({ companyId }), [companyId]),
		[companyId],
		false,
	);

	const sessions =
		connections.data?.view === 'session' ? (connections.data.data as SessionBand[]) : [];
	const deviceItems = (devices.data?.data ?? []).map((d) => ({
		id: d.id,
		name: d.name,
		hawkbitTargetId: d.hawkbitTargetId ?? null,
		serialDisplay: d.serialDisplay ?? null,
		connectionStatus: d.connectionStatus ?? null,
		lastSeenAt: d.lastSeenAt ?? null,
	}));

	return (
		<div className="space-y-4">
			{/* ── Section 1: Connectivity ─────────────────────────────── */}
			<Section
				title="Conectividade"
				description="Sessões online dos dispositivos no período selecionado."
				action={<TimeRangePicker />}
			>
				<div className="grid gap-px bg-border lg:grid-cols-[1fr_280px]">
					<div className="bg-card p-3">
						{connections.error ? (
							<p className="py-8 text-center text-xs text-muted-foreground">
								Falha ao carregar conectividade: {connections.error}
							</p>
						) : (
							<ConnectionTimeline
								sessions={sessions}
								from={range.from}
								to={range.to}
								focusedDeviceId={focusedDeviceId}
								loading={connections.loading}
							/>
						)}
					</div>
					<div className="bg-card">
						<header className="border-b border-border px-3 py-2">
							<h3 className="text-xs font-semibold text-foreground">Dispositivos</h3>
							<p className="text-[10px] text-muted-foreground">Ordenados por último visto</p>
						</header>
						<DeviceConnectionList
							devices={deviceItems}
							focusedDeviceId={focusedDeviceId}
							onFocus={setFocusedDeviceId}
							loading={devices.loading}
						/>
					</div>
				</div>
			</Section>

			{/* ── Section 2: Groups ───────────────────────────────────── */}
			<Section
				title="Grupos"
				description="Garagens, linhas, regiões e demais agrupamentos de dispositivos."
			>
				<GroupOrganizer
					companyId={companyId}
					categories={categories.data?.data ?? []}
					loading={categories.loading}
				/>
			</Section>

			{/* ── Section 3: Activity log ─────────────────────────────── */}
			<Section
				title="Atividade"
				description="Quem fez o quê, quando — log de auditoria da empresa."
			>
				<ActivityFeed
					entries={(activity.data?.data ?? []) as ActivityLogEntry[]}
					loading={activity.loading}
				/>
			</Section>
		</div>
	);
}
