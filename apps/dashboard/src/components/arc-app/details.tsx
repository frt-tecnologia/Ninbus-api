'use client';
/**
 * Record details — the reference's drawer contents, on REAL endpoints.
 * Every write is a SafeAction (hold-to-confirm gated on server response) or
 * an InlineEdit whose onSave returns the real promise.
 */
import * as React from 'react';
import { CopyButton } from '@/components/arc/copy-button/copy-button';
import { InlineEdit } from '@/components/arc/inline-edit/inline-edit';
import { PasswordField } from '@/components/arc/password-field/password-field';
import { Progress } from '@/components/arc/progress/progress';
import { RadioGroup } from '@/components/arc/radio-group/radio-group';
import { Timeline, type TimelineEvent } from '@/components/arc/timeline/timeline';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import {
	ApiClientError,
	categoryService,
	deploymentService,
	designationService,
	deviceService,
	firmwareService,
	memberService,
	observabilityService,
} from '@/lib/api';
import type { ActivityLogEntry } from '@/lib/api/observability';
import type {
	Company,
	Device,
	DeviceCategory,
	EnrichedDeployment,
	FirmwareRelease,
	PendingDesignation,
	User,
} from '@/types/domain';
import s from './app.module.css';
import { ConnectionHistorySection } from './connection-history-section';
import {
	Alert,
	type AnyRow,
	Button,
	Collection,
	Panel,
	roleLabel,
	roleOptions,
	SafeAction,
	Status,
	stamp,
} from './primitives';
import { WaffleChart } from './waffle-chart';

const required = (v: string) => (v.trim() ? null : 'O nome não pode ficar vazio.');

function emitDataChanged() {
	import('@/lib/data-events').then(({ notifyDataChanged }) => notifyDataChanged());
}

function EditText({
	value,
	label,
	onSave,
	multiline = false,
}: {
	value: string;
	label: string;
	onSave: (v: string) => Promise<void>;
	multiline?: boolean;
}) {
	return (
		<InlineEdit
			label={label}
			value={value}
			onSave={onSave}
			validate={multiline ? undefined : required}
			multiline={multiline}
			variant={multiline ? 'body' : 'title'}
		/>
	);
}

// ── membership role manager ────────────────────────────────────────────

export function MemberRole({
	companyId,
	membership,
	done,
}: {
	companyId: string;
	membership: { userId: string; name: string; email: string; role: string };
	done?: () => void;
}) {
	const [role, setRole] = React.useState(membership.role);
	return (
		<div className={s.formStack}>
			<p>
				{membership.name} · {membership.email}
			</p>
			<RadioGroup
				label="Papel na empresa"
				value={role}
				onValueChange={setRole}
				options={roleOptions}
			/>
			<SafeAction
				key={role}
				label="alterar papel"
				disabled={role === membership.role}
				description={`Papel atual: ${roleLabel(membership.role)}. A alteração vale para a empresa inteira, inclusive os grupos.`}
				onConfirm={async () => {
					await memberService.updateRole(companyId, membership.userId, { role: role as never });
					emitDataChanged();
				}}
			/>
			<SafeAction
				label="remover membro"
				danger
				description="Remove o acesso à empresa. A conta é mantida."
				onConfirm={async () => {
					await memberService.remove(companyId, membership.userId);
					emitDataChanged();
					done?.();
				}}
			/>
		</div>
	);
}

// ── device ─────────────────────────────────────────────────────────────

export function DeviceDetails({
	device,
	companies,
	groups,
	deployments,
	onLinkDevice,
}: {
	device: Device;
	companies: Company[];
	groups: DeviceCategory[];
	deployments: EnrichedDeployment[];
	onLinkDevice?: () => void;
}) {
	const company = companies.find((c) => c.id === device.companyId) ?? null;
	const [deviceKey, setDeviceKey] = React.useState('');
	const [linkOpen, setLinkOpen] = React.useState(false);

	const deviceDeployments = deployments.filter((d) => d.targetIds?.includes(device.id));

	async function saveName(v: string) {
		if (!device.companyId) throw new Error('Dispositivo sem empresa.');
		await deviceService.update(device.companyId, device.id, { name: v.trim() });
		emitDataChanged();
	}

	return (
		<div className={s.formStack}>
			<EditText label="Nome do dispositivo" value={device.name} onSave={saveName} />
			<div className={s.inline}>
				<code className={s.mono}>{device.serialDisplay ?? device.serialNumber ?? '—'}</code>
				<CopyButton
					value={device.serialDisplay ?? device.serialNumber ?? ''}
					label="Copiar número de série"
					iconOnly
				/>
				<Status value={device.connectionStatus} />
				<Status value={device.status} />
			</div>
			<dl className={s.facts}>
				<dt>Empresa</dt>
				<dd>{company?.name ?? 'Sem empresa'}</dd>
				<dt>Última comunicação</dt>
				<dd>{device.lastSeenAt ? stamp(device.lastSeenAt) : 'sem contato'}</dd>
				<dt>Firmware</dt>
				<dd>{device.firmwareVersion ?? 'não reportada'}</dd>
				<dt>Controlador</dt>
				<dd>{device.controllerFirmwareVersion ?? 'não reportada'}</dd>
				<dt>Grupos</dt>
				<dd>
					{groups.filter((g) => g.companyId === device.companyId).length > 0 ? '' : 'Sem grupo'}
				</dd>
			</dl>

			<div className={s.formStack}>
				<h3>Histórico de conexão</h3>
				<ConnectionHistorySection
					companies={company ? [company] : []}
					devices={[device]}
					initialPeriod={{ kind: 'relative', preset: '7d' }}
					deviceId={device.id}
					onManageDevice={undefined}
				/>
			</div>

			{!device.hawkbitTargetId && device.companyId && (
				<>
					<Button variant="secondary" onClick={() => setLinkOpen((v) => !v)}>
						Vincular ao serviço de atualizações
					</Button>
					{linkOpen && (
						<div className={s.formStack}>
							<PasswordField
								label="Chave de fábrica (device key)"
								value={deviceKey}
								onChange={(e) => setDeviceKey(e.target.value)}
								autoComplete="off"
								messages={{ showPassword: 'Mostrar chave', hidePassword: 'Ocultar chave' }}
							/>
							<SafeAction
								label="vincular ao serviço de atualizações"
								disabled={deviceKey.trim().length < 4}
								description="Ativa as atualizações com a chave de fábrica."
								onConfirm={async () => {
									if (!device.companyId) throw new Error('Dispositivo sem empresa.');
									await deviceService.link(device.companyId, device.id, deviceKey.trim());
									setDeviceKey('');
									emitDataChanged();
								}}
							/>
						</div>
					)}
				</>
			)}

			{device.firmwareStatus === 'update_available' && onLinkDevice && (
				<Button onClick={onLinkDevice}>Preparar atualização</Button>
			)}

			{deviceDeployments.length > 0 && (
				<Panel title="Histórico de atualizações">
					<Collection
						label="Atualizações do dispositivo"
						rows={deviceDeployments.map((d) => ({
							id: String(d.id),
							name: d.displayName ?? d.name,
							status: d.status,
						}))}
						columns={[
							{ key: 'name', label: 'Atualização' },
							{ key: 'status', label: 'Estado', render: (v) => <Status value={String(v)} /> },
						]}
					/>
				</Panel>
			)}

			{device.companyId && (
				<SafeAction
					label="desvincular da empresa"
					danger
					description="Remove os vínculos com a empresa e os grupos. Mantém o histórico."
					onConfirm={async () => {
						if (!device.companyId) return;
						await deviceService.unlink(device.companyId, device.id);
						emitDataChanged();
					}}
				/>
			)}
			{device.serialNumber && (
				<SafeAction
					label="remover dispositivo"
					danger
					description="Exclui o registro e desativa as atualizações deste dispositivo."
					onConfirm={async () => {
						if (!device.serialNumber) return;
						await deviceService.deprovision(device.serialNumber);
						emitDataChanged();
					}}
				/>
			)}
		</div>
	);
}

// ── group ──────────────────────────────────────────────────────────────

export function GroupDetails({
	group,
	company,
	devices,
	openDevice,
	openAssign,
}: {
	group: DeviceCategory;
	company: Company;
	devices: Device[];
	openDevice: (id: string) => void;
	openAssign: (groupId: string) => void;
}) {
	const members = devices.filter((d) => d.companyId === company.id);
	async function saveName(v: string) {
		await categoryService.rename(company.id, group.id, v.trim());
		emitDataChanged();
	}
	return (
		<div className={s.formStack}>
			<EditText label="Nome do grupo" value={group.name} onSave={saveName} />
			<p>
				{group.type} · {company.name}
			</p>
			<Tooltip content="Grupos organizam dispositivos; permissões pertencem à empresa.">
				<span className={s.muted}>
					Os grupos organizam dispositivos sem criar permissões paralelas.
				</span>
			</Tooltip>
			<Panel
				title="Dispositivos do grupo"
				action={
					<Button variant="secondary" onClick={() => openAssign(group.id)}>
						Adicionar dispositivos
					</Button>
				}
			>
				<Collection
					label="Dispositivos do grupo"
					rows={members.map((d) => ({ ...d, id: d.id }))}
					columns={[
						{
							key: 'name',
							label: 'Dispositivo',
							render: (_, r) => (
								<button type="button" className={s.link} onClick={() => openDevice(r.id)}>
									{r.name}
									<span className={`${s.cellSub} ${s.mono}`}>
										{r.serialDisplay ?? r.serialNumber}
									</span>
								</button>
							),
						},
						{
							key: 'connectionStatus',
							label: 'Conexão',
							render: (v) => <Status value={String(v)} />,
						},
					]}
				/>
			</Panel>
			<SafeAction
				label="excluir grupo"
				danger
				description="Remove o grupo e seus vínculos. Os dispositivos continuam na empresa."
				onConfirm={async () => {
					await categoryService.remove(company.id, group.id);
					emitDataChanged();
				}}
			/>
		</div>
	);
}

// ── user ───────────────────────────────────────────────────────────────

export function UserDetails({ user }: { user: User }) {
	const activity = useActivity({ actorUserId: user.id, limit: 30 });
	const events: TimelineEvent[] = ((activity?.data?.data ?? []) as ActivityLogEntry[]).map(
		(e: ActivityLogEntry) => ({
			id: String(e.id),
			at: e.createdAt,
			title: `${e.action}${e.entityLabel ? ` · ${e.entityLabel}` : ''}`,
			meta: e.entityType,
		}),
	);
	return (
		<div className={s.formStack}>
			<div className={s.inline}>
				<span>{user.email}</span>
				<CopyButton value={user.email} label="Copiar e-mail" iconOnly />
				{user.isSuperAdmin && <Status value="active" />}
			</div>
			<dl className={s.facts}>
				<dt>Empresas</dt>
				<dd>{user.companyCount}</dd>
				<dt>Criado em</dt>
				<dd>{stamp(user.createdAt)}</dd>
				<dt>E-mail verificado</dt>
				<dd>{user.emailVerified ? 'Sim' : 'Não'}</dd>
			</dl>
			{user.companyCount === 0 && (
				<Alert tone="info" title="Sem vínculos">
					Esta conta não pertence a nenhuma empresa. Adicione-a a partir da página de uma empresa.
				</Alert>
			)}
			<h2>Atividade desta pessoa</h2>
			<Timeline
				events={events}
				now={Date.now()}
				label="Atividade da pessoa"
				locale="pt-BR"
				timeZone="America/Recife"
				scrollToNew={false}
			/>
		</div>
	);
}

/** Tiny local fetch wrapper for the details (avoids page-level coupling). */
import { useFetch } from '@/hooks/useFetch';

function useActivity(opts: { actorUserId: string; limit: number }) {
	const fetcher = React.useCallback(
		() => observabilityService.activity({ actorUserId: opts.actorUserId, limit: opts.limit }),
		[opts.actorUserId, opts.limit],
	);
	const res = useFetch(fetcher, [opts.actorUserId], false);
	return res;
}

// ── invite (designation) ───────────────────────────────────────────────

export function InviteDetails({
	invite,
	companies,
	done,
}: {
	invite: PendingDesignation;
	companies: Company[];
	done?: () => void;
}) {
	const company = companies.find((c) => c.id === invite.companyId);
	return (
		<div className={s.formStack}>
			<div className={s.inline}>
				<span>{invite.email}</span>
				<CopyButton value={invite.email} label="Copiar e-mail" iconOnly />
			</div>
			<Status value={invite.claimedAt ? 'accepted' : 'pending'} />
			<dl className={s.facts}>
				<dt>Empresa</dt>
				<dd>{invite.companyName || company?.name || '—'}</dd>
				<dt>Papel</dt>
				<dd>{roleLabel(invite.role)}</dd>
				<dt>Registrado em</dt>
				<dd>{stamp(invite.createdAt)}</dd>
			</dl>
			{!invite.claimedAt && (
				<SafeAction
					label="cancelar convite"
					danger
					description="Cancela este convite. Acessos existentes são mantidos."
					onConfirm={async () => {
						await designationService.cancel(invite.companyId, invite.id);
						emitDataChanged();
						done?.();
					}}
				/>
			)}
		</div>
	);
}

// ── release ────────────────────────────────────────────────────────────

export function ReleaseDetails({
	release,
	onDeploy,
}: {
	release: FirmwareRelease;
	onDeploy?: (releaseId: string) => void;
}) {
	const [error, setError] = React.useState('');
	async function saveName(v: string) {
		const { http } = await import('@/lib/api');
		await http.put(`/admin/firmware/${release.id}`, { name: v.trim() });
		emitDataChanged();
	}
	return (
		<div className={s.formStack}>
			<EditText label="Nome da release" value={release.name} onSave={saveName} />
			<Status value={release.status} />
			<dl className={s.facts}>
				<dt>Versão</dt>
				<dd>{release.version}</dd>
				<dt>Tipo</dt>
				<dd>{release.artifactType}</dd>
				<dt>Arquivo</dt>
				<dd>{release.originalFilename ?? '—'}</dd>
				<dt>Tamanho</dt>
				<dd>{release.payloadSize ? `${(release.payloadSize / 1024).toFixed(1)} KB` : '—'}</dd>
				<dt>Publicação</dt>
				<dd>{stamp(release.createdAt)}</dd>
			</dl>
			{release.originalFilename && (
				<CopyButton value={release.originalFilename} label="Copiar nome do arquivo" />
			)}
			<Button disabled={release.status !== 'published'} onClick={() => onDeploy?.(release.id)}>
				Preparar deploy
			</Button>
			{release.status === 'draft' && (
				<SafeAction
					label="publicar release"
					description="Disponibiliza esta versão para as empresas."
					onConfirm={async () => {
						await firmwareService.publish(release.id);
						emitDataChanged();
					}}
				/>
			)}
			{release.status === 'published' && (
				<SafeAction
					label="despublicar release"
					description="Retira esta versão de novas atualizações."
					onConfirm={async () => {
						await firmwareService.unpublish(release.id);
						emitDataChanged();
					}}
				/>
			)}
			<SafeAction
				label="excluir do catálogo"
				danger
				description="Remove do catálogo e mantém o arquivo no histórico."
				onConfirm={async () => {
					try {
						const res = await firmwareService.remove(release.id);
						if (res?.hawkbitKept) toastBinKept(res.message);
						emitDataChanged();
					} catch (e) {
						if (
							e instanceof ApiClientError &&
							(e.raw as { code?: string })?.code === 'COUNTER_FLOOR_BURNED'
						) {
							setError(
								'A versão já foi entregue a dispositivos: o contador de firmware não permite remover. Despublique e publique uma nova versão.',
							);
							throw new Error('Versão protegida pelo contador.');
						}
						throw e;
					}
				}}
			/>
			{error && <Alert tone="danger" title={error} />}
		</div>
	);
}

function toastBinKept(message?: string) {
	import('sonner').then(({ toast }) =>
		toast.warning(
			message ??
				'Release removida do catálogo; binário mantido no serviço de distribuição como histórico.',
		),
	);
}

// ── atualização (deployment) ───────────────────────────────────────────────

/** Phase to waffle category: exactly one bucket per target; sum = total. */
const waffleCategoryOf = (phase: string): string => {
	if (phase === 'installed') return 'done';
	if (phase === 'error') return 'failed';
	if (phase === 'canceled') return 'canceled';
	if (['downloading', 'downloaded', 'installing'].includes(phase)) return 'running';
	return 'waiting';
};

export function RolloutDetails({
	companyId,
	deployment,
	openDevice,
	onDone,
}: {
	companyId: string;
	deployment: EnrichedDeployment;
	openDevice: (deviceId: string) => void;
	onDone?: () => void;
}) {
	const statuses = useFetch(
		React.useCallback(
			() => deploymentService.targetStatuses(companyId, String(deployment.id)),
			[companyId, deployment.id],
		),
		[companyId, deployment.id],
		false,
	);

	const [wafflePick, setWafflePick] = React.useState<string | null>(null);
	const allRows: AnyRow[] = (statuses.data?.data ?? []).map((t) => ({
		id: t.controllerId,
		name: t.name,
		serial: t.controllerId,
		status: t.action?.phase ?? t.updateStatus ?? 'unknown',
		message: t.action?.message ?? '',
	}));

	const waffleData = React.useMemo(() => {
		const counts = { waiting: 0, running: 0, done: 0, failed: 0, canceled: 0 };
		for (const r of allRows) counts[waffleCategoryOf(String(r.status)) as keyof typeof counts] += 1;
		return [
			{ key: 'waiting', label: 'Aguardando', value: counts.waiting, color: 'var(--text-muted)' },
			{ key: 'running', label: 'Em andamento', value: counts.running, color: 'var(--accent)' },
			{ key: 'done', label: 'Concluído', value: counts.done, color: 'var(--success)' },
			{ key: 'failed', label: 'Falhou', value: counts.failed, color: 'var(--danger)' },
			{ key: 'canceled', label: 'Cancelado', value: counts.canceled, color: 'var(--text-muted)' },
		];
	}, [allRows]);
	const rows = wafflePick
		? allRows.filter((r) => waffleCategoryOf(String(r.status)) === wafflePick)
		: allRows;

	return (
		<div className={s.formStack}>
			<Status value={deployment.status} />
			<p>
				{deployment.typeName ?? deployment.type ?? ''} · v
				{deployment.artifactVersion ?? deployment.version ?? '—'}
			</p>
			<Progress
				value={deployment.statistics?.finished ?? 0}
				max={Math.max(1, deployment.statistics?.totalTargets ?? 1)}
				showValue
				label={`${deployment.statistics?.finished ?? 0} de ${deployment.statistics?.totalTargets ?? 0} concluídos`}
			/>
			{statuses.loading ? (
				<p className={s.muted}>Carregando resultado por dispositivo…</p>
			) : (
				<>
					<WaffleChart data={waffleData} selected={wafflePick} onSelect={setWafflePick} />
					<Collection
						label="Resultados da atualização"
						rows={rows}
						fields={[
							{
								id: 'status',
								label: 'Resultado',
								options: ['installed', 'downloading', 'installing', 'error', 'canceled', 'unknown'],
							},
						]}
						columns={[
							{
								key: 'name',
								label: 'Dispositivo',
								render: (_, r) => (
									<button type="button" className={s.link} onClick={() => openDevice(r.id)}>
										{r.name}
										<span className={`${s.cellSub} ${s.mono}`}>{r.serial}</span>
									</button>
								),
							},
							{ key: 'status', label: 'Resultado', render: (v) => <Status value={String(v)} /> },
							{ key: 'message', label: 'Última mensagem' },
						]}
					/>
					<SafeAction
						label="excluir atualização"
						danger
						description="Exclui a atualização. Mantém o histórico dos dispositivos."
						onConfirm={async () => {
							await deploymentService.remove(companyId, String(deployment.id));
							emitDataChanged();
							onDone?.();
						}}
					/>
				</>
			)}
		</div>
	);
}
