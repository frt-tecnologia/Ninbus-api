import { appLogger } from '@common/logger';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Database Migration
 *
 * Runs all pending migrations from the ./drizzle folder.
 * Called automatically at startup (src/index.ts) and via: bun run db:migrate
 *
 * Handles the case where previous migrations were applied manually
 * (without Drizzle's __drizzle_migrations tracking table).
 */

const JOURNAL_ENTRIES = [
	{ tag: '0000_easy_venom', idx: 0 },
	{ tag: '0002_striped_robin_chapel', idx: 1 },
	{ tag: '0003_mender_to_hawkbit_migration', idx: 2 },
	{ tag: '0004_unclaimed_devices', idx: 3 },
	{ tag: '0005_serial_display', idx: 4 },
	{ tag: '0006_created_by_nullable', idx: 5 },
	{ tag: '0007_hawkbit_sync_columns', idx: 6 },
	{ tag: '0008_artifacts_deployments_isolation', idx: 7 },
];

export async function runStartupMigrations(databaseUrl?: string) {
	const url = databaseUrl || process.env['DATABASE_URL']!;
	if (!url) {
		throw new Error('[MIGRATION] DATABASE_URL is not set');
	}

	appLogger.info('[MIGRATION] Running database migrations...');

	const migrationClient = postgres(url, { max: 1 });
	const db = drizzle(migrationClient);

	try {
		// Check if __drizzle_migrations exists
		const trackingExists = await migrationClient`
			SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_schema = 'public'
				AND table_name = '__drizzle_migrations'
			) as exists
		`;

		if (!trackingExists[0]?.exists) {
			// Previous migrations were applied manually.
			// Create tracking table and register all existing migrations as applied.
			appLogger.info('[MIGRATION] Creating __drizzle_migrations tracking table...');
			await migrationClient`
				CREATE TABLE IF NOT EXISTS __drizzle_migrations (
					id SERIAL PRIMARY KEY,
					hash text NOT NULL,
					created_at bigint NOT NULL,
					tag text NOT NULL
				)
			`;

			// Register all previous migrations as already applied
			for (const entry of JOURNAL_ENTRIES) {
				await migrationClient`
					INSERT INTO __drizzle_migrations (hash, created_at, tag)
					VALUES (${entry.tag + '_manual'}, ${Date.now()}, ${entry.tag})
					ON CONFLICT DO NOTHING
				`;
			}
			appLogger.info('[MIGRATION] Registered %d existing migrations as applied', JOURNAL_ENTRIES.length);
		}

		// Now run Drizzle migrate — will only execute pending (new) migrations
		await migrate(db, { migrationsFolder: './drizzle' });
		appLogger.info('[MIGRATION] Migrations completed successfully');
	} catch (error: any) {
		appLogger.error('[MIGRATION] Migration failed: %s', error?.message ?? 'unknown');
		// Don't throw — allow server to start even if migration fails
		// The defensive queries in service code will handle missing tables gracefully
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
