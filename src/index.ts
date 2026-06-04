import { env } from '@common/config/env';
import { closeDatabase } from '@common/db';
import { appLogger } from '@common/logger';
import { DeviceSyncEngine } from './modules/devices/sync';
import { createApp } from './app';
import { runStartupMigrations } from './scripts/migrate';

// Run migrations before starting the server
await runStartupMigrations();

// Verify critical tables exist
try {
	const { db } = await import('@common/db');
	const testResult = await db.execute({ sql: 'SELECT count(*) as cnt FROM artifacts' });
	appLogger.info('[STARTUP] artifacts table OK (%s rows)', testResult[0]?.cnt ?? 0);
	const testResult2 = await db.execute({ sql: 'SELECT count(*) as cnt FROM deployments' });
	appLogger.info('[STARTUP] deployments table OK (%s rows)', testResult2[0]?.cnt ?? 0);
} catch (e: any) {
	appLogger.error({ err: e }, '[STARTUP] CRITICAL: artifacts/deployments table check failed: %s', e?.message);
}

// App entrypoint
const app = createApp();

const server = app.listen({
	hostname: env.HOST,
	port: env.PORT,
});

// Startup logs
appLogger.info(`[SERVER] Running at ${env.HOST}:${env.PORT}`);
appLogger.info(`[API] Documentation available at ${env.HOST}:${env.PORT}/docs`);
appLogger.info(`[HEALTH] Health check endpoint: ${env.HOST}:${env.PORT}/health`);

// Graceful shutdown
let isShuttingDown = false;

const shutdown = async (signal: string) => {
	if (isShuttingDown) return;
	isShuttingDown = true;

	appLogger.info(`${signal} received, shutting down gracefully...`);

	try {
		await Promise.resolve(server.stop());
		DeviceSyncEngine.stopBackgroundSync();
		await closeDatabase();
		appLogger.info('Server closed successfully');
		process.exit(0);
	} catch (error) {
		appLogger.error({ error }, 'Error during shutdown');
		process.exit(1);
	}
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
