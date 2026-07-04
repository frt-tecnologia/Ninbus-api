import { hawkbitConfig } from '@common/config/hawkbit';
/**
 * Test database cleanup helper.
 *
 * Deletes ALL rows from every table in the correct FK order.
 * Also cleans hawkBit targets/distributions/software modules when enabled.
 *
 * Usage: import { cleanTestDatabase } from './test-helpers';
 *        await cleanTestDatabase();
 */
import { db } from '@common/db';
import { hawkbitDistributionSets } from '@common/hawkbit/distribution-sets';
import { hawkbitSoftwareModules } from '@common/hawkbit/software-modules';
import { hawkbitTargets } from '@common/hawkbit/targets';
import { sql } from 'drizzle-orm';

/**
 * Truncates all local DB tables — respects FK order.
 * Uses CASCADE so dependent rows are removed automatically.
 */
export async function cleanTestDatabase(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE
		device_category_assignments,
		artifacts,
		deployments,
		devices,
		device_connections,
		pending_company_members,
		company_members,
		companies,
		categories,
		activity_log,
		posts,
		session,
		account,
		verification,
		"user"
	CASCADE`);
}

/**
 * Cleans all hawkBit entities (targets, distribution sets, software modules).
 * Only runs when HAWKBIT_ENABLED=true — silently skips otherwise.
 */
export async function cleanHawkbitData(): Promise<void> {
	if (!hawkbitConfig.enabled) return;

	try {
		// Delete all targets
		const targets = await hawkbitTargets.list({ limit: 500 });
		for (const t of targets.content) {
			await hawkbitTargets.delete(t.controllerId);
		}

		// Delete all distribution sets
		const ds = await hawkbitDistributionSets.list({ limit: 500 });
		for (const d of ds.content) {
			await hawkbitDistributionSets.delete(d.id);
		}

		// Delete all software modules
		const sm = await hawkbitSoftwareModules.list({ limit: 500 });
		for (const s of sm.content) {
			await hawkbitSoftwareModules.delete(s.id);
		}
	} catch {
		// Silently ignore — hawkBit may be unavailable in test env
	}
}

/**
 * Full cleanup: hawkBit + local DB. Call in afterAll() or global teardown.
 */
export async function cleanAll(): Promise<void> {
	await cleanHawkbitData();
	await cleanTestDatabase();
}
