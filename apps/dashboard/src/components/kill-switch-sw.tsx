'use client';

import { useEffect } from 'react';
import { registerKillSwitchSW } from '@/lib/pwa/register';

/**
 * <KillSwitchSW> — mounts a no-op client component that triggers the
 * one-shot Service Worker cleanup (see lib/pwa/register.ts) on load.
 *
 * Rendered once in the root layout so it runs on every route (including the
 * login page). After it cleans up the stale SW, a localStorage flag prevents
 * any further work — effectively a self-disposing cleanup.
 */
export function KillSwitchSW() {
	useEffect(() => {
		void registerKillSwitchSW();
	}, []);
	return null;
}
