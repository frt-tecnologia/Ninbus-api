import type {
	DeploymentStatus,
	DeploymentPhase,
	DeviceStatus,
} from '@/types/domain';

/**
 * Status → UI mapping (badge color + label). Centralized so every table/badge
 * renders consistently across the dashboard.
 */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusMeta {
	label: string;
	variant: BadgeVariant;
}

const DEVICE_STATUS: Record<string, StatusMeta> = {
	pending: { label: 'Pendente', variant: 'warning' },
	accepted: { label: 'Aceito', variant: 'success' },
	rejected: { label: 'Rejeitado', variant: 'danger' },
	disabled: { label: 'Desativado', variant: 'neutral' },
};

const CONNECTION: Record<string, StatusMeta> = {
	online: { label: 'Online', variant: 'success' },
	offline: { label: 'Offline', variant: 'neutral' },
	unknown: { label: 'Desconhecido', variant: 'neutral' },
};

const DEPLOYMENT_STATUS: Record<DeploymentStatus, StatusMeta> = {
	pending: { label: 'Pendente', variant: 'warning' },
	in_progress: { label: 'Em andamento', variant: 'info' },
	completed: { label: 'Concluído', variant: 'success' },
	failed: { label: 'Falhou', variant: 'danger' },
	canceled: { label: 'Cancelado', variant: 'neutral' },
	no_targets: { label: 'Sem alvos', variant: 'neutral' },
	unknown: { label: 'Desconhecido', variant: 'neutral' },
};

const PHASE: Record<DeploymentPhase, StatusMeta> = {
	assigned: { label: 'Atribuído', variant: 'info' },
	pending: { label: 'Pendente', variant: 'warning' },
	downloading: { label: 'Baixando', variant: 'info' },
	downloaded: { label: 'Baixado', variant: 'info' },
	installing: { label: 'Instalando', variant: 'info' },
	installed: { label: 'Instalado', variant: 'success' },
	error: { label: 'Erro', variant: 'danger' },
	canceled: { label: 'Cancelado', variant: 'neutral' },
	unknown: { label: 'Desconhecido', variant: 'neutral' },
};

export function deviceStatusMeta(s: string): StatusMeta {
	return DEVICE_STATUS[s] ?? { label: s, variant: 'neutral' };
}

export function connectionMeta(s: string | null | undefined): StatusMeta {
	if (!s) return CONNECTION.unknown;
	return CONNECTION[s] ?? { label: s, variant: 'neutral' };
}

export function deploymentStatusMeta(s: DeploymentStatus): StatusMeta {
	return DEPLOYMENT_STATUS[s] ?? DEPLOYMENT_STATUS.unknown;
}

export function phaseMeta(p: DeploymentPhase | string): StatusMeta {
	return PHASE[p as DeploymentPhase] ?? PHASE.unknown;
}
