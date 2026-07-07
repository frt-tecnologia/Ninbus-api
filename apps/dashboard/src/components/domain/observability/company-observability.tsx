'use client';

import { RangeProvider, Section, TimeRangePicker, last24h, useRange } from '@/components/system';
import { Button } from '@/components/ui/button';
import { Maximize2, Minimize2 } from 'lucide-react';
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
 * re-fetches the timeline and feed. The Activity (logs) section has a
 * Maximize/Minimize toggle: maximized fetches the COMPLETE history (no time
 * filter, limit 500) so the operator can review all of the company's actions.
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
	const [activityExpanded, setActivityExpanded] = React.useState(false);

	const devices = useFetch(
		useCallback(() => deviceService.listByCompany(companyId), [companyId]),
		[companyId],
		false,
	);

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

	// Compact audit feed: last 50 entries within the selected time window.
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

	// When MAXIMIZED, fetch the COMPLETE history (no time filter, high limit).
	// Only triggered on expand so the normal page load stays cheap.
	const activityAll = useFetch(
		useCallback(
			() =>
				activityExpanded
					? observabilityService.activity({ companyId, limit: 500 })
					: Promise.resolve(null),
			[companyId, activityExpanded],
		),
		[companyId, activityExpanded],
		false,
	);

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

	// Resolve which feed to render based on the expand state.
	const expandedData = activityAll.data;
	const feedEntries = (
		activityExpanded
			? (expandedData?.data ?? [])
			: (activity.data?.data ?? [])
	) as ActivityLogEntry[];
	const feedLoading = activityExpanded ? activityAll.loading : activity.loading;

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

			{/* ── Section 3: Activity log (maximize = ALL company logs) ── */}
			<Section
				title="Atividade"
				description={
					activityExpanded
						? 'Histórico completo de ações da empresa.'
						: 'Quem fez o quê, quando — log de auditoria da empresa (período selecionado).'
				}
				action={
					<Button
						variant="ghost"
						size="sm"
						className="h-8 gap-1.5"
						onClick={() => setActivityExpanded((v) => !v)}
						aria-label={activityExpanded ? 'Minimizar' : 'Maximizar'}
					>
						{activityExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
						{activityExpanded ? 'Minimizar' : 'Maximizar'}
					</Button>
				}
			>
				{activityExpanded && (
					<div className="mb-2 px-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
						{feedEntries.length > 0
							? `${feedEntries.length} ações registradas`
							: 'Carregando histórico completo…'}
					</div>
				)}
				<div
					style={{ maxHeight: activityExpanded ? '75vh' : '20rem' }}
					className="overflow-y-auto transition-all duration-300"
				>
					<ActivityFeed entries={feedEntries} loading={feedLoading} />
				</div>
			</Section>
		</div>
	);
}
