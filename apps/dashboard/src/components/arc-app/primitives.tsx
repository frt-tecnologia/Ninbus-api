'use client';
import { AlertCircle, Check, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
/**
 * Arc app primitives — ported from the approved ninbus-arc reference and
 * wired to the real domain (status vocabulary, pt-BR labels, Recife TZ).
 *
 * Status maps REAL API values (connected/pending/in_progress/…) to Arc Badge
 * tones + telemetry glyphs. `Collection` lives in `collection.tsx` (v2:
 * cached sources, clickable rows, row actions, Fase-2 server paging) and is
 * re-exported below so screens keep a single import point.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/arc/alert/alert';
import { Badge } from '@/components/arc/badge/badge';
import { BottomSheet } from '@/components/arc/bottom-sheet/bottom-sheet';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { HoldToConfirm } from '@/components/arc/hold-to-confirm/hold-to-confirm';
import { motionTokens } from '@/components/arc/lib/motion-tokens';
import { Tooltip } from '@/components/arc/tooltip/tooltip';
import s from './app.module.css';

export { Alert, Button, Tooltip };

export type AnyRow = Record<string, any>;

// ── Domain vocabulary ──────────────────────────────────────────────────

export type Tone = 'success' | 'danger' | 'info' | 'neutral';
type Glyph = 'dot' | 'ring' | 'square';

/** Real API status value → pt-BR label + tone + glyph. */
const STATUS: Record<string, { label: string; tone: Tone; glyph: Glyph }> = {
	connected: { label: 'Conectado', tone: 'success', glyph: 'dot' },
	online: { label: 'Online', tone: 'success', glyph: 'dot' },
	disconnected: { label: 'Desconectado', tone: 'neutral', glyph: 'dot' },
	offline: { label: 'Offline', tone: 'neutral', glyph: 'dot' },
	unknown: { label: 'Desconhecido', tone: 'neutral', glyph: 'ring' },
	accepted: { label: 'Aceito', tone: 'success', glyph: 'dot' },
	pending: { label: 'Pendente', tone: 'neutral', glyph: 'ring' },
	rejected: { label: 'Rejeitado', tone: 'danger', glyph: 'square' },
	disabled: { label: 'Desativado', tone: 'neutral', glyph: 'square' },
	unclaimed: { label: 'Sem empresa', tone: 'neutral', glyph: 'ring' },
	active: { label: 'Ativa', tone: 'success', glyph: 'dot' },
	suspended: { label: 'Suspensa', tone: 'danger', glyph: 'square' },
	published: { label: 'Publicada', tone: 'success', glyph: 'dot' },
	draft: { label: 'Rascunho', tone: 'neutral', glyph: 'ring' },
	in_progress: { label: 'Em andamento', tone: 'info', glyph: 'square' },
	completed: { label: 'Concluído', tone: 'success', glyph: 'dot' },
	failed: { label: 'Falha', tone: 'danger', glyph: 'square' },
	canceled: { label: 'Cancelado', tone: 'neutral', glyph: 'square' },
	no_targets: { label: 'Sem alvos', tone: 'neutral', glyph: 'ring' },
	installed: { label: 'Instalado', tone: 'success', glyph: 'dot' },
	downloading: { label: 'Baixando', tone: 'info', glyph: 'square' },
	downloaded: { label: 'Baixado', tone: 'info', glyph: 'square' },
	installing: { label: 'Instalando', tone: 'info', glyph: 'square' },
	assigned: { label: 'Atribuído', tone: 'info', glyph: 'dot' },
	error: { label: 'Erro', tone: 'danger', glyph: 'square' },
	up_to_date: { label: 'Atualizado', tone: 'success', glyph: 'dot' },
	update_available: { label: 'Atualização disponível', tone: 'info', glyph: 'ring' },
	no_release: { label: 'Sem release', tone: 'neutral', glyph: 'square' },
};

export function statusInfo(value: unknown): { label: string; tone: Tone; glyph: Glyph } {
	return (
		STATUS[String(value ?? 'unknown')] ?? {
			label: String(value ?? '—'),
			tone: 'neutral',
			glyph: 'ring',
		}
	);
}

export function Status({ value }: { value: string | null | undefined }) {
	const info = statusInfo(value);
	return (
		<Badge
			size="sm"
			tone={info.tone}
			icon={
				<span
					className={info.glyph === 'ring' ? s.ring : info.glyph === 'square' ? s.square : s.dot}
				/>
			}
		>
			{info.label}
		</Badge>
	);
}

// ── Panels & surfaces ──────────────────────────────────────────────────

export function Panel({
	title,
	description,
	action,
	children,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={s.panel}>
			<div className={s.panelHead}>
				<div>
					<h2>{title}</h2>
					{description && <p>{description}</p>}
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}

/** Drawer on desktop, BottomSheet on ≤640px — focus restored on close. */
export function Surface({
	open,
	onClose,
	title,
	description,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children: ReactNode;
}) {
	const [small, setSmall] = useState(false);
	const focus = useRef<HTMLElement | null>(null);
	useEffect(() => {
		const media = window.matchMedia('(max-width: 640px)');
		setSmall(media.matches);
		const change = () => setSmall(media.matches);
		media.addEventListener('change', change);
		return () => media.removeEventListener('change', change);
	}, []);
	useEffect(() => {
		if (open) focus.current = document.activeElement as HTMLElement;
		else focus.current?.focus();
	}, [open]);
	if (small)
		return (
			<BottomSheet
				open={open}
				onOpenChange={(v) => {
					if (!v) onClose();
				}}
				title={title}
				description={description}
				detents={[0.7, 0.94]}
				initialDetent={1}
				closeLabel="Fechar painel"
			>
				{children}
			</BottomSheet>
		);
	return (
		<Drawer
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DrawerContent title={title} description={description}>
				{children}
			</DrawerContent>
		</Drawer>
	);
}

// ── Action feedback ────────────────────────────────────────────────────

export function RefreshButton({
	onRefresh,
	label = 'Atualizar dados',
}: {
	onRefresh: () => Promise<unknown>;
	label?: string;
}) {
	const [state, setState] = useState('idle');
	const reduced = useReducedMotion();
	async function run() {
		setState('loading');
		try {
			await onRefresh();
			setState('done');
		} catch {
			setState('error');
		}
	}
	return (
		<Tooltip content="Consulta novamente os dados do servidor.">
			<Button variant="secondary" loading={state === 'loading'} onClick={run}>
				<AnimatePresence mode="wait" initial={false}>
					<motion.span
						key={state === 'done' ? 'done' : state === 'error' ? 'error' : 'refresh'}
						initial={reduced ? false : { opacity: 0, rotate: -70, scale: 0.7 }}
						animate={{ opacity: 1, rotate: 0, scale: 1 }}
						exit={reduced ? undefined : { opacity: 0, rotate: 70, scale: 0.7 }}
						transition={reduced ? { duration: 0 } : motionTokens.spring.smooth}
					>
						{state === 'done' ? (
							<Check size={17} />
						) : state === 'error' ? (
							<AlertCircle size={17} />
						) : (
							<RefreshCw size={17} />
						)}
					</motion.span>
				</AnimatePresence>
				{state === 'done' ? 'Dados atualizados' : state === 'error' ? 'Tentar novamente' : label}
			</Button>
		</Tooltip>
	);
}

/** Description + hold-to-confirm gated on REAL server confirmation. */
export function SafeAction({
	label,
	description,
	onConfirm,
	danger = false,
	disabled = false,
}: {
	label: string;
	description: string;
	onConfirm: () => Promise<unknown>;
	danger?: boolean;
	disabled?: boolean;
}) {
	const [state, setState] = useState('idle');
	const [error, setError] = useState('');
	async function run() {
		setState('saving');
		setError('');
		try {
			await onConfirm();
			setState('done');
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Falha ao concluir. Tente novamente.');
			setState('idle');
		}
	}
	return (
		<div className={s.safeAction}>
			{description && <p>{description}</p>}
			<HoldToConfirm
				label={state === 'saving' ? 'Salvando...' : `Segure para ${label}`}
				confirmedLabel="Concluído"
				confirmed={state === 'done'}
				disabled={disabled || state === 'saving' || state === 'done'}
				tone={danger ? 'danger' : 'accent'}
				onConfirm={() => {
					void run();
				}}
			/>
			<span role="status" className={s.muted}>
				{state === 'saving' ? 'Salvando…' : state === 'done' ? 'Concluído' : ''}
			</span>
			{error && <Alert tone="danger" title={error} />}
		</div>
	);
}

// ── Date/time period (Recife, UTC−3) ───────────────────────────────────

/** Period primitives live in lib/time/period (dashboard-v3 §4). */
export type { Period } from '@/lib/time/period';

import { type Period as PeriodValue, resolvePeriod } from '@/lib/time/period';

/** Row temporal filter — resolved at evaluation time so relative windows move. */
export const inPeriod = (at: string | number | null | undefined, p: PeriodValue | null) => {
	if (!p) return true;
	if (!at) return false;
	const { from, to } = resolvePeriod(p);
	const t = new Date(at).getTime();
	return t >= from.getTime() && t <= to.getTime();
};

export const normalize = (v: unknown) =>
	String(v ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

export const matches = (query: string, ...values: unknown[]) =>
	normalize(values.join(' ')).includes(normalize(query));

export const stamp = (iso: string | number | null | undefined) =>
	new Intl.DateTimeFormat('pt-BR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'America/Recife',
	}).format(new Date(iso ?? 0));

// ── Shared domain options ──────────────────────────────────────────────

export const roleOptions = [
	{
		value: 'owner',
		label: 'Titular',
		description: 'Dono da empresa: exclusão, transferência e tudo do Gestor.',
	},
	{
		value: 'manager',
		label: 'Gestor',
		description: 'Controla a empresa: membros, configurações, frota e releases.',
	},
	{
		value: 'operator',
		label: 'Operador',
		description: 'Opera a frota e prepara atualizações; não gerencia acesso.',
	},
	{
		value: 'observer',
		label: 'Observador',
		description: 'Consulta os dados, sem alterar a operação.',
	},
];

export const roleLabel = (r: string) => roleOptions.find((o) => o.value === r)?.label || r;

export const kindOptions = [
	{ value: 'firmware-ninbus', label: 'Firmware Ninbus', description: 'Reinicia o equipamento.' },
	{
		value: 'firmware-controller',
		label: 'Firmware do Controlador',
		description: 'Atualiza o periférico controlador.',
	},
	{
		value: 'configuration-nfx',
		label: 'Configuração NFX',
		description: 'Parametrização CAN, sem substituir o firmware.',
	},
];

export const kindLabel = (v: string) => kindOptions.find((o) => o.value === v)?.label || v;

// ── Collection (v2 — see collection.tsx) ───────────────────────────────

export type { CollectionProps, ListSource, PagedResult, PageQuery } from './collection';
export { Collection } from './collection';
