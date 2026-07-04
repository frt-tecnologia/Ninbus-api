import { defineConfig } from 'drizzle-kit';

/**
 * OFFLINE generate config for drizzle-kit generate.
 *
 * `generate` is primarily a schema-vs-snapshot diff, but this drizzle-kit
 * version also introspects the shared Postgres (bun auto-loads .env). Because
 * the same database hosts hawkBit's sp_* tables (managed by hawkBit's JPA
 * schema) and a schema_version table, `tablesFilter` RESTRICTS Drizzle to
 * Ninbus-managed tables ONLY. Without it, `generate` emits DROP SEQUENCE/DROP
 * statements for foreign objects — catastrophic for hawkBit.
 */
export default defineConfig({
	schema: './src/common/db/schema/index.ts',
	out: './drizzle',
	dialect: 'postgresql',
	tablesFilter: [
		'user', 'session', 'account', 'verification',
		'companies', 'company_members', 'pending_company_members',
		'categories', 'devices', 'device_category_assignments',
		'posts', 'artifacts', 'deployments',
		'activity_log', 'device_connections',
	],
	verbose: true,
	strict: true,
});
