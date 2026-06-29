/**
 * Global data-mutation event bus.
 *
 * WHY: the dashboard pages are client components that fetch via `useFetch`.
 * When a dialog or inline action mutates data (create company, provision
 * device, add member, cancel designation, suspend company...), every table
 * that shows affected data must refresh WITHOUT a manual page reload.
 * Prop-drilling `onMutate`/`onDone` through deeply-nested dialogs (e.g.
 * <MembersManager> lives inside a <CompanyTable> cell) is fragile and
 * incomplete — counts on the parent row go stale.
 *
 * HOW: a tiny pub/sub. `useFetch` subscribes by default; any successful
 * mutation calls `notifyDataChanged()`; all mounted tables refetch. Only
 * the currently-mounted pages react (unmounted pages have no listener), so
 * this is cheap and scoped to what's visible.
 *
 * Note: `router.refresh()` from the Next.js App Router does NOT re-run
 * client `useEffect`s — it only re-validates Server Components. Since these
 * pages are `'use client'` with client-side fetch, that path is a no-op for
 * the tables. This bus is the reliable refresh mechanism.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to data-changed events. Returns an unsubscribe function. */
export function subscribeData(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Notify every mounted data consumer that data changed and should refetch.
 * Call this AFTER a successful create/update/delete.
 */
export function notifyDataChanged(): void {
	for (const l of listeners) {
		try {
			l();
		} catch {
			// A listener throwing must not break other subscribers.
		}
	}
}
