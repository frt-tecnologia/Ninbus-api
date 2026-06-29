/**
 * EC2 Database Cleanup Script
 *
 * Truncates ALL data from both databases:
 *   1. ninbus_api_db  — Ninbus API (users, sessions, companies, devices, etc.)
 *   2. ninbus_hawkbit_db — hawkBit (targets, distribution sets, software modules, etc.)
 *
 * Usage:
 *   bun run scripts/ec2-clean-db.ts
 *
 * Requires: .env with DATABASE_URL and HAWKBIT_DATABASE_URL pointing to EC2 RDS.
 * If DATABASE_URL in .env points to local/neon, override with env vars:
 *   DATABASE_URL=postgresql://postgres:@host:5432/ninbus_api_db?sslmode=require \
 *   bun run scripts/ec2-clean-db.ts
 */

import { db, closeDatabase } from '@common/db';
import { sql } from 'drizzle-orm';

// ─── hawkBit DB tables (standard hawkBit 1.0.3 schema) ───
const HAWKBIT_TABLES = [
	'sp_action_status',          // action status history
	'sp_action',                 // deployment actions
	'sp_target_status',          // target status history
	'sp_target_update_status',   // target update status
	'sp_target_security_token',  // security tokens
	'sp_target_filter_query',    // target filter queries
	'sp_tag',                    // target/software module tags
	'sp_target_tag',             // target ↔ tag
	'sp_software_module_tag',    // software module ↔ tag
	'sp_distribution_set_tag',   // distribution set ↔ tag
	'sp_distribution_set_type',  // distribution set types (keep? has required defaults)
	'sp_distribution_set',       // distribution sets
	'sp_distribution_set_type_element', // DS type → SM type mapping
	'sp_software_module',        // software modules
	'sp_artifact',               // artifact binaries metadata
	'sp_target',                 // targets (devices)
	'sp_target_attributes',      // target attributes
];

async function cleanNinbusApiDb() {
	console.log('── Cleaning Ninbus API database ──');

	try {
		await db.execute(sql`TRUNCATE TABLE
			device_category_assignments,
			devices,
			company_members,
			companies,
			categories,
			posts,
			session,
			account,
			verification,
			"user"
		CASCADE`);

		console.log('  ✅ All Ninbus API tables truncated');
	} catch (error: any) {
		console.error('  ❌ Failed:', error.message);
		throw error;
	}
}

async function cleanHawkbitDb() {
	console.log('── Cleaning hawkBit database ──');

	// Read hawkBit DB URL from env — it's a separate database
	const hawkbitDbUrl = process.env.HAWKBIT_DATABASE_URL;
	if (!hawkbitDbUrl) {
		console.log('  ⚠️  HAWKBIT_DATABASE_URL not set, skipping hawkBit cleanup');
		return;
	}

	// Convert JDBC URL to PostgreSQL connection string
	// jdbc:postgresql://host:5432/dbname?params → postgresql://user:pass@host:5432/dbname?params
	const pgUrl = hawkbitDbUrl.replace('jdbc:postgresql://', 'postgresql://');
	const user = process.env.HAWKBIT_DB_USER || 'postgres';
	const pass = process.env.HAWKBIT_DB_PASS || '';

	// Build connection string with auth
	const url = new URL(pgUrl);
	url.username = user;
	url.password = pass;
	const connectionString = url.toString();

	// Connect to hawkBit DB directly
	const { drizzle } = await import('drizzle-orm/postgres-js');
	const postgres = (await import('postgres')).default;
	const client = postgres(connectionString);
	const hawkbitDb = drizzle(client);

	try {
		// Truncate all hawkBit tables in one statement
		const tableList = HAWKBIT_TABLES.map(t => `"public"."${t}"`).join(', ');

		await hawkbitDb.execute(sql.raw(`TRUNCATE TABLE ${tableList} CASCADE`));
		console.log('  ✅ All hawkBit tables truncated');

		// Recreate required default distribution set type (hawkBit needs this)
		await hawkbitDb.execute(sql.raw(`
			INSERT INTO sp_distribution_set_type (id, created_at, last_modified_at, name, key, deleted)
			VALUES (nextval('sp_distribution_set_type_seq'), now(), now(), 'os', 'os', false)
			ON CONFLICT DO NOTHING
		`));
		console.log('  ✅ Default DS type "os" ensured');
	} catch (error: any) {
		// Some tables might not exist depending on hawkBit version/config
		console.error('  ⚠️  Some tables may not exist:', error.message);
		console.log('  Trying individual tables...');

		for (const table of HAWKBIT_TABLES) {
			try {
				await hawkbitDb.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
			} catch {
				// Skip tables that don't exist
			}
		}
		console.log('  ✅ Available hawkBit tables truncated');
	} finally {
		await client.end();
	}
}

async function main() {
	console.log('🧹 EC2 Database Cleanup\n');

	const dbUrl = process.env.DATABASE_URL || '';
	if (!dbUrl) {
		console.error('❌ DATABASE_URL not set. Exiting.');
		process.exit(1);
	}

	console.log(`  API DB:  ${dbUrl.replace(/\/\/[^@]+@/, '//***@')}`);
	const hawkUrl = process.env.HAWKBIT_DATABASE_URL || '';
	if (hawkUrl) {
		console.log(`  hawkBit DB: ${hawkUrl.replace(/\/\/[^@]+@/, '//***@')}`);
	}
	console.log('');

	await cleanNinbusApiDb();
	await cleanHawkbitDb();

	console.log('\n✅ Done. Databases are clean.');
	await closeDatabase();
	process.exit(0);
}

main().catch((error) => {
	console.error('Fatal:', error);
	process.exit(1);
});
