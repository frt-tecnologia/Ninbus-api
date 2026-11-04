'use client';

/**
 * SSE client — ref-counted EventSource manager for the streams the API
 * already exposes (`/api/sse/global` for admin screens, `/api/companies/:id/sse`
 * inside a company). Consumption only: nothing here talks to the API beyond
 * those existing endpoints.
 *
 * Responsibilities:
 *   - one EventSource per scope, shared by every subscriber on screen;
 *   - automatic reconnect with exponential backoff + refresh on visibility;
 *   - connection status for the "Ao vivo / Reconectando" badge;
 *   - translation of entity events (`device.claimed`, `deployment.stats`, …)
 *     into *selective* query-cache invalidations — only the collections the
 *     event actually touched revalidate.
 */

import { API_PREFIX } from '@/lib/api/http';
import { invalidateQueries } from '@/lib/cache/query-cache';

export type SseStatus = 'connecting' | 'live' | 'reconnecting' | 'off';

export type SseScope = { kind: 'global' } | { kind: 'company'; companyId: string };

/** SSE event → cache resource tokens to invalidate (see `qk` in keys.ts). */
const EVENT_INVALIDATION: Record<string, readonly string[]> = {
	'device.claimed': ['devices', 'companies', 'activity'],
	'device.unclaimed': ['devices', 'companies', 'activity'],
	'device.deployment': ['devices', 'deployments'],
	'device.action.status': ['devices', 'deployments'],
	'deployment.created': ['deployments', 'activity'],
	'deployment.deleted': ['deployments', 'devices', 'activity'],
	'deployment.stats': ['deployments'],
};

interface Connection {
	es: EventSource;
	refs: number;
	status: SseStatus;
	attempt: number;
	timer: ReturnType<typeof setTimeout> | null;
	/** Detaches the visibilitychange listener when the last subscriber leaves. */
	releaseVisibility?: () => void;
}

const connections = new Map<string, Connection>();
const statusListeners = new Map<string, Set<(s: SseStatus) => void>>();

const scopeKey = (scope: SseScope) =>
	scope.kind === 'global' ? 'global' : `company:${scope.companyId}`;
const scopeUrl = (scope: SseScope) =>
	scope.kind === 'global'
		? `${API_PREFIX}/sse/global`
		: `${API_PREFIX}/companies/${scope.companyId}/sse`;

function broadcast(key: string, status: SseStatus) {
	statusListeners.get(key)?.forEach((cb) => {
		cb(status);
	});
}

function setStatus(conn: Connection, key: string, status: SseStatus) {
	conn.status = status;
	broadcast(key, status);
}

function scheduleReconnect(conn: Connection, key: string, scope: SseScope) {
	if (conn.timer) clearTimeout(conn.timer);
	conn.attempt = Math.min(conn.attempt + 1, 5);
	const delay = Math.min(500 * 2 ** conn.attempt, 15_000);
	setStatus(conn, key, 'reconnecting');
	conn.timer = setTimeout(() => connect(conn, key, scope), delay);
}

function connect(conn: Connection, key: string, scope: SseScope) {
	if (conn.timer) {
		clearTimeout(conn.timer);
		conn.timer = null;
	}
	const es = new EventSource(scopeUrl(scope));
	conn.es = es;
	setStatus(conn, key, 'connecting');

	es.onopen = () => {
		conn.attempt = 0;
		setStatus(conn, key, 'live');
	};
	es.onerror = () => {
		// EventSource auto-retries; our backoff guards hopeless endpoints.
		es.close();
		scheduleReconnect(conn, key, scope);
	};
	for (const event of Object.keys(EVENT_INVALIDATION)) {
		es.addEventListener(event, () => {
			// Payload is informational — invalidation is by resource token.
			for (const token of EVENT_INVALIDATION[event]) {
				invalidateQueries((k) => k.startsWith(`${token}:`));
			}
		});
	}
}

/**
 * Opens (or joins) the stream for a scope. Returns a release function —
 * the underlying EventSource closes when the last subscriber leaves.
 */
export function openSse(scope: SseScope): () => void {
	const key = scopeKey(scope);
	const existing = connections.get(key);
	if (existing) {
		existing.refs += 1;
		return () => release(key);
	}
	const conn: Connection = {
		es: null as unknown as EventSource,
		refs: 1,
		status: 'connecting',
		attempt: 0,
		timer: null,
	};
	connections.set(key, conn);
	connect(conn, key, scope);

	// Tab back to front → if the stream died while hidden, reconnect now.
	const onVisible = () => {
		if (document.visibilityState === 'visible' && conn.status !== 'live') {
			conn.es.close();
			connect(conn, key, scope);
		}
	};
	document.addEventListener('visibilitychange', onVisible);
	conn.releaseVisibility = () => document.removeEventListener('visibilitychange', onVisible);
	return () => {
		conn.releaseVisibility?.();
		release(key);
	};
}
function release(key: string) {
	const conn = connections.get(key);
	if (!conn) return;
	conn.refs -= 1;
	if (conn.refs > 0) return;
	conn.es.close();
	if (conn.timer) clearTimeout(conn.timer);
	connections.delete(key);
	broadcast(key, 'off');
}

/** Subscribes to connection-status changes for a scope. */
export function onSseStatus(scope: SseScope, cb: (s: SseStatus) => void): () => void {
	const key = scopeKey(scope);
	let set = statusListeners.get(key);
	if (!set) {
		set = new Set();
		statusListeners.set(key, set);
	}
	const current = connections.get(key)?.status;
	if (current) cb(current);
	set.add(cb);
	return () => {
		set!.delete(cb);
		if (!set!.size) statusListeners.delete(key);
	};
}
