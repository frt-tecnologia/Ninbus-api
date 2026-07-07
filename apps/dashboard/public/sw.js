/* eslint-disable no-restricted-globals */
/**
 * Ninbus Console — Service Worker KILL SWITCH.
 *
 * WHY THIS EXISTS: a previous dashboard build registered a PWA service worker
 * (feat/dashboard-improvement, public/sw.js) that intercepted every navigation
 * and asset fetch. This branch has NO service-worker feature, but browsers that
 * installed the old SW keep running it indefinitely (SWs persist until
 * explicitly unregistered), serving stale chunks and masking the real server.
 *
 * This file is registered once (see src/lib/pwa/register.ts) ONLY to REMOVE any
 * existing SW for this scope. It:
 *   1. Unregisters itself (and any sibling SW) on activate.
 *   2. Reloads open tabs so they run without a SW.
 * After it runs, the browser has no SW for /console and the registration code
 * (gated by a localStorage flag) never registers again — leaving a clean state.
 *
 * This is a one-shot cleanup, NOT a working SW — it has no fetch handler, so if
 * it ever fails to self-unregister it still passes requests straight through to
 * the network.
 */

self.addEventListener('install', () => {
	// Take control immediately so activate runs without waiting for all tabs to close.
	void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			try {
				// Unregister THIS registration (clears the old SW from this scope).
				await self.registration.unregister();
				// Reload every open tab under our control so it picks up a SW-free state.
				const clients = await self.clients.matchAll({
					type: 'window',
					includeUncontrolled: true,
				});
				for (const client of clients) {
					try {
						await client.navigate(client.url);
					} catch {
						/* navigate can reject if the client is gone — ignore */
					}
				}
			} catch {
				/* best-effort cleanup; never block activation */
			}
		})(),
	);
});

// Deliberately NO 'fetch' listener: if activate hasn't run yet, requests pass
// through to the network untouched.
