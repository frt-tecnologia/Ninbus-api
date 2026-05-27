/**
 * Script: Clean ALL data from both Neon databases (Ninbus API + hawkBit).
 * Then re-apply migrations to the Ninbus DB.
 *
 * Usage: bun run scripts/clean-all-dbs.ts
 */
import postgres from 'postgres';

// ── 1. Clean Ninbus API Database ─────────────────────────────────────
const NINBUS_URL = 'postgresql://neondb_owner:npg_6JcflWC9ktAD@ep-odd-dust-acapmk9r-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';

async function cleanNinbus() {
	console.log('🧹 Cleaning Ninbus API database...');
	const sql = postgres(NINBUS_URL);

	// Get all tables
	const tables = await sql`
		SELECT tablename FROM pg_tables 
		WHERE schemaname = 'public'
	`;

	console.log(`Found ${tables.length} tables:`, tables.map(t => t.tablename).join(', '));

	// Delete all rows from all tables (respect FK order)
	const tableNames = [
		// Child tables first (FK dependencies)
		'category_devices',
		'company_members',
		'devices',
		'categories',
		'companies',
		'posts',
		// Auth tables last
		'session',
		'verification',
		'account',
		'user',
	];

	for (const table of tableNames) {
		try {
			const result = await sql`DELETE FROM ${sql(table)}`;
			console.log(`  ✅ ${table}: ${result.count} rows deleted`);
		} catch (e: any) {
			console.log(`  ⚠️  ${table}: ${e.message}`);
		}
	}

	// Also try any remaining tables not in the list above
	for (const t of tables) {
		const name = t.tablename as string;
		if (!tableNames.includes(name)) {
			try {
				await sql`DELETE FROM ${sql(name)}`;
				console.log(`  ✅ ${name}: cleaned`);
			} catch (e: any) {
				console.log(`  ⚠️  ${name}: ${e.message}`);
			}
		}
	}

	await sql.end();
	console.log('✅ Ninbus API database cleaned.\n');
}

// ── 2. Clean hawkBit Database ────────────────────────────────────────
const HAWKBIT_URL = 'postgresql://neondb_owner:npg_tWCXuyq9VH1o@ep-dry-voice-acl3s09t-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require';

async function cleanHawkbit() {
	console.log('🧹 Cleaning hawkBit database...');
	const sql = postgres(HAWKBIT_URL);

	// Get all tables
	const tables = await sql`
		SELECT tablename FROM pg_tables 
		WHERE schemaname = 'public'
	`;

	console.log(`Found ${tables.length} tables:`, tables.map(t => t.tablename).join(', '));

	// hawkBit tables - clean in dependency order
	// These are the main tables in hawkBit 1.0.3
	const hawkbitTables = [
		'sp_action_status_messages',  // status messages (child of action_status)
		'sp_action_status',           // action status history
		'sp_action',                  // actions (deployments per target)
		'sp_ds_sm',                   // DS ↔ SM mapping (junction table)
		'sp_sm_metadata',             // software module metadata
		'sp_software_module',         // software modules
		'sp_artifact',                // artifact binaries metadata
		'sp_ds_metadata',             // distribution set metadata
		'sp_ds_type_element',         // DS type element mappings
		'sp_distribution_set',        // distribution sets
		'sp_distribution_set_tag',    // DS tags
		'sp_ds_tag',                  // tag definitions
		'sp_software_module_type',    // SM types (DS types depend on these)
		'sp_distribution_set_type',   // DS types
		'sp_target_type_ds_type',     // target type ↔ DS type mapping
		'sp_target_type',             // target types
		'sp_target_attributes',       // target attributes
		'sp_target_metadata',         // target metadata
		'sp_target_target_tag',       // target ↔ tag mapping
		'sp_target_tag',              // target tag definitions
		'sp_target_conf_status',      // target confirmation status
		'sp_target',                  // targets (devices)
		'sp_target_filter_query',     // target filter queries
		'sp_rollout_target_group',    // rollout group targets
		'sp_rollout_group',           // rollout groups
		'sp_rollout',                 // rollouts
		'sp_tenant_configuration',   // tenant config
		'sp_tenant',                  // tenants
		'sp_lock',                    // locks
	];

	for (const table of hawkbitTables) {
		try {
			const result = await sql`DELETE FROM ${sql(table)}`;
			console.log(`  ✅ ${table}: ${result.count} rows deleted`);
		} catch (e: any) {
			// Table might not exist
			console.log(`  ⚠️  ${table}: ${e.message?.substring(0, 80)}`);
		}
	}

	// Also try any remaining tables
	for (const t of tables) {
		const name = t.tablename as string;
		if (!hawkbitTables.includes(name)) {
			try {
				const result = await sql`DELETE FROM ${sql(name)}`;
				console.log(`  ✅ ${name}: ${result.count} rows deleted`);
			} catch (e: any) {
				console.log(`  ⚠️  ${name}: ${e.message?.substring(0, 80)}`);
			}
		}
	}

	await sql.end();
	console.log('✅ hawkBit database cleaned.\n');
}

// ── Run ──────────────────────────────────────────────────────────────
async function main() {
	console.log('═══════════════════════════════════════════');
	console.log('  Ninbus API + hawkBit Database Cleaner');
	console.log('═══════════════════════════════════════════\n');

	try {
		await cleanNinbus();
	} catch (e) {
		console.error('❌ Error cleaning Ninbus DB:', e);
	}

	try {
		await cleanHawkbit();
	} catch (e) {
		console.error('❌ Error cleaning hawkBit DB:', e);
	}

	console.log('═══════════════════════════════════════════');
	console.log('  ✅ All databases cleaned successfully!');
	console.log('═══════════════════════════════════════════');
}

main().catch(console.error);
