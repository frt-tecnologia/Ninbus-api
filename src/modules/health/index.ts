import { db } from '@common/db';
import { sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { DeviceSyncEngine } from '@modules/devices/sync';

export const healthModule = new Elysia({ prefix: '/health' }).get(
	'/',
	async () => {
		const startTime = Date.now();

		// Check database connection
		let dbStatus = 'healthy';
		try {
			await db.execute(sql`SELECT 1`);
		} catch {
			dbStatus = 'unhealthy';
		}

		const responseTime = Date.now() - startTime;

		const syncState = DeviceSyncEngine.getState();

		return {
			status: (dbStatus === 'healthy' ? 'ok' : 'degraded') as 'ok' | 'degraded',
			timestamp: new Date().toISOString(),
			uptime: process.uptime(),
			database: dbStatus,
			responseTime: `${responseTime}ms`,
				sync: {
				mode: syncState.mode,
				lastSyncAt: syncState.lastFullSyncAt?.toISOString() ?? null,
				isRunning: syncState.isRunning,
				devicesSynced: syncState.totalSynced,
				lastDurationMs: syncState.lastDurationMs,
				errors: syncState.errors,
			},
		};
	},
	{
		detail: {
			tags: ['Health'],
			summary: 'Health check endpoint',
			description: 'Returns server health status and database connectivity',
		},
		response: t.Object({
			status: t.Union([t.Literal('ok'), t.Literal('degraded')]),
			timestamp: t.String(),
			uptime: t.Number(),
			database: t.String(),
			responseTime: t.String(),
			sync: t.Object({
				mode: t.Union([t.Literal('periodic'), t.Literal('on_demand'), t.Literal('hybrid')]),
				lastSyncAt: t.Union([t.String(), t.Null()]),
				isRunning: t.Boolean(),
				devicesSynced: t.Number(),
				lastDurationMs: t.Number(),
				errors: t.Number(),
			}),
		}),
	},
);
