'use client';

/**
 * LiveBadge — "Ao vivo / Reconectando" indicator for the topbar.
 * Pure presentation; connection state comes from `useLive`.
 */

import type { SseScope } from '@/lib/sse/sse-client';
import { useLive } from '@/lib/sse/use-live';
import s from './app.module.css';

const LABEL: Record<string, string> = {
	live: 'Ao vivo',
	connecting: 'Conectando',
	reconnecting: 'Reconectando',
	off: 'Sem stream',
};

export function LiveBadge({ scope }: { scope: SseScope | null }) {
	const status = useLive(scope);
	if (status === 'off') return null;
	return (
		<span
			className={`${s.liveBadge} ${status === 'live' ? s.liveBadgeOn : ''}`}
			role="status"
			title={
				status === 'live'
					? 'Atualizações em tempo real ativas — as listas se atualizam sozinhas.'
					: 'Reconectando ao stream de atualizações…'
			}
		>
			<span className={s.liveDot} aria-hidden />
			{LABEL[status]}
		</span>
	);
}
