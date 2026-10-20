'use client';

import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import * as React from 'react';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
	Kpi,
	last1h,
	last7d,
	last24h,
	last30d,
	RangeProvider,
	Section,
	SignalDot,
	useRange,
} from '@/components/system';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import {
	type ActivityLogEntry,
	deviceService,
	observabilityService,
	type SessionBand,
} from '@/lib/api';
import { connectionSignal } from '@/lib/design/tokens';
import { cn } from '@/lib/utils';
import { ActivityFeed } from './activity-feed';
import { ConnectionTimeline } from './connection-timeline';
import { DeviceConnectionList } from './device-connection-list';
import { GroupOrganizer } from './group-organizer';

/**
 * <CompanyObservability> — the company DASH, laid out on the FRT rhythm
 * (fixed vertical order):
 *
 *   1. Header            (pb 22)  — in the page, above this container
 *   2. Device strip      (mb 16)  — horizontal chips, one per device
 *   3. Hero button       (mb 14)  — "Sincronizar agora" (force hawkBit sync)
 *   4. Pill bar          (mb 22)  — time window presets as segmented pills
 *   5. KPIs (3 col)      (mb 22)  — frota, online agora, sessões no período
 *   6. Main panel        (r-xl)   — connection timeline (the signature panel)
 *
 * Shell: max 720px — a field console, read at arm's length, not a wall of
 * widgets. Groups + audit sections follow after the main panel.
 */
export function CompanyObservability({ companyId }: { companyId: string }) {
	return (
		<RangeProvider initial={last24h()}>
			<ObservabilityBody companyId={companyId} />
		</RangeProvider>
	);
}

function ObservabilityBody({ companyId }: { companyId: string }) {
	const { range, setRange } = useRange();
	const [focusedDeviceId, setFocusedDeviceId] = React.useState<string | null>(null);
	const [activityExpanded, setActivityExpanded] = React.useState(false);
	const [syncing, setSyncing] = React.useState(false);

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

	// KPIs — real derived numbers, no invention.
	const onlineNow = deviceItems.filter((d) =>
		['online', 'connected'].includes(d.connectionStatus ?? ''),
	).length;

	// Hero — force-refresh every device's connection status from hawkBit.
	async function syncNow() {
		setSyncing(true);
		try {
			await deviceService.syncAll();
			toast.success('Frota sincronizada com o hawkBit.');
			devices.refetch();
			connections.refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Falha ao sincronizar.');
		} finally {
			setSyncing(false);
		}
	}

	// Resolve which feed to render based on the expand state.
	const expandedData = activityAll.data;
	const feedEntries = (
		activityExpanded ? (expandedData?.data ?? []) : (activity.data?.data ?? [])
	) as ActivityLogEntry[];
	const feedLoading = activityExpanded ? activityAll.loading : activity.loading;

	return (
		<div className="mx-auto w-full max-w-[720px]">
			{/* ── 2. Device strip (mb 16) ─────────────────────────────── */}
			<nav aria-label="Dispositivos da empresa" className="mb-4">
				<DeviceStrip
					devices={deviceItems}
					focusedDeviceId={focusedDeviceId}
					onFocus={setFocusedDeviceId}
					loading={devices.loading}
				/>
			</nav>

			{/* ── 3. Hero button (mb 14) ──────────────────────────────── */}
			<Button
				variant="default"
				size="lg"
				onClick={syncNow}
				disabled={syncing}
				className="mb-3.5 h-12 w-full rounded-full text-[15px]"
			>
				<RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
				{syncing ? 'Sincronizando…' : 'Sincronizar agora'}
			</Button>

			{/* ── 4. Pill bar — time window (mb 22) ───────────────────── */}
			<fieldset className="mb-[22px] flex flex-wrap items-center gap-1.5 border-0 p-0">
				{PRESET_PILLS.map((p) => {
					const active = range.label === p.label;
					return (
						<button
							key={p.label}
							type="button"
							onClick={() => setRange(p.build())}
							aria-pressed={active}
							className={cn(
								't-badge rounded-full px-3.5 py-1.5 transition-colors',
								active ? 'bg-card text-ink shadow-e1' : 'text-ink-3 hover:bg-bg2 hover:text-ink-2',
							)}
						>
							{p.short}
						</button>
					);
				})}
				<span className="t-meta ml-1 text-ink-3">{range.label}</span>
			</fieldset>

			{/* ── 5. KPIs (3 col, mb 22) ──────────────────────────────── */}
			<div className="mb-[22px] grid grid-cols-3 gap-3">
				<div className="rounded-md bg-card p-4 shadow-e1">
					<Kpi label="Dispositivos" value={deviceItems.length} />
				</div>
				<div className="rounded-md bg-card p-4 shadow-e1">
					<Kpi
						label="Online agora"
						value={onlineNow}
						hint={deviceItems.length > 0 ? `de ${deviceItems.length}` : undefined}
					/>
				</div>
				<div className="rounded-md bg-card p-4 shadow-e1">
					<Kpi label="Sessões" value={sessions.length} hint="no período" />
				</div>
			</div>

			{/* ── 6. Main panel — connection timeline (r-xl) ──────────── */}
			<section
				aria-label="Linha do tempo de conectividade"
				className="rounded-xl bg-card p-4 shadow-e1 md:p-5"
			>
				<header className="mb-3 flex items-baseline justify-between">
					<h2 className="t-title text-foreground">Conectividade</h2>
					<p className="t-meta text-ink-3">{range.label}</p>
				</header>
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
			</section>

			{/* ── Beyond the rhythm: reference lists ──────────────────── */}
			<div className="mt-4">
				<DeviceListPanel
					devices={deviceItems}
					focusedDeviceId={focusedDeviceId}
					onFocus={setFocusedDeviceId}
					loading={devices.loading}
				/>
			</div>

			<div className="mt-4 space-y-4">
				{/* ── Groups ─────────────────────────────────────────────── */}
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

				{/* ── Activity log (maximize = ALL company logs) ────────── */}
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
							className="gap-1.5"
							onClick={() => setActivityExpanded((v) => !v)}
							aria-label={activityExpanded ? 'Minimizar' : 'Maximizar'}
						>
							{activityExpanded ? (
								<Minimize2 className="h-4 w-4" />
							) : (
								<Maximize2 className="h-4 w-4" />
							)}
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
		</div>
	);
}

// ── Device strip ────────────────────────────────────────────────────────

interface StripDevice {
	id: string;
	name: string;
	hawkbitTargetId: string | null;
	serialDisplay: string | null;
	connectionStatus: string | null;
	lastSeenAt: string | null;
}

/** Presets shown as pills (short labels); full label rendered beside them. */
const PRESET_PILLS = [
	{ label: 'Última hora', short: '1h', build: last1h },
	{ label: 'Últimas 24 horas', short: '24h', build: last24h },
	{ label: 'Últimos 7 dias', short: '7d', build: last7d },
	{ label: 'Últimos 30 dias', short: '30d', build: last30d },
];

/**
 * <DeviceStrip> — rhythm beat 2: the company's fleet as a horizontal strip of
 * chips (most recently seen first). Tapping a chip focuses its timeline lane.
 */
function DeviceStrip({
	devices,
	focusedDeviceId,
	onFocus,
	loading,
}: {
	devices: StripDevice[];
	focusedDeviceId: string | null;
	onFocus: (id: string | null) => void;
	loading?: boolean;
}) {
	if (loading) {
		return (
			<div className="flex gap-2 overflow-hidden">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={i} className="h-8 w-28 shrink-0 animate-pulse rounded-full bg-secondary/60" />
				))}
			</div>
		);
	}
	if (devices.length === 0) {
		return <p className="t-meta text-ink-3">Nenhum dispositivo nesta empresa.</p>;
	}
	const sorted = [...devices].sort((a, b) => {
		const ta = a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
		const tb = b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
		return tb - ta;
	});
	return (
		<ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
			{sorted.map((d) => {
				const token = connectionSignal(d.connectionStatus ?? 'unknown');
				const active = focusedDeviceId === d.id;
				return (
					<li key={d.id} className="list-none">
						<button
							type="button"
							onClick={() => onFocus?.(active ? null : d.id)}
							aria-pressed={active}
							className={cn(
								'flex h-8 shrink-0 items-center gap-2 rounded-full px-3.5 transition-colors',
								active
									? 'bg-frt-blue-soft text-frt-blue'
									: 'bg-surface-soft text-ink-2 shadow-e1 hover:bg-bg2',
							)}
						>
							<SignalDot token={token} />
							<span className="t-meta max-w-[10rem] truncate">{d.name}</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** Compact device reference list (serial + last seen) under the main panel. */
function DeviceListPanel({
	devices,
	focusedDeviceId,
	onFocus,
	loading,
}: {
	devices: StripDevice[];
	focusedDeviceId: string | null;
	onFocus: (id: string | null) => void;
	loading?: boolean;
}) {
	if (loading || devices.length === 0) return null;
	return (
		<Section flush>
			<DeviceConnectionList devices={devices} focusedDeviceId={focusedDeviceId} onFocus={onFocus} />
		</Section>
	);
}
