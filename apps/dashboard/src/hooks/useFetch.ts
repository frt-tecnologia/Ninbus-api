'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError } from '@/lib/api';
import { subscribeData } from '@/lib/data-events';

interface UseFetchState<T> {
	data: T | null;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

/**
 * Generic data-fetching hook with loading/error states.
 * Centralizes the loading/error/data pattern used across every page.
 *
 * `fetcher` must be stable (useCallback) to avoid re-fetch loops.
 */
export function useFetch<T>(
	fetcher: () => Promise<T>,
	deps: unknown[] = [],
	sync = true,
): UseFetchState<T> {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [nonce, setNonce] = useState(0);

	const refetch = useCallback(() => setNonce((n) => n + 1), []);

	// Auto-refresh on ANY successful mutation across the dashboard. The global
	// data-event bus is fired by dialogs/inline actions after they mutate data;
	// bumping the nonce re-runs the effect below → the table re-loads. Disabled
	// when `sync === false` (e.g. for fetches that shouldn't react to global
	// events, like a one-shot lookup).
	useEffect(() => subscribeData(() => setNonce((n) => n + 1)), []);

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError(null);
		fetcher()
			.then((result) => {
				if (active) {
					setData(result);
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				setError(
					err instanceof ApiClientError
						? err.message
						: 'Erro inesperado ao carregar dados.',
				);
			});
		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nonce, ...deps]);

	return { data, loading, error, refetch };
}

/**
 * Mutation hook for create/update/delete operations with optimistic UX.
 * Returns a callable `run` plus loading/error state.
 */
export function useMutation<TArgs extends unknown[], TResult>(
	mutation: (...args: TArgs) => Promise<TResult>,
) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(
		async (...args: TArgs): Promise<TResult | null> => {
			setLoading(true);
			setError(null);
			try {
				const result = await mutation(...args);
				setLoading(false);
				return result;
			} catch (err: unknown) {
				setLoading(false);
				setError(
					err instanceof ApiClientError
						? err.message
						: 'Erro inesperado ao processar a ação.',
				);
				return null;
			}
		},
		[mutation],
	);

	return { run, loading, error, clearError: () => setError(null) };
}
