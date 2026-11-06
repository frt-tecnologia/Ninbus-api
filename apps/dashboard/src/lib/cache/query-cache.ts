/**
 * Query cache — single in-memory store shared by every dashboard read.
 *
 * Design goals (dashboard-only, API-agnostic so the future server-side
 * pagination can slot in without touching screens):
 *   - One entry per cache key (see `qk` builders in `keys.ts`).
 *   - In-flight de-duplication: concurrent readers of a cold key share one
 *     promise (StrictMode double-mount safe).
 *   - Stale-while-revalidate: invalidation keeps the previous data on screen
 *     while a refresh happens in the background.
 *   - Key listeners power `useQuery`: invalidating a key re-runs only the
 *     screens that read it — never a global refetch.
 */

interface Entry {
	data: unknown;
	ts: number;
	promise: Promise<unknown> | null;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
	listeners.get(key)?.forEach((cb) => {
		cb();
	});
}

/** Subscribes to invalidations of one key. Returns an unsubscribe function. */
export function subscribeQuery(key: string, cb: () => void): () => void {
	let set = listeners.get(key);
	if (!set) {
		set = new Set();
		listeners.set(key, set);
	}
	set.add(cb);
	return () => {
		set!.delete(cb);
		if (!set!.size) listeners.delete(key);
	};
}

/** Reads a key through the cache: fresh hit → data; cold → fetch and store. */
export async function readQuery<T>(
	key: string,
	fetcher: () => Promise<T>,
	opts: { force?: boolean } = {},
): Promise<T> {
	const cached = entries.get(key);
	if (cached && !opts.force) {
		if (cached.promise) return cached.promise as Promise<T>;
		return cached.data as T;
	}
	if (cached?.promise) return cached.promise as Promise<T>;

	const promise = fetcher().then(
		(data) => {
			entries.set(key, { data, ts: Date.now(), promise: null });
			return data;
		},
		(error: unknown) => {
			// Keep previous data (stale-while-revalidate); drop the failed promise
			// so the next read retries instead of replaying the rejection.
			const previous = entries.get(key);
			if (previous) previous.promise = null;
			else entries.delete(key);
			throw error;
		},
	);
	entries.set(key, { data: cached?.data as T, ts: cached?.ts ?? 0, promise });
	return promise;
}

/** Cache snapshot for optimistic first paint (SSR-safe, synchronous). */
export function getCached<T>(key: string): T | undefined {
	return entries.get(key)?.data as T | undefined;
}

/** Age of the cached value in ms (Infinity when absent). */
export function queryAge(key: string): number {
	const entry = entries.get(key);
	return entry ? Date.now() - entry.ts : Number.POSITIVE_INFINITY;
}

/** Writes a value into the cache (used after mutations to avoid refetch). */
export function setQuery<T>(key: string, data: T) {
	entries.set(key, { data, ts: Date.now(), promise: null });
}

/**
 * Invalidates every key matching `match` (substring, RegExp or predicate).
 * Listeners revalidate in the background — data already rendered stays.
 * Returns the invalidated keys (handy for logging/tests).
 */
export function invalidateQueries(match: string | RegExp | ((key: string) => boolean)): string[] {
	const test =
		typeof match === 'function'
			? match
			: typeof match === 'string'
				? (k: string) => k.includes(match)
				: (k: string) => match.test(k);
	const hits: string[] = [];
	for (const key of entries.keys()) if (test(key)) hits.push(key);
	for (const key of hits) notify(key);
	return hits;
}
