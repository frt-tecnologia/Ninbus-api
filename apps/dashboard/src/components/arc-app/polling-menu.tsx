'use client';

import * as React from 'react';
import { Badge } from '@/components/arc/badge/badge';
import { HoldToConfirm } from '@/components/arc/hold-to-confirm/hold-to-confirm';
import { Input } from '@/components/arc/input/input';
import s from '@/components/arc-app/app.module.css';
import { usePollingSettings } from '@/hooks/use-polling-settings';
import { Alert, Button, Panel, Surface } from './primitives';

function formatDuration(totalSec: number): string {
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;
	return [hours, minutes, seconds].map((p) => String(p).padStart(2, '0')).join(':');
}

export function PollingMenu() {
	const polling = usePollingSettings();
	const [open, setOpen] = React.useState(false);
	const effectiveSec = polling.effective?.effectiveSec ?? null;

	return (
		<Panel
			title="Operação da plataforma"
			description="Configuração global da frota, aplicável a todas as empresas"
		>
			<div className={s.inline}>
				<span>Polling dos dispositivos</span>
				{polling.loading ? (
					<span className={s.footnote}>Carregando…</span>
				) : (
					<span className={s.footnote}>
						{effectiveSec != null
							? `${effectiveSec}s (${formatDuration(effectiveSec)})`
							: 'Indisponível'}
					</span>
				)}
				<Badge tone={polling.effective?.source === 'override' ? 'info' : 'neutral'}>
					{polling.effective?.source === 'override' ? 'Definido no painel' : 'Padrão do ambiente'}
				</Badge>
				<Button variant="secondary" onClick={() => setOpen(true)} disabled={polling.loading}>
					Ajustar
				</Button>
			</div>
			<Surface
				open={open}
				onClose={() => setOpen(false)}
				title="Polling dos dispositivos"
				description="Intervalo global de consulta esperado dos dispositivos (super admin)"
			>
				<div className={s.formStack}>
					<Input
						label="Intervalo (segundos)"
						type="number"
						value={polling.draft}
						onChange={(e) => polling.setDraft(e.target.value)}
					/>
					<p className={s.footnote}>
						O valor deve corresponder ao ritmo real de poll do firmware — menor que o ritmo real
						marca dispositivos como inativos entre consultas.
					</p>
					{polling.draftError && polling.draft !== '' && (
						<Alert tone="danger" title="Intervalo inválido">
							{polling.draftError}
						</Alert>
					)}
					{polling.error && (
						<Alert tone="danger" title="Não foi possível aplicar">
							{polling.error}
						</Alert>
					)}
					<HoldToConfirm
						label="Segure para aplicar o intervalo"
						confirmedLabel="Intervalo aplicado"
						tone="accent"
						disabled={!!polling.draftError || polling.saving}
						confirmed={polling.applied}
						onConfirm={() => {
							void polling.apply();
						}}
					/>
					<span role="status" className={s.footnote}>
						{polling.saving
							? 'Enviando ao hawkBit…'
							: polling.applied
								? 'Intervalo atualizado e enviado ao hawkBit.'
								: 'Solte antes de concluir para cancelar.'}
					</span>
				</div>
			</Surface>
		</Panel>
	);
}
