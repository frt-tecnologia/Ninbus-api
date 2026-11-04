/**
 * SSE module — real-time event push.
 *
 * Routes:
 *   GET /api/companies/:id/sse — company-scoped stream (membership required)
 *   GET /api/sse/global        — ALL events, ALL companies (super admin only)
 *
 * Event catalog lives in docs/rbac-roles-and-permissions.md and the client
 * cache keys map events→invalidations in apps/dashboard/src/lib/sse.
 *
 * Handlers MUST return `new Response(stream)` — letting Elysia serialize a
 * bare ReadableStream corrupts the wire (chunks go out as JSON byte-maps)
 * and duplicates the content-type header.
 */

import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { withAuth } from '@common/middleware/auth-guard';
import { sseEmitter } from '@common/sse/emitter';
import { Elysia, t } from 'elysia';

const SSE_HEADERS: Record<string, string> = {
	'content-type': 'text/event-stream',
	'cache-control': 'no-cache',
	connection: 'keep-alive',
	'x-accel-buffering': 'no',
};

const sseUnavailable = () =>
	new Response(JSON.stringify({ error: 'Service Unavailable', message: 'SSE is disabled' }), {
		status: 503,
		headers: { 'content-type': 'application/json' },
	});

function sseResponse(stream: ReadableStream): Response {
	return new Response(stream, { headers: SSE_HEADERS });
}

export const sseModule = withAuth(new Elysia({ prefix: '/api/companies/:companyId' })).get(
	'/sse',
	async ({ params, user, request }) => {
		if (!env.SSE_ENABLED) return sseUnavailable();

		appLogger.info('[SSE] Company connection: companyId=%s user=%s', params.companyId, user.email);
		const stream = new ReadableStream({
			start(controller) {
				const conn = sseEmitter.addConnection(params.companyId, controller);
				request.signal.addEventListener('abort', () => sseEmitter.removeConnection(conn), {
					once: true,
				});
			},
		});
		return sseResponse(stream);
	},
	{
		auth: true,
		companyRole: 'observer',
		params: t.Object({ companyId: t.String({ format: 'uuid' }) }),
		detail: {
			hide: true,
			tags: ['SSE'],
			summary: 'Company SSE stream',
			description: 'SSE events scoped to one company. Requires company membership.',
		},
	},
);

export const sseGlobalModule = withAuth(new Elysia({ prefix: '/api/sse' })).get(
	'/global',
	async ({ user, request }) => {
		if (!env.SSE_ENABLED) return sseUnavailable();

		appLogger.info('[SSE] Global connection: user=%s', user.email);
		const stream = new ReadableStream({
			start(controller) {
				const conn = sseEmitter.addConnection('__global__', controller);
				request.signal.addEventListener('abort', () => sseEmitter.removeConnection(conn), {
					once: true,
				});
			},
		});
		return sseResponse(stream);
	},
	{
		auth: true,
		superAdmin: true,
		detail: {
			hide: true,
			tags: ['SSE'],
			summary: 'Global SSE stream (super admin)',
			description: 'All events from all companies. Platform super admin only.',
		},
	},
);
