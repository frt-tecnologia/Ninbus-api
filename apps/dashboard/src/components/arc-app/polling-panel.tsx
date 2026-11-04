'use client';
/**
 * Polling — global device poll interval (super admin, platform-wide).
 * The value is the EXPECTED cadence hawkBit uses to infer online/offline:
 * it must match the firmware poll rate. Lower than real → devices show
 * offline between polls. Changes push to hawkBit immediately and survive
 * API restarts (platform_settings override beats the .env default).
 */
import * as React from 'react';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { Panel } from '@/components/arc-app/primitives';
import { pollingService } from '@/lib/api/polling';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

const MIN_SEC = 5;
const MAX_SEC = 86_400;

function formatDuration(totalSec: number): string {
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;
	return [hours, minutes, seconds].map((p) => String(p).padStart(2, '0')).join(':');
}

export function PollingPanel() {
	const state = useQuery(
		qk.adminPolling,
		React.useCallback(() => pollingService.get(), []),
	);
	const effective = state.data?.data;

	const [draft, setDraft] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [savedAt, setSavedAt] = React.useState<number | null>(null);

	React.useEffect(() => {
		if (effective?.effectiveSec != null) setDraft(String(effective.effectiveSec));
	}, [effective?.effectiveSec]);

	async function apply() {
		const sec = Number(draft);
		if (!Number.isInteger(sec) || sec < MIN_SEC || sec > MAX_SEC) {
			setError(`Informe um inteiro entre ${MIN_SEC} e ${MAX_SEC} segundos`);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await pollingService.set(sec);
			await state.refetch();
			setSavedAt(Date.now());
		} catch {
			setError('Não foi possível aplicar — hawkBit inacessível ou valor rejeitado');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Panel
			title="Polling dos dispositivos"
			description="Intervalo global de consulta esperado dos dispositivos (super admin)"
			action={
				<Badge tone={effective?.source === 'override' ? 'info' : 'neutral'}>
					{effective?.source === 'override' ? 'Definido no painel' : 'Padrão do ambiente'}
				</Badge>
			}
		>
			<div className="flex flex-wrap items-end gap-3">
				<Input
					label="Intervalo (segundos)"
					type="number"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
				/>
				<Button onClick={apply} disabled={saving || state.loading}>
					{saving ? 'Aplicando…' : 'Aplicar'}
				</Button>
			</div>
			<p className="text-muted-foreground mt-3 text-sm">
				{state.loading
					? 'Carregando…'
					: effective
						? `Efetivo agora: ${effective.effectiveSec}s (${formatDuration(effective.effectiveSec)})`
						: 'Indisponível'}
				{savedAt && !state.loading ? ' · atualizado agora' : ''}
			</p>
			{error && <p className="text-destructive mt-1 text-sm">{error}</p>}
			<p className="text-muted-foreground mt-1 text-xs">
				O valor deve corresponder ao ritmo real de poll do firmware — menor que o ritmo real marca
				dispositivos como inativos entre consultas.
			</p>
		</Panel>
	);
}
