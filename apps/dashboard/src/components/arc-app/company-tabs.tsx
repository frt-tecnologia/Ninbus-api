'use client';

/** Company detail tabs — per-tab data, shared cache keys, Arc-native CRUD (docs/arc-dashboard-v2-plan.md). */

import {
	XCircle as CancelGlyph,
	Trash2 as DeleteGlyph,
	ShieldCheck as RoleGlyph,
} from 'lucide-react';
import * as React from 'react';
import { InlineEdit } from '@/components/arc/inline-edit/inline-edit';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { Timeline, type TimelineEvent } from '@/components/arc/timeline/timeline';
import {
	AssignForm,
	GroupForm,
	MemberForm,
	RegisterForm,
	RolloutForm,
} from '@/components/arc-app/forms';
import {
	Alert,
	Button,
	Collection,
	Panel,
	type Period,
	roleLabel,
	SafeAction,
	Status,
	stamp,
} from '@/components/arc-app/primitives';
import { rowActionsColumn } from '@/components/arc-app/row-actions';
import type { AggregateBucket, RolePolicy, SessionBand } from '@/lib/api';
import {
	categoryService,
	companyService,
	designationService,
	deviceService,
	firmwareService,
	memberService,
	observabilityService,
	rolePolicyService,
} from '@/lib/api';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';
import { notifyDataChanged } from '@/lib/data-events';
import { useLive } from '@/lib/sse/use-live';
import { periodKey as periodKeyOf, resolvePeriod } from '@/lib/time/period';
import type { Device } from '@/types/domain';
import s from './app.module.css';
import { Guard } from './page-head';
import { PeriodPills } from './period-controls';
import type { AnyRow } from './primitives';

export type CompanyFormKind = 'assign' | 'register' | 'group' | 'member' | 'atualização';

// ── Shared list sources (cached; consumed by tabs + forms) ─────────────

export function useCompanyDevices(companyId: string) {
	return useQuery(
		qk.companyDevices(companyId),
		React.useCallback(() => deviceService.listByCompany(companyId), [companyId]),
	);
}

export function useCompanyGroups(companyId: string) {
	return useQuery(
		qk.companyCategories(companyId),
		React.useCallback(() => categoryService.listByCompany(companyId), [companyId]),
	);
}

function useCompanies() {
	return useQuery(
		qk.adminCompanies,
		React.useCallback(() => companyService.list(), []),
	);
}

function useAllDevices() {
	return useQuery(
		qk.adminDevices,
		React.useCallback(() => deviceService.listAll(), []),
	);
}

function useReleases() {
	return useQuery(
		qk.firmwareReleases,
		React.useCallback(() => firmwareService.list(), []),
	);
}

// ── Tabs shell ─────────────────────────────────────────────────────────

export const COMPANY_SECTIONS = [
	{ id: 'devices', label: 'Dispositivos', short: 'Dispositivos' },
	{ id: 'members', label: 'Membros e convites', short: 'Membros' },
	{ id: 'groups', label: 'Grupos', short: 'Grupos' },
	{ id: 'settings', label: 'Configurações', short: 'Config.' },
	{ id: 'permissions', label: 'Permissões', short: 'Permissões' },
	{ id: 'connectivity', label: 'Conexão', short: 'Conexão' },
	{ id: 'activity', label: 'Atividade', short: 'Atividade' },
] as const;

export type CompanySectionId = (typeof COMPANY_SECTIONS)[number]['id'];

export function companySectionLabel(section: string): string {
	return COMPANY_SECTIONS.find((s) => s.id === section)?.label ?? 'Dispositivos';
}

export function CompanySectionHost({
	companyId,
	section,
	onForm,
	onDevice,
	onMember,
	children,
}: {
	companyId: string;
	section: CompanySectionId;
	onForm: (kind: CompanyFormKind) => void;
	onDevice: (deviceId: string) => void;
	onMember: (membershipId: string) => void;
	children?: React.ReactNode;
}) {
	switch (section) {
		case 'members':
			return (
				<>
					<MembersTab companyId={companyId} onMember={onMember} onForm={onForm} />
					{children}
				</>
			);
		case 'groups':
			return <GroupsTab companyId={companyId} onForm={onForm} />;
		case 'settings':
			return <SettingsTab companyId={companyId} />;
		case 'permissions':
			return <PermissionsTab companyId={companyId} />;
		case 'connectivity':
			return <ConnectivityTab companyId={companyId} onDevice={onDevice} />;
		case 'activity':
			return <ActivityTab companyId={companyId} />;
		default:
			return <DevicesTab companyId={companyId} onForm={onForm} onDevice={onDevice} />;
	}
}

// ── Devices ─────────────────────────────────────────────────────────────

function DevicesTab({
	companyId,
	onForm,
	onDevice,
}: {
	companyId: string;
	onForm: (kind: CompanyFormKind) => void;
	onDevice: (deviceId: string) => void;
}) {
	const devices = useCompanyDevices(companyId);
	const list = devices.data?.data ?? [];

	return (
		<Panel
			title="Frota da empresa"
			description="Gerencie os dispositivos vinculados a esta empresa."
			action={
				<div className={s.inline}>
					<Button variant="secondary" onClick={() => onForm('assign')}>
						Vincular dispositivos
					</Button>
					<Button variant="ghost" onClick={() => onForm('register')}>
						Registrar dispositivo
					</Button>
				</div>
			}
		>
			<Collection
				label="Dispositivos da empresa"
				rows={list.map((d) => ({ ...d }))}
				onOpenRow={(r) => onDevice(String(r.id))}
				fields={[
					{
						id: 'connectionStatus',
						label: 'Conexão',
						options: ['connected', 'disconnected', 'unknown'],
					},
					{
						id: 'status',
						label: 'Cadastro',
						options: ['accepted', 'pending', 'rejected', 'disabled'],
					},
				]}
				dateKey="lastSeenAt"
				dateMeaning="Período aplica-se à última comunicação (poll)"
				defaultSortKey="lastSeenAt"
				defaultSortDir="desc"
				columns={[
					{
						key: 'name',
						label: 'Dispositivo',
						render: (_, r) => (
							<button type="button" className={s.link} onClick={() => onDevice(String(r.id))}>
								{String(r.name)}
								<span className={`${s.cellSub} ${s.mono}`}>
									{String(r.serialDisplay ?? r.serialNumber ?? '')}
								</span>
							</button>
						),
					},
					{
						key: 'connectionStatus',
						label: 'Conexão',
						render: (v) => <Status value={String(v)} />,
					},
					{ key: 'status', label: 'Cadastro', render: (v) => <Status value={String(v)} /> },
					{ key: 'firmwareVersion', label: 'Firmware' },
					{
						key: 'lastSeenAt',
						label: 'Última comunicação',
						render: (v) => (v ? stamp(String(v)) : 'sem contato'),
					},
				]}
			/>
		</Panel>
	);
}

// ── Members + invites ──────────────────────────────────────────────────

function MembersTab({
	companyId,
	onMember,
	onForm,
}: {
	companyId: string;
	onMember: (membershipId: string) => void;
	onForm: (kind: CompanyFormKind) => void;
}) {
	const members = useQuery(
		qk.companyMembers(companyId),
		React.useCallback(() => memberService.list(companyId), [companyId]),
	);
	const invites = useQuery(
		qk.companyInvites(companyId),
		React.useCallback(() => designationService.listPending(), []),
	);
	const list = members.data?.data ?? [];
	const inviteList = (invites.data?.data ?? []).filter(
		(i) => i.companyId === companyId && !i.claimedAt,
	);

	return (
		<>
			<Panel
				title="Membros da empresa"
				description="Os papéis pertencem à empresa. Os grupos organizam dispositivos sem criar permissões paralelas."
				action={
					<Button variant="secondary" onClick={() => onForm('member')}>
						Adicionar pessoa
					</Button>
				}
			>
				<Collection
					label="Membros"
					rows={list.map((m) => ({ ...m }))}
					onOpenRow={(r) => onMember(String(r.id))}
					fields={[
						{ id: 'role', label: 'Papel', options: ['owner', 'manager', 'operator', 'observer'] },
					]}
					columns={[
						{
							key: 'name',
							label: 'Pessoa',
							render: (_, r) => (
								<button type="button" className={s.link} onClick={() => onMember(String(r.id))}>
									{String(r.name)}
									<span className={s.cellSub}>{String(r.email)}</span>
								</button>
							),
						},
						{ key: 'role', label: 'Papel' },
						rowActionsColumn<Record<string, unknown>>([
							{
								key: 'role',
								label: 'Gerenciar papel',
								icon: RoleGlyph,
								onAction: (r) => onMember(String(r.id)),
								'aria-label': (r) => `Gerenciar acesso de ${String(r.name)}`,
							},
						]),
					]}
				/>
			</Panel>
			{inviteList.length > 0 && (
				<div className={s.sectionGap}>
					<Panel
						title="Convites da empresa"
						description="Ativam no primeiro acesso do e-mail convidado."
					>
						<Collection
							label="Convites"
							rows={inviteList.map((i) => ({ ...i }))}
							onOpenRow={() => {}}
							fields={[
								{
									id: 'role',
									label: 'Papel',
									options: ['owner', 'manager', 'operator', 'observer'],
								},
							]}
							columns={[
								{ key: 'email', label: 'E-mail' },
								{ key: 'role', label: 'Papel' },
								{ key: 'createdAt', label: 'Registrado em', render: (v) => stamp(String(v)) },
								rowActionsColumn<Record<string, unknown>>([
									{
										key: 'cancel',
										label: 'Cancelar convite',
										hold: true,
										holdLabel: 'Segurar para cancelar',
										confirmedLabel: 'Cancelado',
										icon: CancelGlyph,
										onAction: async (r) => {
											await designationService.cancel(companyId, String(r.id));
											notifyDataChanged();
										},
									},
								]),
							]}
						/>
					</Panel>
				</div>
			)}
		</>
	);
}

// ── Groups (categories) — rename in place, hold-to-delete ──────────────

function GroupsTab({
	companyId,
	onForm,
}: {
	companyId: string;
	onForm: (kind: CompanyFormKind) => void;
}) {
	const groups = useCompanyGroups(companyId);
	const list = groups.data?.data ?? [];

	return (
		<Panel
			title="Grupos da empresa"
			action={
				<Button variant="secondary" onClick={() => onForm('group')}>
					Criar grupo
				</Button>
			}
		>
			<Collection
				label="Grupos"
				rows={list.map((g) => ({ ...g }))}
				fields={[
					{ id: 'type', label: 'Tipo', options: ['bus_line', 'garage', 'region', 'custom'] },
				]}
				columns={[
					{
						key: 'name',
						label: 'Grupo',
						sortable: true,
						render: (_, r) => (
							<InlineEdit
								label={`Nome do grupo ${String(r.name)}`}
								value={String(r.name)}
								variant="body"
								validate={(v) => (v.trim() ? null : 'O nome não pode ficar vazio.')}
								onSave={async (v) => {
									await categoryService.rename(companyId, String(r.id), v.trim());
									notifyDataChanged();
								}}
							/>
						),
					},
					{ key: 'type', label: 'Tipo' },
					{
						key: 'devices',
						label: 'Dispositivos',
						sortable: false,
						render: (_, r) => <GroupDeviceCount companyId={companyId} groupId={String(r.id)} />,
					},
					rowActionsColumn<Record<string, unknown>>([
						{
							key: 'delete',
							label: 'Excluir grupo',
							hold: true,
							holdLabel: 'Segurar para excluir',
							confirmedLabel: 'Excluído',
							icon: DeleteGlyph,
							onAction: async (r) => {
								await categoryService.remove(companyId, String(r.id));
								notifyDataChanged();
							},
						},
					]),
				]}
			/>
		</Panel>
	);
}

/** Device count per group — one cached request per group, shared on revisits. */
function GroupDeviceCount({ companyId, groupId }: { companyId: string; groupId: string }) {
	const members = useQuery(
		`categories:${companyId}:members:${groupId}`,
		React.useCallback(() => categoryService.listMembers(companyId, groupId), [companyId, groupId]),
	);
	const total = members.data?.total ?? members.data?.data.length ?? null;
	return <>{total === null ? '…' : total}</>;
}

// ── Settings ───────────────────────────────────────────────────────────

function SettingsTab({ companyId }: { companyId: string }) {
	const company = useQuery(
		qk.company(companyId),
		React.useCallback(() => companyService.get(companyId), [companyId]),
	);
	const c = company.data;

	return (
		<div className={s.formStack}>
			<Panel title="Identidade">
				<div className={s.formStack}>
					<InlineEdit
						label="Nome da empresa"
						value={c?.name ?? ''}
						variant="title"
						validate={(v) => (v.trim() ? null : 'O nome não pode ficar vazio.')}
						onSave={async (v) => {
							await companyService.update(companyId, { name: v.trim() });
							notifyDataChanged();
						}}
					/>
				</div>
			</Panel>
			<Panel title="Estado da empresa">
				<div className={s.formStack}>
					<Status value={c?.status} />
					<SafeAction
						key={c?.status}
						label={c?.status === 'active' ? 'suspender empresa' : 'reativar empresa'}
						danger={c?.status === 'active'}
						description={
							c?.status === 'active'
								? 'Empresas suspensas não podem receber novos vínculos. O histórico permanece disponível.'
								: 'A empresa volta a operar normalmente.'
						}
						onConfirm={async () => {
							await companyService.setStatus(companyId, {
								status: c?.status === 'active' ? 'suspended' : 'active',
							});
							notifyDataChanged();
						}}
					/>
					<SafeAction
						label="excluir empresa"
						danger
						description="Remove empresa, grupos, membros e convites. Dispositivos ficam sem empresa; o histórico de atualizações é preservado."
						onConfirm={async () => {
							await companyService.remove(companyId);
							notifyDataChanged();
						}}
					/>
				</div>
			</Panel>
			<Alert tone="info" title="Diretrizes operacionais">
				Descrições e diretrizes por empresa ainda não são suportadas pelo backend — registradas como
				lacuna.
			</Alert>
		</div>
	);
}

// ── Permissões (RBAC v2) ───────────────────────────────────────────────

const ROLE_ORDER: RolePolicy['role'][] = ['owner', 'manager', 'operator', 'observer'];

const ROLE_HINTS: Record<RolePolicy['role'], string> = {
	owner: 'Dono da empresa: exclusão, transferência e tudo do Gestor.',
	manager: 'Controla a empresa: membros, configurações, frota e releases.',
	operator: 'Opera a frota e prepara atualizações; não gerencia acesso.',
	observer: 'Consulta os dados, sem alterar a operação.',
};

const CAPABILITY_LABELS: Record<string, string> = {
	'devices.read': 'Ler dispositivos',
	'devices.write': 'Registrar e editar dispositivos',
	'devices.delete': 'Deprovisionar dispositivos',
	'groups.manage': 'Gerenciar grupos',
	'members.manage': 'Gerenciar membros',
	'atualizações.create': 'Criar atualizações',
	'atualizações.abort': 'Abortar atualizações',
	'atualizações.delete': 'Excluir atualizações',
	'releases.publish': 'Publicar firmware',
	'releases.delete': 'Excluir releases',
	'company.settings': 'Configurações da empresa',
	'company.delete': 'Excluir a empresa',
	'audit.read': 'Ler auditoria',
};

const OVERRIDE_LABELS = {
	default: 'Padrão',
	allow: 'Permitir sempre',
	deny: 'Negar sempre',
} as const;

type OverrideState = keyof typeof OVERRIDE_LABELS;

function PermissionsTab({ companyId }: { companyId: string }) {
	const policies = useQuery(
		qk.rolePolicies(companyId),
		React.useCallback(() => rolePolicyService.list(companyId), [companyId]),
	);
	const byRole = new Map((policies.data?.data ?? []).map((p) => [p.role, p]));
	const [saving, setSaving] = React.useState<string | null>(null);

	const setState = async (policy: RolePolicy, capability: string, next: OverrideState) => {
		const overrides = { ...policy.overrides };
		if (next === 'default') delete overrides[capability];
		else overrides[capability] = next === 'allow';
		setSaving(`${policy.role}:${capability}`);
		try {
			await rolePolicyService.save(companyId, policy.role, overrides);
			policies.refetch();
		} finally {
			setSaving(null);
		}
	};

	if (policies.loading && !policies.data) {
		return <Panel title="Permissões">Carregando matriz…</Panel>;
	}

	return (
		<div className={s.formStack}>
			<p className={s.footnote}>
				Padrão usa as permissões do cargo. Permitir e negar valem para esta empresa.
			</p>
			<div className={s.permissionsGrid}>
				{ROLE_ORDER.map((role) => {
					const policy = byRole.get(role);
					if (!policy) return null;
					const dirtyCount = Object.keys(policy.overrides).length;
					return (
						<Panel
							key={role}
							title={
								roleLabel(role) +
								(dirtyCount ? ` · ${dirtyCount} exceç${dirtyCount === 1 ? 'ão' : 'ões'}` : '')
							}
							description={ROLE_HINTS[role]}
						>
							<ul className={s.permissionList}>
								{Object.keys(CAPABILITY_LABELS).map((capability) => {
									const state: OverrideState =
										policy.overrides[capability] === true
											? 'allow'
											: policy.overrides[capability] === false
												? 'deny'
												: 'default';
									const effective = policy.effective.includes(capability);
									return (
										<li key={capability} className={s.permissionRow}>
											<div className={s.permissionMeta}>
												<span>{CAPABILITY_LABELS[capability]}</span>
												<span className={effective ? s.permissionOn : s.permissionOff}>
													{effective ? 'permitido' : 'negado'}
												</span>
											</div>
											<div className={s.permissionControls}>
												{(['default', 'allow', 'deny'] as const).map((option) => (
													<Button
														key={option}
														variant={state === option ? 'primary' : 'secondary'}
														size="sm"
														aria-pressed={state === option}
														disabled={saving === `${role}:${capability}`}
														onClick={() => setState(policy, capability, option)}
													>
														{OVERRIDE_LABELS[option]}
													</Button>
												))}
											</div>
										</li>
									);
								})}
							</ul>
						</Panel>
					);
				})}
			</div>
		</div>
	);
}
// ── Connectivity + Activity ────────────────────────────────────────────

function ConnectivityTab({
	companyId,
	onDevice,
}: {
	companyId: string;
	onDevice: (deviceId: string) => void;
}) {
	useLive({ kind: 'company', companyId });
	const devices = useCompanyDevices(companyId);
	const [period, setPeriod] = React.useState<Period | null>({ kind: 'relative', preset: '24h' });
	const range = React.useMemo(() => {
		if (period) return resolvePeriod(period);
		return { from: new Date(Date.now() - 24 * 3600_000), to: new Date() };
	}, [period]);
	const fromMs = range.from.getTime();
	const toMs = range.to.getTime();
	const rangeKey = `${fromMs}-${toMs}`;
	const aggregate = useQuery(
		qk.companyConnections(companyId, `agg-${rangeKey}`),
		React.useCallback(
			() =>
				observabilityService.connections({
					companyId,
					from: new Date(fromMs),
					to: new Date(toMs),
					view: 'aggregate',
				}),
			[companyId, fromMs, toMs],
		),
	);
	const aggRows = (aggregate.data?.data as AggregateBucket[] | undefined) ?? [];
	const aggChart = aggRows.map((b, i) => ({
		key: `agg${i}`,
		label: new Date(b.bucket).toLocaleString('pt-BR', {
			timeZone: 'America/Sao_Paulo',
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
		}),
		values: { online: b.onlineCount },
	}));

	const rows = (devices.data?.data ?? []).map((d) => ({
		id: d.id,
		name: d.name,
		serial: d.serialNumber,
		connection: d.connectionStatus,
		lastSeenAt: d.lastSeenAt,
		ipAddress: d.ipAddress ?? null,
	}));

	return (
		<div className={s.formStack}>
			<Panel
				title="Dispositivos conectados ao longo do tempo"
				description="Quantidade de dispositivos conectados por intervalo, contada dos eventos de conexão reais."
			>
				<PeriodPills value={period} onChange={setPeriod} />
				{aggregate.loading && !aggregate.data ? (
					<p className={s.muted}>Carregando série…</p>
				) : aggChart.length ? (
					<LineChart
						label="Dispositivos conectados"
						data={aggChart}
						series={[{ key: 'online', label: 'Conectados', color: 'var(--success)' }]}
						categoryLabel="Intervalo"
						emptyLabel="Sem eventos no período"
					/>
				) : (
					<p className={s.muted}>
						Sem eventos de conexão no período — a cobertura histórica começa com o primeiro evento
						registrado.
					</p>
				)}
			</Panel>
			<Panel
				title="Frota da empresa"
				description="Estado de conexão atual de cada dispositivo, com último contato recebido"
			>
				<Guard
					loading={devices.loading && !devices.data}
					empty={!rows.length}
					emptyTitle="Nenhum dispositivo"
				>
					<Collection
						rows={rows}
						columns={connectivityColumns(onDevice)}
						label="Dispositivos da empresa"
						onOpenRow={(r) => onDevice(String(r.id))}
						showPeriodFilter={false}
						fields={[
							{
								id: 'connection',
								label: 'Conexão',
								options: [
									{ value: 'connected', label: 'Conectado' },
									{ value: 'disconnected', label: 'Inativo' },
								],
							},
						]}
					/>
				</Guard>
			</Panel>
			<Button
				variant="secondary"
				onClick={async () => {
					await deviceService.syncAll();
					notifyDataChanged();
				}}
			>
				Sincronizar agora
			</Button>
		</div>
	);
}

function connectivityColumns(onDevice: (deviceId: string) => void) {
	return [
		{
			key: 'name',
			label: 'Dispositivo',
			render: (_: unknown, r: AnyRow) => (
				<button type="button" className={s.link} onClick={() => onDevice(String(r.id))}>
					{String(r.name)}
					<span className={`${s.cellSub} ${s.mono}`}>{String(r.serial)}</span>
				</button>
			),
		},
		{
			key: 'connection',
			label: 'Conexão',
			render: (v: unknown) => <Status value={String(v)} />,
		},
		{
			key: 'lastSeenAt',
			label: 'Último contato',
			render: (v: unknown) => (v ? stamp(String(v)) : 'Sem contato'),
		},
		{ key: 'ipAddress', label: 'IP' },
	];
}

function ActivityTab({ companyId }: { companyId: string }) {
	const [period, setPeriod] = React.useState<Period | null>(null);
	const periodFrom = period ? resolvePeriod(period).from : null;
	const periodTo = period ? resolvePeriod(period).to : null;
	const periodKey = period ? periodKeyOf(period) : 'default';
	const activity = useQuery(
		qk.companyActivity(companyId, periodKey),
		React.useCallback(
			() =>
				observabilityService.activity({
					companyId,
					limit: 60,
					...(periodFrom ? { from: periodFrom, to: periodTo! } : {}),
				}),
			[companyId, periodFrom, periodTo],
		),
	);

	return (
		<>
			<PeriodPills value={period} onChange={setPeriod} />
			<Timeline
				events={toEvents(activity.data?.data ?? [])}
				now={Date.now()}
				label="Atividade da empresa"
				locale="pt-BR"
				timeZone="America/Recife"
				scrollToNew={false}
			/>
		</>
	);
}

// ── Form host (support lists load only while a form is open) ───────────

export function CompanyFormHost({
	companyId,
	kind,
	onClose,
}: {
	companyId: string;
	kind: CompanyFormKind;
	onClose: () => void;
}) {
	const companies = useCompanies();
	const allDevices = useAllDevices();
	const releases = useReleases();
	const groupsByCompany = useCompanyGroups(companyId);

	const companyList = companies.data?.data ?? [];
	const deviceList = allDevices.data?.data ?? [];
	const groupList = groupsByCompany.data?.data ?? [];
	const byCompany = (cid: string) => (cid === companyId ? groupList : []);

	switch (kind) {
		case 'assign':
			return (
				<AssignForm
					companies={companyList}
					devices={deviceList}
					groupsByCompany={byCompany}
					companyId={companyId}
					done={onClose}
				/>
			);
		case 'register':
			return (
				<RegisterForm
					companies={companyList}
					groupsByCompany={byCompany}
					companyId={companyId}
					done={onClose}
				/>
			);
		case 'group':
			return <GroupForm companies={companyList} companyId={companyId} done={onClose} />;
		case 'member':
			return <MemberForm companies={companyList} companyId={companyId} done={onClose} />;
		case 'atualização':
			return (
				<RolloutForm
					companies={companyList}
					releases={releases.data?.data ?? []}
					devices={deviceList}
					companyId={companyId}
					done={onClose}
				/>
			);
	}
}

// ── Detail pieces ──────────────────────────────────────────────────────

/** Compact device summary inside the company drawer — rename in place. */
export function DeviceQuick({
	device,
	companyId,
	onOpenFull,
	onDeploy,
}: {
	device: Device;
	companyId: string;
	onOpenFull: () => void;
	onDeploy: () => void;
}) {
	return (
		<div className={s.formStack}>
			<div className={s.inline}>
				<Status value={device.connectionStatus} />
				<Status value={device.status} />
			</div>
			<InlineEdit
				label="Nome do dispositivo"
				value={device.name}
				variant="title"
				validate={(v) => (v.trim() ? null : 'O nome não pode ficar vazio.')}
				onSave={async (v) => {
					await deviceService.update(companyId, device.id, { name: v.trim() });
					notifyDataChanged();
				}}
			/>
			<dl className={s.facts}>
				<dt>Firmware</dt>
				<dd>{device.firmwareVersion ?? 'não reportada'}</dd>
				<dt>Último poll</dt>
				<dd>{device.lastSeenAt ? stamp(device.lastSeenAt) : '—'}</dd>
			</dl>
			<Button onClick={onOpenFull}>Abrir dispositivo</Button>
			<Button variant="secondary" onClick={onDeploy}>
				Preparar deploy para este dispositivo
			</Button>
		</div>
	);
}

/** Connectivity lanes — the reference's lane/track/session CSS, real bands. */
export function ConnectivityLanes({
	sessions,
	from,
	to,
	loading,
}: {
	sessions: SessionBand[];
	from: number;
	to: number;
	loading?: boolean;
}) {
	const lanes = React.useMemo(() => {
		const order: string[] = [];
		const map = new Map<string, { deviceId: string; name: string; bands: SessionBand[] }>();
		for (const b of sessions) {
			let lane = map.get(b.deviceId);
			if (!lane) {
				lane = { deviceId: b.deviceId, name: b.deviceName ?? b.deviceId, bands: [] };
				map.set(b.deviceId, lane);
				order.push(b.deviceId);
			}
			lane.bands.push(b);
		}
		return order.map((id) => map.get(id)!);
	}, [sessions]);

	const span = Math.max(1, to - from);
	const ticks = Array.from({ length: 5 }, (_, i) => new Date(from + (span * i) / 4));

	if (loading) return <p className={s.muted}>Carregando sessões…</p>;
	if (!lanes.length)
		return (
			<Alert tone="info" title="Nenhuma sessão no período">
				Dispositivos conectados aparecem aqui conforme polam o servidor (intervalo de 5 min).
			</Alert>
		);

	return (
		<div className={s.lanes}>
			<div className={s.laneAxis}>
				<div />
				<div>
					{ticks.map((t, i) => (
						<span key={i}>
							{t.toLocaleTimeString('pt-BR', {
								timeZone: 'America/Recife',
								hour: '2-digit',
								minute: '2-digit',
							})}
						</span>
					))}
				</div>
			</div>
			{lanes.map((lane) => (
				<div className={s.lane} key={lane.deviceId}>
					<span className={s.cellSub}>{lane.name}</span>
					<div className={s.track}>
						{lane.bands.map((b, i) => {
							const start = Math.max(
								0,
								Math.min(100, ((new Date(b.start).getTime() - from) / span) * 100),
							);
							const end = Math.max(
								0,
								Math.min(100, ((new Date(b.end).getTime() - from) / span) * 100),
							);
							const width = Math.max(0.75, end - start);
							return (
								<span
									key={i}
									className={s.session}
									style={{ left: `${start}%`, width: `${width}%` }}
									title={`${new Date(b.start).toLocaleString('pt-BR', { timeZone: 'America/Recife' })} → ${new Date(b.end).toLocaleString('pt-BR', { timeZone: 'America/Recife' })}`}
								/>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

function toEvents(
	rows: Array<{
		id: number;
		createdAt: string;
		actorEmail: string | null;
		action: string;
		entityLabel: string | null;
		entityType: string;
	}>,
): TimelineEvent[] {
	return rows.map((e) => ({
		id: String(e.id),
		at: e.createdAt,
		actor: e.actorEmail ?? undefined,
		title: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`,
		meta: e.entityType,
	}));
}
