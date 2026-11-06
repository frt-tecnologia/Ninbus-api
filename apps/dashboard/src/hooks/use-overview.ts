'use client';

import * as React from 'react';
import type { ActivityDay } from '@/components/arc/activity-heatmap/activity-heatmap';
import type { TimelineEvent } from '@/components/arc/timeline/timeline';
import {
	companyService,
	designationService,
	deviceService,
	firmwareService,
	observabilityService,
	userService,
} from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';
import { type Period, periodKey as periodKeyOf, resolvePeriod } from '@/lib/time/period';
import type { EnrichedDeployment } from '@/types/domain';
import { useAllDeployments } from './use-all-deployments';

const TIMELINE_BUCKETS = { '1h': 12, '24h': 24, '7d': 28, '30d': 30 } as const;

export interface OverviewDeploymentRow extends Record<string, unknown> {
	id: string;
	displayName?: string;
	typeName?: string;
	companyId?: string;
	company: string;
	status?: string;
	done: number;
	targets: number;
	failed: number;
	createdAt?: string | number;
}

export interface OverviewCompanyFleet {
	id: string;
	name: string;
	devices: number;
	updated: number;
}

export function useOverview() {
	const companies = useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
	);
	const devices = useQuery(
		qk.adminDevices,
		React.useCallback(() => deviceService.listAll(), []),
	);
	const users = useQuery(
		qk.adminUsers,
		React.useCallback(() => userService.list(), []),
	);
	const invites = useQuery(
		qk.adminInvites,
		React.useCallback(() => designationService.listPending(), []),
	);
	const latest = useQuery(
		qk.latestRelease('firmware-ninbus'),
		React.useCallback(() => firmwareService.latest('firmware-ninbus'), []),
	);
	const activity = useQuery(
		qk.adminActivity,
		React.useCallback(() => observabilityService.activity({ limit: 6 }), []),
	);
	const heat = useQuery(
		'activity:heat:1y',
		React.useCallback(
			() =>
				observabilityService.activity({
					limit: 200,
					from: new Date(Date.now() - 365 * 86_400_000),
					to: new Date(),
				}),
			[],
		),
	);

	const companyList = companies.data?.data ?? [];
	const deviceList = devices.data?.data ?? [];
	const { deployments, loading: depLoading, error: depError } = useAllDeployments(companyList);

	const [period, setPeriod] = React.useState<Period | null>({
		kind: 'relative',
		preset: '30d',
	});
	const [heatDay, setHeatDay] = React.useState<string | null>(null);

	const buckets = period?.kind === 'relative' ? (TIMELINE_BUCKETS[period.preset] ?? 30) : 30;
	const from = period ? resolvePeriod(period).from : null;
	const to = period ? resolvePeriod(period).to : null;
	const timeline = useQuery(
		`timeline:${period ? periodKeyOf(period) : 'none'}`,
		React.useCallback(
			() =>
				from && to
					? observabilityService.deploymentTimeline({ from, to, buckets })
					: Promise.resolve(null),
			[from, to, buckets],
		),
	);

	const online = deviceList.filter((d) =>
		['online', 'connected'].includes(d.connectionStatus ?? ''),
	).length;
	const activeDeployments = deployments.filter((d) =>
		['pending', 'in_progress'].includes(d.status),
	);
	const failedTargets = deployments.reduce((sum, d) => sum + (d.statistics?.failed ?? 0), 0);
	const totalTargets = deployments.reduce((sum, d) => sum + (d.statistics?.totalTargets ?? 0), 0);

	const chart = React.useMemo(() => {
		const data = timeline.data?.data ?? [];
		const step = Math.max(1, Math.ceil(data.length / 6));
		return data.map((b, i) => ({
			key: `bucket${i}`,
			label: new Date(b.start).toLocaleString('pt-BR', {
				timeZone: 'America/Sao_Paulo',
				month: 'short',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			}),
			axisLabel: i % step === 0 ? undefined : undefined,
			values: { assigned: b.assigned, installed: b.installed },
		}));
	}, [timeline.data]);

	const timelineTotals = React.useMemo(() => {
		const data = timeline.data?.data ?? [];
		return data.reduce(
			(acc, b) => ({
				assigned: acc.assigned + b.assigned,
				installed: acc.installed + b.installed,
				failed: acc.failed + b.failed,
				canceled: acc.canceled + b.canceled,
			}),
			{ assigned: 0, installed: 0, failed: 0, canceled: 0 },
		);
	}, [timeline.data]);

	const latestVersion = latest.data?.data?.version ?? null;
	const onLatest = latestVersion
		? deviceList.filter((d) => d.firmwareVersion === latestVersion).length
		: 0;

	const heatDays: ActivityDay[] = React.useMemo(() => {
		const rows = heat.data?.data ?? [];
		if (!rows.length) return [];
		const byDay = new Map<string, number>();
		for (const e of rows) {
			const day = new Date(e.createdAt).toLocaleDateString('sv-SE', {
				timeZone: 'America/Sao_Paulo',
			});
			byDay.set(day, (byDay.get(day) ?? 0) + 1);
		}
		const days = [...byDay.keys()].sort();
		const out: ActivityDay[] = [];
		for (
			let d = new Date(`${days[0]}T12:00:00Z`);
			d <= new Date();
			d = new Date(d.getTime() + 86_400_000)
		) {
			const key = d.toISOString().slice(0, 10);
			out.push({ date: key, count: byDay.get(key) ?? 0 });
		}
		return out;
	}, [heat.data]);

	const dayEvents = React.useMemo(() => {
		if (!heatDay) return null;
		return (heat.data?.data ?? []).filter(
			(e) =>
				new Date(e.createdAt).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) ===
				heatDay,
		);
	}, [heatDay, heat.data]);

	const events: TimelineEvent[] = (activity.data?.data ?? []).map((e) => ({
		id: String(e.id),
		at: e.createdAt,
		actor: e.actorEmail ?? undefined,
		title: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`,
		meta: e.entityType,
	}));

	const deploymentRows: OverviewDeploymentRow[] = deployments.map((r: EnrichedDeployment) => ({
		id: String(r.id),
		displayName: r.displayName,
		typeName: r.typeName ?? r.type ?? '',
		companyId: r.companyId,
		company: companyList.find((c) => c.id === r.companyId)?.name ?? '',
		status: r.status,
		done: r.statistics?.finished ?? 0,
		targets: r.statistics?.totalTargets ?? 0,
		failed: r.statistics?.failed ?? 0,
		createdAt: r.createdAt,
	}));

	const companyFleet: OverviewCompanyFleet[] = companyList.slice(0, 6).map((c) => {
		const ds = deviceList.filter((d) => d.companyId === c.id);
		const updated = latestVersion
			? ds.filter((d) => d.firmwareVersion === latestVersion).length
			: 0;
		return { id: c.id, name: c.name, devices: ds.length, updated };
	});

	return {
		companies: { list: companyList, loading: companies.loading },
		devices: { list: deviceList, loading: devices.loading },
		users: { count: users.data?.data.length ?? 0, loading: users.loading },
		invites: { count: invites.data?.data.length ?? 0 },
		deployments: {
			rows: deploymentRows,
			active: activeDeployments,
			failedTargets,
			totalTargets,
			loading: depLoading,
			error: depError,
		},
		timeline: {
			chart,
			totals: timelineTotals,
			loading: timeline.loading,
			hasData: !!timeline.data,
		},
		fleet: { latestVersion, onLatest, byCompany: companyFleet, totalCompanies: companyList.length },
		activity: { events, heatDays, dayEvents, heatDay, setHeatDay, loading: heat.loading },
		period,
		setPeriod,
		online,
	};
}
