'use client';
/**
 * useQuery — cached data-fetching hook built on `query-cache`.
 *
 * Differences from the legacy `useFetch`:
 *   - keyed: navigating back to a screen paints cached data instantly and
 *     revalidates in the background (no more refetch-everything on back);
 *   - shared: several panels reading the same key fire one request
 *     (overview KPIs reuse the same companies/devices/deployments lists);
 *   - reactive: cache invalidation (SSE `data-changed`, local mutations,
 *     `refetch()`) refreshes only the keys that changed;
 *   - focus-aware: revalidates on window focus when older than `staleAfter`.
 *
 * `fetcher` must be stable (useCallback) — like the previous `useFetch`.
 */

import * as React from 'react';
import { subscribeData } from '@/lib/data-events';
import { getCached, queryAge, readQuery, subscribeQuery } from './query-cache';

export interface UseQueryOptions {
	/** Revalidate when older than this on window focus (default 60s). */
	staleAfter?: number;
	/** React to dashboard mutations (global data-event bus). Default true. */
	sync?: boolean;
	/** Extra triggers, mirroring `useFetch`'s deps. */
	deps?: readonly unknown[];
}

export interface UseQueryResult<T> {
	data: T | null;
	loading: boolean;
	refreshing: boolean;
	error: string | null;
	refetch: () => void;
}

export function useQuery<T>(
	key: string,
	fetcher: () => Promise<T>,
	{ staleAfter = 60_000, sync = true, deps = [] }: UseQueryOptions = {},
): UseQueryResult<T> {
	// Seed from cache so returning to a screen never flashes a skeleton.
	const [data, setData] = React.useState<T | null>(() => getCached<T>(key) ?? null);
	const [loading, setLoading] = React.useState(() => getCached<T>(key) === undefined);
	const [refreshing, setRefreshing] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [nonce, setNonce] = React.useState(0);

	const refetch = React.useCallback(() => setNonce((n) => n + 1), []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fetcher identity is intentionally excluded — callers pass a stable useCallback; `key` + `nonce` drive re-runs.
	React.useEffect(() => {
		let active = true;
		const hadData = getCached<T>(key) !== undefined;
		if (!hadData) {
			setLoading(true);
			setError(null);
		} else {
			setRefreshing(true);
		}
		readQuery<T>(key, fetcher, { force: nonce > 0 || !hadData })
			.then((result) => {
				if (!active) return;
				setData(result);
				setLoading(false);
				setRefreshing(false);
				// A refetch that fails keeps the previous data on screen.
				if (!hadData) setError(null);
			})
			.catch((err: unknown) => {
				if (!active) return;
				setLoading(false);
				setRefreshing(false);
				setError(err instanceof Error ? err.message : 'Erro inesperado ao carregar dados.');
			});
		return () => {
			active = false;
		};
	}, [key, nonce, ...deps]);

	// Invalidate this key (SSE, invalidateQueries) → silent revalidate.
	React.useEffect(() => subscribeQuery(key, () => setNonce((n) => n + 1)), [key]);

	// Local mutations across the dashboard revalidate everything they touched.
	React.useEffect(() => {
		if (!sync) return;
		return subscribeData(() => setNonce((n) => n + 1));
	}, [sync]);

	// Window focus → revalidate only when the data is stale.
	React.useEffect(() => {
		const onFocus = () => {
			if (queryAge(key) > staleAfter) setNonce((n) => n + 1);
		};
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [key, staleAfter]);

	return { data, loading, refreshing, error, refetch };
}
