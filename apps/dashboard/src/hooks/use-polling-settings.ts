'use client';

import * as React from 'react';
import { pollingService } from '@/lib/api/polling';
import { qk } from '@/lib/cache/keys';
import { useQuery } from '@/lib/cache/use-query';

export const POLLING_SEC_MIN = 5;
export const POLLING_SEC_MAX = 86_400;

export function pollingDraftError(draft: string): string | null {
	const sec = Number(draft);
	if (!Number.isInteger(sec) || sec < POLLING_SEC_MIN || sec > POLLING_SEC_MAX) {
		return `Informe um inteiro entre ${POLLING_SEC_MIN} e ${POLLING_SEC_MAX} segundos`;
	}
	return null;
}

export function usePollingSettings() {
	const state = useQuery(
		qk.adminPolling,
		React.useCallback(() => pollingService.get(), []),
	);
	const effective = state.data?.data ?? null;

	const [draft, setDraft] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [applied, setApplied] = React.useState(false);

	React.useEffect(() => {
		if (effective?.effectiveSec != null) setDraft(String(effective.effectiveSec));
	}, [effective?.effectiveSec]);

	const draftError = pollingDraftError(draft);

	async function apply() {
		setSaving(true);
		setError(null);
		setApplied(false);
		try {
			await pollingService.set(Number(draft));
			await state.refetch();
			setApplied(true);
		} catch {
			setError('Não foi possível aplicar — hawkBit inacessível ou valor rejeitado');
		} finally {
			setSaving(false);
		}
	}

	return {
		effective,
		loading: state.loading,
		draft,
		setDraft,
		draftError,
		saving,
		error,
		applied,
		apply,
	};
}
