/**
 * Service Worker registration — ONE-SHOT CLEANUP.
 *
 * A previous dashboard build (feat/dashboard-improvement) installed a PWA
 * service worker. This branch has no SW feature, so we must REMOVE that stale
 * SW from users' browsers. We do it by registering a self-unregistering kill
 * switch (public/sw.js) exactly once.
 *
 * Flow:
 *  - No flag + a stale SW exists → register /sw.js (kill switch). It
 *    unregisters everything and reloads the tab.
 *  - On the reload, no SW exists → set the flag and stop. No infinite loop.
 *  - Flag already set → do nothing (cleanup already done, no SW to manage).
 *
 * Safe by construction: the kill switch has no fetch handler, so even mid-flight
 * it never breaks navigation.
 */
const CLEANED_FLAG = 'ninbus-sw-cleaned';

export async function registerKillSwitchSW(): Promise<void> {
	if (typeof window === 'undefined') return;
	if (process.env.NODE_ENV !== 'production') return;
	// basePath '/console' — the SW is served there and scopes to /console/*.
	const SW_URL = '/console/sw.js';

	try {
		// Already cleaned up on a previous visit → nothing to do.
		if (window.localStorage.getItem(CLEANED_FLAG) === '1') return;

		const regs = await navigator.serviceWorker.getRegistrations();
		if (regs.length === 0) {
			// No stale SW and none of ours → clean state, record it and stop.
			window.localStorage.setItem(CLEANED_FLAG, '1');
			return;
		}

		// A SW exists (the stale one, or our kill switch from a prior cycle).
		// Register/update the kill switch so it unregisters everything + reloads.
		await navigator.serviceWorker.register(SW_URL);
		const reg = await navigator.serviceWorker.getRegistration(SW_URL);
		await reg?.update();
		// Record the attempt; the kill switch's reload will re-enter here with
		// zero registrations, setting the final clean state.
		window.localStorage.setItem(CLEANED_FLAG, '1');
	} catch {
		// SW unavailable (e.g. HTTP, private mode) — non-fatal, the app still works.
	}
}
