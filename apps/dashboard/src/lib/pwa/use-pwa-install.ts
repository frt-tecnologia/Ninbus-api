'use client';

import * as React from 'react';

/**
 * PWA installation hook — captures the native `beforeinstallprompt` event,
 * defers it (preventDefault), and exposes an `install()` callable that must be
 * invoked from a user gesture (button click).
 *
 * Per the PWA spec: the event is DISPOSABLE — `.prompt()` can be called once.
 * After `userChoice`, the reference is cleared. Returns whether the app is
 * already running as installed (display-mode: standalone) so the UI can hide
 * the install button in that case.
 *
 * Also registers the Service Worker — but ONLY in production builds. In dev
 * the SW would serve stale chunks and break Fast Refresh / HMR, and (critically)
 * the browser requires a production build + HTTPS/localhost for installability.
 */

export interface InstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface UsePwaInstall {
	/** True when the native install prompt is available (can show the button). */
	canInstall: boolean;
	/** True when already running as an installed app (hide the button). */
	isStandalone: boolean;
	/** Trigger the native prompt. Must be called from a user click. */
	install: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export function usePwaInstall(): UsePwaInstall {
	const [deferred, setDeferred] = React.useState<InstallPromptEvent | null>(null);
	const [isStandalone, setIsStandalone] = React.useState(false);

	React.useEffect(() => {
		if (typeof window === 'undefined') return;

		// Detect standalone (installed) mode.
		const mq = window.matchMedia('(display-mode: standalone)');
		const updateStandalone = () =>
			setIsStandalone(mq.matches || window.matchMedia('(display-mode: minimal-ui)').matches);
		updateStandalone();
		mq.addEventListener('change', updateStandalone);

		// Capture + defer the native install prompt.
		const onBefore = (e: Event) => {
			e.preventDefault(); // hold the native popup so we can fire it on click
			setDeferred(e as InstallPromptEvent);
		};
		const onInstalled = () => {
			setDeferred(null);
			setIsStandalone(true);
		};
		window.addEventListener('beforeinstallprompt', onBefore);
		window.addEventListener('appinstalled', onInstalled);

		return () => {
			mq.removeEventListener('change', updateStandalone);
			window.removeEventListener('beforeinstallprompt', onBefore);
			window.removeEventListener('appinstalled', onInstalled);
		};
	}, []);

	const install = React.useCallback(async () => {
		if (!deferred) return 'unavailable' as const;
		await deferred.prompt();
		const { outcome } = await deferred.userChoice;
		setDeferred(null); // event is disposable
		return outcome;
	}, [deferred]);

	return {
		canInstall: !!deferred,
		isStandalone,
		install,
	};
}

/**
 * Register the Service Worker — production only.
 *
 * Call once from a top-level client component (the AppShell). Guards on
 * process.env.NODE_ENV and 'serviceWorker' in navigator. basePath is applied
 * so the SW scope covers the whole dashboard.
 */
export function registerServiceWorker(basePath = '/console'): void {
	if (typeof window === 'undefined') return;
	if (process.env.NODE_ENV !== 'production') return;
	if (!('serviceWorker' in navigator)) return;

	const onLoad = () => {
		navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: basePath }).catch(() => {
			// SW registration failure is non-fatal — the app still works online.
		});
	};

	if (document.readyState === 'complete') onLoad();
	else window.addEventListener('load', onLoad, { once: true });
}
