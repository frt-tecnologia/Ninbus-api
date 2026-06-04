import { appLogger } from '@common/logger';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

/**
 * Database Migration
 *
 * Runs all pending migrations from the ./drizzle folder.
 * Called automatically at startup (src/index.ts) and via: bun run db:migrate
 *
 * Handles the case where previous migrations were applied manually
 * (without Drizzle's __drizzle_migrations tracking table).
 */

const PREVIOUS_MIGRATIONS = [
	'0000_easy_venom',
	'0002_striped_robin_chapel',
	'0003_mender_to_hawkbit_migration',
	'0004_unclaimed_devices',
	'0005_serial_display',
	'0006_created_by_nullable',
	'0007_hawkbit_sync_columns',
];

/** Tables created by each migration tag — used to verify they actually exist. */
const MIGRATION_TABLES: Record<string, string[]> = {
	'0000_easy_venom': ['account', 'session', 'user', 'verification'],
	'0002_striped_robin_chapel': ['companies'],
	'0003_mender_to_hawkbit_migration': [],
	'0004_unclaimed_devices': [],
	'0005_serial_display': [],
	'0006_created_by_nullable': [],
	'0007_hawkbit_sync_columns': [],
	'0008_artifacts_deployments_isolation': ['artifacts', 'deployments'],
};

export async function runStartupMigrations(databaseUrl?: string) {
	const url = databaseUrl || process.env['DATABASE_URL']!;
	if (!url) {
		throw new Error('[MIGRATION] DATABASE_URL is not set');
	}

	appLogger.info('[MIGRATION] Running database migrations...');

	const client = postgres(url, { max: 1 });
	const db = drizzle(client);

	try {
		// Check if __drizzle_migrations tracking table exists
		const trackingResult = await client`
			SELECT EXISTS (
				SELECT FROM information_schema.tables
				WHERE table_schema = 'public'
				AND table_name = '__drizzle_migrations'
			) as exists
		`;
		const trackingExists = trackingResult[0]?.exists;

		if (!trackingExists) {
			// First time: previous migrations were applied manually.
			// Create tracking table and register only the ones that actually exist.
			appLogger.info('[MIGRATION] No tracking table found — verifying existing tables...');

			// Get all existing tables in public schema
			const existingTables = await client`
				SELECT tablename FROM pg_tables WHERE schemaname = 'public'
			`;
			const tableSet = new Set(existingTables.map((r: any) => r.tablename));

			// Create tracking table
			await client`
				CREATE TABLE IF NOT EXISTS __drizzle_migrations (
					id SERIAL PRIMARY KEY,
					hash text NOT NULL UNIQUE,
					created_at bigint NOT NULL,
					tag text NOT NULL
				)
			`;

			// Register each migration as applied only if its tables exist
			for (const tag of PREVIOUS_MIGRATIONS) {
				const tables = MIGRATION_TABLES[tag] ?? [];
				const allExist = tables.length === 0 || tables.every((t) => tableSet.has(t));

				if (allExist) {
					await client`
						INSERT INTO __drizzle_migrations (hash, created_at, tag)
						VALUES (${tag + '_manual'}, ${Date.now()}, ${tag})
						ON CONFLICT (hash) DO NOTHING
					`;
					appLogger.info('[MIGRATION] ✓ Registered as applied: %s', tag);
				} else {
					appLogger.info('[MIGRATION] ✗ Not applied (missing tables): %s', tag);
				}
			}
		} else {
			// Tracking table exists — check if any registered migrations have missing tables
			// This handles the case where we incorrectly registered 0008 as applied
			const registered = await client`
				SELECT tag FROM __drizzle_migrations
			`;
			const registeredTags = new Set(registered.map((r: any) => r.tag));

			for (const [tag, tables] of Object.entries(MIGRATION_TABLES)) {
				if (!registeredTags.has(tag)) continue;
				if (tables.length === 0) continue;

				// Check if tables actually exist
				const tableCheck = await client`
					SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(${tables})
				`;
				const foundTables = new Set(tableCheck.map((r: any) => r.tablename));
				const missingTables = tables.filter((t) => !foundTables.has(t));

				if (missingTables.length > 0) {
					appLogger.info('[MIGRATION] Fixing: %s registered but tables missing (%s) — removing entry', tag, missingTables.join(', '));
					await client`
						DELETE FROM __drizzle_migrations WHERE tag = ${tag}
					`;
				}
			}
		}

		// Now run Drizzle migrate — will only execute migrations not in the tracking table
		await migrate(db, { migrationsFolder: './drizzle' });
		appLogger.info('[MIGRATION] Migrations completed successfully');
	} catch (error: any) {
		appLogger.error('[MIGRATION] Migration failed: %s', error?.message ?? 'unknown');
		// Don't throw — allow server to start even if migration fails
		// Defensive queries in service code handle missing tables gracefully
	} finally {
		await client.end();
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
