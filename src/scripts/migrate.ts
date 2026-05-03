import { appLogger } from '@common/logger';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Database Migration
 *
 * Runs all pending migrations from the ./drizzle folder.
 * Called automatically at startup (src/index.ts) and via: bun run db:migrate
 */

export async function runStartupMigrations(databaseUrl?: string) {
	const url = databaseUrl || process.env['DATABASE_URL']!;
	if (!url) {
		throw new Error('[MIGRATION] DATABASE_URL is not set');
	}

	appLogger.info('[MIGRATION] Running database migrations...');

	const migrationClient = postgres(url, { max: 1 });
	const db = drizzle(migrationClient);

	try {
		await migrate(db, { migrationsFolder: './drizzle' });
		appLogger.info('[MIGRATION] Migrations completed successfully');
	} catch (error) {
		appLogger.error({ error }, '[MIGRATION] Migration failed');
		throw error;
	} finally {
		await migrationClient.end();
	}
}

// Allow standalone execution: bun run db:migrate
const isDirectRun = import.meta.main || process.argv[1]?.endsWith('migrate.ts');
if (isDirectRun) {
	runStartupMigrations()
		.then(() => {
			appLogger.info('[MIGRATION] Migration script finished');
			process.exit(0);
		})
		.catch((error) => {
			console.error('[MIGRATION] Critical error:', error);
			process.exit(1);
		});
}
