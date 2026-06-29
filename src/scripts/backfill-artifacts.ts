/**
 * Backfill: associate existing hawkBit Software Modules and Distribution Sets
 * with local artifact/deployment records for a specific company.
 *
 * This is a ONE-TIME script to run after deploying tenant isolation.
 * Without this, existing artifacts in hawkBit won't appear in any company's listing.
 *
 * Usage:
 *   bun run src/scripts/backfill-artifacts.ts <companyId> [createdByUserId]
 *
 * Example:
 *   bun run src/scripts/backfill-artifacts.ts 386d896e-... user-123
 */
import { db } from '@common/db';
import { artifacts, deployments } from '@common/db/schema';
import { hawkbitSoftwareModules, hawkbitDistributionSets } from '@common/hawkbit/client';
import { hawkbitConfig } from '@common/config/hawkbit';
import { appLogger } from '@common/logger';
import { resolveArtifactType } from '@common/hawkbit/client';

async function backfill(companyId: string, createdBy: string | null) {
	if (!hawkbitConfig.enabled) {
		console.error('HAWKBIT_ENABLED must be true to run backfill');
		process.exit(1);
	}

	if (!companyId) {
		console.error('Usage: bun run src/scripts/backfill-artifacts.ts <companyId> [userId]');
		process.exit(1);
	}

	console.log(`[BACKFILL] Starting backfill for company ${companyId}...`);

	// 1. Fetch ALL software modules from hawkBit
	const allSMs = await hawkbitSoftwareModules.list({ limit: 500 });
	console.log(`[BACKFILL] Found ${allSMs.total} Software Modules in hawkBit`);

	// 2. Filter to only Ninbus SMs (have a known artifact type)
	const ninbusSMs = allSMs.content.filter((sm) => {
		const type = resolveArtifactType(sm);
		return type !== null && !sm.deleted;
	});
	console.log(`[BACKFILL] ${ninbusSMs.length} are Ninbus artifacts (not deleted)`);

	// 3. Check which ones already have local records
	const existingArtifacts = await db
		.select({ hawkbitSmId: artifacts.hawkbitSmId })
		.from(artifacts);
	const existingSmIds = new Set(existingArtifacts.map((a) => a.hawkbitSmId));

	const toInsert = ninbusSMs.filter((sm) => !existingSmIds.has(sm.id));
	console.log(`[BACKFILL] ${toInsert.length} need local records (${ninbusSMs.length - toInsert.length} already exist)`);

	// 4. Insert local records
	let inserted = 0;
	for (const sm of toInsert) {
		const artifactType = resolveArtifactType(sm)!;
		// Extract display name from description
		const desc = sm.description ?? '';
		const nameMatch = desc.match(/artifactName:\s*([^|]+)/);
		const displayName = nameMatch ? nameMatch[1]!.trim() : sm.name;
		const fileMatch = desc.match(/originalFile:\s*([^|]+)/);
		const originalFile = fileMatch ? fileMatch[1]!.trim() : null;
		const sizeMatch = desc.match(/payloadBytes:\s*(\d+)/);
		const payloadSize = sizeMatch ? parseInt(sizeMatch[1]!) : null;

		try {
			await db.insert(artifacts).values({
				companyId,
				hawkbitSmId: sm.id,
				name: displayName,
				artifactType,
				version: sm.version || '1.0',
				description: desc.split('|')[0]?.trim() || null,
				originalFilename: originalFile,
				payloadSize,
				createdBy,
			});
			inserted++;
		} catch (error: any) {
			if (error?.code === '23505') {
				console.log(`[BACKFILL] SM #${sm.id} already has a record (race condition), skipping`);
			} else {
				console.error(`[BACKFILL] Failed to insert SM #${sm.id}:`, error?.message);
			}
		}
	}
	console.log(`[BACKFILL] Inserted ${inserted} artifact records`);

	// 5. Backfill deployments
	const allDSs = await hawkbitDistributionSets.list({ limit: 500 });
	const activeDSs = allDSs.content.filter((ds) => !ds.deleted);
	console.log(`[BACKFILL] Found ${activeDSs.length} active Distribution Sets`);

	const existingDeployments = await db
		.select({ hawkbitDsId: deployments.hawkbitDsId })
		.from(deployments);
	const existingDsIds = new Set(existingDeployments.map((d) => d.hawkbitDsId));

	const dsToInsert = activeDSs.filter((ds) => !existingDsIds.has(ds.id));
	console.log(`[BACKFILL] ${dsToInsert.length} deployments need local records`);

	let dsInserted = 0;
	for (const ds of dsToInsert) {
		// Extract name from description
		const desc = ds.description ?? '';
		const nameMatch = desc.match(/^([^|]+)/);
		const displayName = nameMatch ? nameMatch[1]!.trim() : ds.name;
		// Try to extract artifact type from description
		const typeMatch = desc.match(/\(firmware-[a-z-]+\)/);
		const artifactType = typeMatch
			? typeMatch[0]!.replace(/[()]/g, '')
			: 'firmware-ninbus';

		try {
			await db.insert(deployments).values({
				companyId,
				hawkbitDsId: ds.id,
				name: displayName,
				artifactType,
				createdBy,
			});
			dsInserted++;
		} catch (error: any) {
			if (error?.code === '23505') {
				console.log(`[BACKFILL] DS #${ds.id} already has a record, skipping`);
			} else {
				console.error(`[BACKFILL] Failed to insert DS #${ds.id}:`, error?.message);
			}
		}
	}
	console.log(`[BACKFILL] Inserted ${dsInserted} deployment records`);
	console.log(`[BACKFILL] Done! Total: ${inserted} artifacts + ${dsInserted} deployments`);
}

const companyId = process.argv[2];
const createdBy = process.argv[3] || null;

backfill(companyId, createdBy)
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('[BACKFILL] Fatal error:', error);
		process.exit(1);
	});
