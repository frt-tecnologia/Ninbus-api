/**
 * SSE (Server-Sent Events) module — real-time event push to Flutter.
 *
 * Routes:
 *   GET /api/sse/global          — Global SSE (auth only, receives ALL events for user's companies)
 *   GET /api/companies/:id/sse   — Company-scoped SSE (auth + company membership)
 *
 * W3C SSE Format (each event):
 *   id: <sequential-id>\n
 *   event: <event-type>\n
 *   data: <json>\n
 *   \n
 *
 * Event types:
 *   event: connected
 *     data: {"companyId":"...","timestamp":"2025-..."}
 *     → Sent immediately on connection. Frontend should use this to confirm SSE is live.
 *
 *   event: heartbeat
 *     data: {"timestamp":"2025-..."}
 *     → Sent every 30s. Frontend should use this to keep connection alive indicator.
 *
 *   event: device.status
 *     data: {"deviceId":"...","connectionStatus":"online","hawkbitUpdateStatus":"in_progress","lastPollAt":"...","ipAddress":"..."}
 *     → Sent for SINGLE-DEVICE events (claim, unclaim, deployment action feedback).
 *     → NOT used for bulk connection-status changes (those go via devices.batch below).
 *
 *   event: devices.batch
 *     data: {"count":42,"changes":[{"id":"<uuid>","s":"connected","u":"in_sync","t":"2025-..."}, ...],"timestamp":"2025-..."}
 *     → COALESCED device-status deltas. The backend buffers per-company status
 *       changes and flushes them as ONE event every SSE_FLUSH_MS (default 1500ms).
 *       De-duplicated by deviceId (last state wins). This is how 50k+ device
 *       fleets stay real-time without melting the event loop.
 *     → `changes` is an array of compact deltas:
 *         id  = device UUID
 *         s   = connectionStatus ('connected'|'disconnected'|'online'|'offline'|'unknown')
 *         u   = hawkbitUpdateStatus (optional — only when it changed)
 *         t   = lastPollAt ISO UTC (optional — null/omitted = unknown)
 *     → Frontend: apply each delta to the local device map by `id`. If a device
 *       is not yet in the local cache, fetch the snapshot via GET /devices.
 *
 *   event: device.deployment
 *     data: {"deviceId":"...","controllerId":"...","status":"pending","message":"...","timestamp":"..."}
 *     → Sent when a device gets a new deployment assignment via sync.
 *
 *   event: device.claimed
 *     data: {"deviceId":"...","action":"claimed"}
 *     → Sent when POST /devices/:id/register claims a device. Frontend should refresh device list.
 *
 *   event: device.unclaimed
 *     data: {"deviceId":"...","action":"unclaimed"}
 *     → Sent when DELETE /companies/:id/devices/:id unclaims a device. Frontend should refresh device list.
 *
 *   event: deployment.created
 *     data: {"deploymentId":"...","name":"...","artifactType":"..."}
 *     → Sent when POST /deployments creates a deployment. Frontend should refresh deployments list.
 *
 *   event: deployment.deleted
 *     data: {"deploymentId":"..."}
 *     → Sent when DELETE /deployments removes a deployment.
 *
 *   event: devices.batch
 *     data: {"count":5}
 *     → Sent after sync cycle completes. Frontend should refresh device list.
 *
 *   event: device.action.status
 *     data: {"deviceId":"...","controllerId":"...","actionId":123,"latestStatus":"running","phase":"downloading","progress":50,"message":"downloading 50%","timestamp":"2025-..."}
 *     → Sent during active deployments with real-time progress. Frontend should update device progress bar/card.
 *     → phase values: assigned, pending, downloading, downloaded, installing, installed, error, canceled, unknown
 *     → progress: 0-100 (download %) or null (not downloading)
 *
 *   event: deployment.stats
 *     data: {"deploymentId":42,"summary":{"totalTargets":5,"finished":2,"failed":0,"inProgress":1,"pending":2,"canceled":0},"status":"in_progress"}
 *     → Sent during active deployments with aggregate statistics. Frontend should update deployment progress card.
 *
 * Flutter connection example:
 *   // IMPORTANT: EventSource does NOT support custom headers.
 *   // Use a package that supports headers (e.g., eventsource_client or dio).
 *   final sse = EventSource(
 *     Uri.parse('$baseUrl/api/companies/$companyId/sse'),
 *     headers: {'Cookie': sessionCookie},
 *   );
 *   sse.stream.listen((event) {
 *     switch (event.event) {
 *       case 'device.status':        // → update device in list
 *       case 'device.action.status': // → update device deployment progress bar
 *       case 'deployment.stats':     // → update deployment card statistics
 *       case 'device.claimed':       // → add device to list
 *       case 'device.unclaimed':     // → remove device from list
 *       case 'deployment.created':   // → add to deployments
 *       case 'heartbeat':            // → connection alive
 *     }
 *   });
 */
import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { withAuth } from '@common/middleware/auth-guard';
import { sseEmitter } from '@common/sse/emitter';
import { Elysia, t } from 'elysia';

/**
 * Company-scoped SSE endpoint.
 * Only pushes events for devices/deployments in this company.
 */
export const sseModule = withAuth(new Elysia({ prefix: '/api/companies/:companyId' })).get(
	'/sse',
	async ({ params, user, set, request }) => {
		if (!env.SSE_ENABLED) {
			set.status = 503;
			return { error: 'Service Unavailable', message: 'SSE is disabled' };
		}

		const companyId = params.companyId;
		appLogger.info('[SSE] Company connection opened: companyId=%s user=%s', companyId, user.email);

		const stream = new ReadableStream({
			start(controller) {
				const conn = sseEmitter.addConnection(companyId, controller);
				request.signal.addEventListener(
					'abort',
					() => {
						sseEmitter.removeConnection(conn);
					},
					{ once: true },
				);
			},
		});

		set.headers['Content-Type'] = 'text/event-stream';
		set.headers['Cache-Control'] = 'no-cache';
		set.headers['Connection'] = 'keep-alive';
		set.headers['X-Accel-Buffering'] = 'no';

		return stream;
	},
	{
		auth: true,
		companyRole: 'viewer',
		params: t.Object({
			companyId: t.String({ format: 'uuid' }),
		}),
		detail: {
			hide: true,
			tags: ['SSE'],
			summary: 'Company SSE stream',
			description: 'SSE events scoped to one company. Requires company membership.',
		},
	},
);

/**
 * Global SSE endpoint — auth-only, no company membership required.
 * Super admins can use this to monitor ALL events across ALL companies.
 *
 * NOTE: This is a simplified endpoint for admin/testing purposes.
 * Company-scoped events are also sent here for the user's companies.
 */
export const sseGlobalModule = withAuth(new Elysia({ prefix: '/api/sse' })).get(
	'/global',
	async ({ user, set, request }) => {
		if (!env.SSE_ENABLED) {
			set.status = 503;
			return { error: 'Service Unavailable', message: 'SSE is disabled' };
		}

		appLogger.info('[SSE] Global connection opened: user=%s', user.email);

		const stream = new ReadableStream({
			start(controller) {
				// For global SSE, we use a special "global" companyId
				// The emitter will send events from all companies to this connection
				const conn = sseEmitter.addConnection('__global__', controller);
				request.signal.addEventListener(
					'abort',
					() => {
						sseEmitter.removeConnection(conn);
					},
					{ once: true },
				);
			},
		});

		set.headers['Content-Type'] = 'text/event-stream';
		set.headers['Cache-Control'] = 'no-cache';
		set.headers['Connection'] = 'keep-alive';
		set.headers['X-Accel-Buffering'] = 'no';

		return stream;
	},
	{
		auth: true,
		detail: {
			hide: true,
			tags: ['SSE'],
			summary: 'Global SSE stream (admin)',
			description: 'SSE events for all companies. Auth-only, no company membership required.',
		},
	},
);
