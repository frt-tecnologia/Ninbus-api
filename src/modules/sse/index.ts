/**
 * SSE (Server-Sent Events) module — real-time event push endpoint.
 *
 * Route: GET /api/companies/:companyId/sse
 * Auth: cookie session (Better Auth) + company membership (viewer+)
 *
 * Event types pushed to Flutter:
 *   device.status      → { deviceId, connectionStatus, hawkbitUpdateStatus, lastPollAt, ipAddress }
 *   device.claimed     → { deviceId, action: "claimed" }
 *   device.unclaimed   → { deviceId, action: "unclaimed" }
 *   deployment.created → { deploymentId, name, artifactType }
 *   deployment.stats   → { deploymentId, stats: { pending, downloading, success, error } }
 *   heartbeat          → { timestamp }
 *   connected          → { companyId, timestamp }
 */
import { env } from '@common/config/env';
import { sseEmitter } from '@common/sse/emitter';
import { withAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';

/**
 * SSE endpoint — long-lived connection per company.
 *
 * Flutter connects with:
 *   EventSource(uri: '/api/companies/$companyId/sse', headers: {'Cookie': sessionCookie})
 *
 * Server keeps connection open and pushes events.
 * Connection closes when: client disconnects, session expires, or server shutdown.
 */
export const sseModule = withAuth(
	new Elysia({ prefix: '/api/companies/:companyId' }),
).get(
	'/sse',
	async ({ params, user, set, request }) => {
		// SSE check
		if (!env.SSE_ENABLED) {
			set.status = 503;
			return { error: 'Service Unavailable', message: 'SSE is disabled' };
		}

		const companyId = params.companyId;

		// Create a ReadableStream for this connection
		const stream = new ReadableStream({
			start(controller) {
				// Register connection in the emitter
				const conn = sseEmitter.addConnection(companyId, controller);

				// Clean up when client disconnects
				const abortHandler = () => {
					sseEmitter.removeConnection(conn);
				};

				request.signal.addEventListener('abort', abortHandler, { once: true });
			},
		});

		// SSE headers per W3C spec
		set.headers['Content-Type'] = 'text/event-stream';
		set.headers['Cache-Control'] = 'no-cache';
		set.headers['Connection'] = 'keep-alive';
		set.headers['X-Accel-Buffering'] = 'no'; // nginx: disable buffering

		return stream;
	},
	{
		auth: true,
		companyRole: 'viewer',
		params: t.Object({
			companyId: t.String({ format: 'uuid' }),
		}),
		detail: {
			hide: true, // Hide from Swagger (streams don't work in Swagger UI)
			tags: ['SSE'],
			summary: 'SSE event stream (Flutter real-time updates)',
			description:
				'Long-lived Server-Sent Events connection. Pushes real-time device/deployment updates. ' +
				'Connect with EventSource(cookie: session). Events: device.status, deployment.created, heartbeat.',
			security: [{ cookieAuth: [] }],
		},
	},
);
