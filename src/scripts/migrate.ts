import { appLogger } from '@common/logger';
import postgres from 'postgres';
import fs from 'fs';

/**
 * Database Migration
 *
 * Applies pending migrations directly via SQL (bypassing Drizzle's migrator).
 * Drizzle's migrate() doesn't work well when previous migrations were applied
 * manually (creates tracking table in wrong schema, etc).
 *
 * Each migration uses IF NOT EXISTS so it's safe to re-run.
 */

export async function runStartupMigrations(databaseUrl?: string) {
	const url = databaseUrl || process.env['DATABASE_URL']!;
	if (!url) {
		throw new Error('[MIGRATION] DATABASE_URL is not set');
	}

	appLogger.info('[MIGRATION] Running database migrations...');

	const client = postgres(url, { max: 1 });

	try {
		// Read all migration SQL files from drizzle folder in order
		const migrationsDir = './drizzle';
		const journal = JSON.parse(fs.readFileSync(`${migrationsDir}/meta/_journal.json`, 'utf8'));

		// Get list of existing tables to skip already-applied migrations
		const existingTables = await client`
			SELECT tablename FROM pg_tables WHERE schemaname = 'public'
		`;
		const tableSet = new Set(existingTables.map((r: any) => r.tablename));

		for (const entry of journal.entries) {
			const sqlFile = `${migrationsDir}/${entry.tag}.sql`;

			if (!fs.existsSync(sqlFile)) {
				appLogger.info('[MIGRATION] Skipping %s (no SQL file)', entry.tag);
				continue;
			}

			// Check if this migration's tables already exist
			if (entry.tag === '0000_easy_venom' && tableSet.has('user')) {
				appLogger.info('[MIGRATION] ✓ Already applied: %s', entry.tag);
				continue;
			}
			if (entry.tag === '0002_striped_robin_chapel' && tableSet.has('companies')) {
				appLogger.info('[MIGRATION] ✓ Already applied: %s', entry.tag);
				continue;
			}
			if (entry.tag === '0008_artifacts_deployments_isolation' && tableSet.has('artifacts') && tableSet.has('deployments')) {
				appLogger.info('[MIGRATION] ✓ Already applied: %s', entry.tag);
				continue;
			}
			if (entry.tag === '0010_pending_company_members' && tableSet.has('pending_company_members')) {
				appLogger.info('[MIGRATION] ✓ Already applied: %s', entry.tag);
				continue;
			}
			if (entry.tag === '0011_deployment_target_snapshot' && tableSet.has('deployments')) {
				// Column-level check — re-run ALTER is safe (IF NOT EXISTS), but skip if
				// the column is already present to avoid an unnecessary round-trip.
				const cols = await client`SELECT column_name FROM information_schema.columns
					WHERE table_schema='public' AND table_name='deployments'
					AND column_name='target_status_snapshot'`;
				if (cols.length > 0) {
					appLogger.info('[MIGRATION] ✓ Already applied: %s', entry.tag);
					continue;
				}
			}

			// Apply the migration
			appLogger.info('[MIGRATION] Applying: %s', entry.tag);
			const sql = fs.readFileSync(sqlFile, 'utf8');

			// Split by statement breakpoint and execute each
			const statements = sql
				.split('--> statement-breakpoint')
				.map((s: string) => s.trim())
				.filter((s: string) => s.length > 0 && !s.startsWith('--'));

			for (const stmt of statements) {
				try {
					await client.unsafe(stmt);
				} catch (err: any) {
					// Ignore "already exists" errors
					if (err?.code === '42P07' || err?.code === '42710' || err?.code === '42P06') {
						// already exists — fine
					} else {
						throw err;
					}
				}
			}

			appLogger.info('[MIGRATION] ✓ Applied: %s', entry.tag);
		}

		appLogger.info('[MIGRATION] Migrations completed successfully');
	} catch (error: any) {
		appLogger.error('[MIGRATION] Migration failed: %s', error?.message ?? 'unknown');
		// Don't throw — allow server to start, defensive queries handle missing tables
	} finally {
		await client.end();
	}
}

// Allow standalone execution
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
