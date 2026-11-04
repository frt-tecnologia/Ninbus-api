'use client';
/**
 * Company detail — thin composition. All data + CRUD live in the tab
 * components (`company-tabs.tsx`), each owning its queries (lazy: a tab
 * only fetches when visited). This page owns the shell pieces: header,
 * tab host and the detail Surfaces (drawer on desktop, bottom sheet ≤640px).
 */

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import {
	CompanyFormHost,
	type CompanyFormKind,
	CompanySectionHost,
	type CompanySectionId,
	companySectionLabel,
	DeviceQuick,
	useCompanyDevices,
	useCompanyGroups,
} from '@/components/arc-app/company-tabs';
import { MemberRole } from '@/components/arc-app/details';
import { PageHead } from '@/components/arc-app/page-head';
import { Alert, Button, Surface } from '@/components/arc-app/primitives';
import { companyService } from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

const FORM_TITLE: Record<CompanyFormKind, string> = {
	assign: 'Vincular dispositivos',
	register: 'Registrar dispositivo',
	group: 'Criar grupo',
	member: 'Adicionar pessoa ou convite',
	atualização: 'Preparar deploy',
};

export default function CompanyDetailPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const companyId = params.id;
	const searchParams = useSearchParams();
	const section = (searchParams.get('section') ?? 'devices') as CompanySectionId;

	const company = useQuery(
		qk.company(companyId),
		React.useCallback(() => companyService.get(companyId), [companyId]),
	);
	// Tab counters — shared cache keys with the tabs themselves, so the
	// header never triggers extra requests beyond what the tabs already did.
	const devices = useCompanyDevices(companyId);
	const groups = useCompanyGroups(companyId);
	const deviceList = devices.data?.data ?? [];

	const [form, setForm] = React.useState<CompanyFormKind | null>(null);
	const [memberDetail, setMemberDetail] = React.useState<string | null>(null);
	const [deviceDetail, setDeviceDetail] = React.useState<string | null>(null);

	const c = company.data;
	const members = useQuery(
		qk.companyMembers(companyId),
		React.useCallback(
			() => import('@/lib/api').then((m) => m.memberService.list(companyId)),
			[companyId],
		),
	);
	const member = (members.data?.data ?? []).find((m) => m.id === memberDetail) ?? null;
	const device = deviceList.find((d) => d.id === deviceDetail) ?? null;

	if (company.error)
		return (
			<>
				<PageHead title="Empresa" />
				<Alert tone="danger" title="Empresa não encontrada ou você não tem acesso." />
			</>
		);

	return (
		<>
			<PageHead
				title={c?.name ?? 'Carregando…'}
				description="Observabilidade, frota, membros e diretrizes da empresa."
				crumbs={[
					{ label: 'Empresas', href: '/companies' },
					{ label: c?.name ?? '…' },
					{ label: companySectionLabel(section) },
				]}
			/>
			<CompanySectionHost
				companyId={companyId}
				section={section}
				onForm={setForm}
				onDevice={setDeviceDetail}
				onMember={setMemberDetail}
			/>

			{/* Member role drawer — role select + removal (hold) */}
			<Surface open={!!memberDetail} onClose={() => setMemberDetail(null)} title="Gerenciar acesso">
				{member && (
					<MemberRole
						companyId={companyId}
						membership={member}
						done={() => setMemberDetail(null)}
					/>
				)}
			</Surface>

			{/* Create/edit forms — support lists load only while open */}
			<Surface
				open={!!form}
				onClose={() => setForm(null)}
				title={form ? FORM_TITLE[form] : 'Novo registro'}
			>
				{form && (
					<CompanyFormHost companyId={companyId} kind={form} onClose={() => setForm(null)} />
				)}
			</Surface>

			{/* Device quick drawer — rename in place + deploy */}
			<Surface
				open={!!deviceDetail}
				onClose={() => setDeviceDetail(null)}
				title={device?.name ?? 'Dispositivo'}
				description={device?.serialDisplay ?? device?.serialNumber ?? ''}
			>
				{device && (
					<DeviceQuick
						device={device}
						companyId={companyId}
						onOpenFull={() => router.push(`/devices?detail=${device.id}`)}
						onDeploy={() => setForm('atualização')}
					/>
				)}
			</Surface>
		</>
	);
}
