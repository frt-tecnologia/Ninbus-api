import { appLogger } from '@common/logger';
import { withAuth } from '@common/middleware/auth-guard';
/**
 * SSE Test & Debug endpoints.
 *
 * Routes:
 *   POST /api/sse/test/:companyId    — Sends a test event to company SSE connections
 *   GET  /api/sse/debug/connections  — Lists all active SSE connections (super admin)
 *   POST /api/sse/simulate/:companyId — Simulates a stream of device.status events
 *
 * Auth: cookie session required.
 */
import { sseEmitter } from '@common/sse/emitter';
import { statusCoalescer } from '@common/sse/status-coalescer';
import { Elysia, t } from 'elysia';

export const sseTestModule = withAuth(new Elysia({ prefix: '/api/sse' }))
	.post(
		'/test/:companyId',
		async ({ params, user }) => {
			sseEmitter.emit(params.companyId, 'test', {
				message: 'SSE connection is working!',
				companyId: params.companyId,
				triggeredBy: user.email,
				timestamp: new Date().toISOString(),
			});

			return {
				ok: true,
				message: 'Test event sent to all SSE connections for company',
				companyId: params.companyId,
				activeConnections: sseEmitter.connectionCount,
			};
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['SSE'],
				summary: 'Send test SSE event',
				description:
					'Sends a test event to all active SSE connections for a company. ' +
					'Use this to verify frontend SSE handling. The event type is "test" with payload: ' +
					'{ message, companyId, triggeredBy, timestamp }.',
			},
		},
	)
	.get(
		'/debug/connections',
		async ({ user }) => {
			return {
				totalConnections: sseEmitter.connectionCount,
				companies: sseEmitter.companyCount,
				emitterInfo: {
					heartbeatRunning: sseEmitter.isHeartbeatRunning,
				},
				timestamp: new Date().toISOString(),
				requestedBy: user.email,
			};
		},
		{
			auth: true,
			detail: {
				tags: ['SSE'],
				summary: 'Debug: list active SSE connections',
				description:
					'Returns the count of active SSE connections and companies. Useful for debugging connection issues.',
			},
		},
	)
	.post(
		'/simulate/:companyId',
		async ({ params, body, user }) => {
			const { eventCount, intervalMs, eventType } = body;
			const count = Math.min(eventCount ?? 5, 20);
			const interval = Math.max(intervalMs ?? 1000, 200);
			const type = eventType ?? 'device.status';

			appLogger.info(
				'[SSE] Simulation started by %s: %d %s events for company %s (interval: %dms)',
				user.email,
				count,
				type,
				params.companyId,
				interval,
			);

			// Fire-and-forget simulation
			(async () => {
				for (let i = 0; i < count; i++) {
					await new Promise((r) => setTimeout(r, interval));

					let data: Record<string, unknown>;
					switch (type) {
						case 'device.status':
							data = {
								deviceId: `sim-device-${i}`,
								connectionStatus: i % 2 === 0 ? 'online' : 'offline',
								hawkbitUpdateStatus: ['pending', 'in_sync', 'error', 'registered'][i % 4],
								lastPollAt: new Date().toISOString(),
								ipAddress: `192.168.1.${100 + i}`,
							};
							break;
						case 'device.deployment':
							data = {
								deviceId: `sim-device-${i}`,
								controllerId: `sim-controller-${i}`,
								status: 'pending',
								message: `Simulated deployment event #${i}`,
								timestamp: new Date().toISOString(),
							};
							break;
						case 'devices.batch':
							// NEW: simulate the COALESCED format (what the Flutter app receives in
							// production). Buffers via statusCoalescer; flush is automatic.
							statusCoalescer.record(params.companyId, {
								id: `sim-device-${i}`,
								s: i % 2 === 0 ? 'connected' : 'disconnected',
								u: ['in_sync', 'pending', 'error', 'registered'][i % 4],
								t: new Date().toISOString(),
							});
							continue;
						default:
							data = {
								message: `Simulated ${type} event #${i}`,
								index: i,
								timestamp: new Date().toISOString(),
							};
					}

					sseEmitter.emit(params.companyId, type, data);
					appLogger.debug('[SSE] Simulated event %d/%d: %s', i + 1, count, type);
				}
				appLogger.info('[SSE] Simulation complete: %d events sent', count);
			})();

			return {
				ok: true,
				message: `Simulation started: ${count} ${type} events every ${interval}ms`,
				companyId: params.companyId,
				eventCount: count,
				intervalMs: interval,
				eventType: type,
			};
		},
		{
			auth: true,
			companyRole: 'viewer',
			params: t.Object({
				companyId: t.String({ format: 'uuid' }),
			}),
			body: t.Object({
				eventCount: t.Optional(
					t.Number({ minimum: 1, maximum: 20, description: 'Number of events to send (1-20)' }),
				),
				intervalMs: t.Optional(
					t.Number({ minimum: 200, maximum: 10000, description: 'Interval between events in ms' }),
				),
				eventType: t.Optional(
					t.String({
						description: 'SSE event type: device.status, device.deployment, devices.batch, etc.',
					}),
				),
			}),
			detail: {
				tags: ['SSE'],
				summary: 'Simulate SSE events',
				description:
					'Simulates a stream of SSE events for testing frontend real-time updates. ' +
					'Sends `eventCount` events (1-20) with `intervalMs` spacing. ' +
					'Supports event types: device.status, device.deployment, devices.batch. ' +
					'Defaults: 5 events, 1000ms interval, device.status type.',
			},
		},
	);
