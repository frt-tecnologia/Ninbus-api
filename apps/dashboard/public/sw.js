/* eslint-disable no-restricted-globals */
/**
 * Ninbus Console — Service Worker
 *
 * PURPOSE: makes the dashboard INSTALLABLE (a SW with a fetch handler is a
 * hard requirement for the PWA install prompt). Also provides offline shell
 * resilience via a network-first + cache-fallback strategy for navigations.
 *
 * Registered ONLY in production builds (see pwa/register.ts) — in dev the SW
 * would serve stale code and break HMR. The installability popup therefore
 * only fires on HTTPS or localhost production builds (per the PWA spec).
 *
 * NO Workbox/Serwist dependency — a hand-rolled ~40-line SW keeps the bundle
 * minimal and works across all major browsers (Chrome, Edge, Safari, Firefox,
 * Samsung Internet, Brave, Opera).
 */

const CACHE = 'ninbus-console-v1';
const APP_SHELL = [
	// Precache the app shell so the offline page loads instantly.
	'/console',
	'/console/manifest.webmanifest',
	'/console/icon-192.png',
	'/console/icon-512.png',
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) =>
			// addAll is all-or-nothing; ignore individual failures (basePath nuances).
			Promise.allSettled(APP_SHELL.map((url) => cache.add(url))),
		),
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

// The fetch handler is what makes the SW count toward installability.
self.addEventListener('fetch', (event) => {
	const { request } = event;

	// Only handle GET; ignore cross-origin + API calls (auth cookies + fresh data).
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith('/console/api/')) return;

	// Navigations: network-first, fall back to cached shell (offline support).
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.then((res) => {
					const copy = res.clone();
					caches.open(CACHE).then((c) => c.put(request, copy));
					return res;
				})
				.catch(() => caches.match(request).then((r) => r ?? caches.match('/console'))),
		);
		return;
	}

	// Static assets: cache-first (fast), then network.
	event.respondWith(
		caches.match(request).then((cached) => {
			if (cached) return cached;
			return fetch(request).then((res) => {
				// Cache successful same-origin responses for next time.
				if (res.ok && res.type === 'basic') {
					const copy = res.clone();
					caches.open(CACHE).then((c) => c.put(request, copy));
				}
				return res;
			});
		}),
	);
});
