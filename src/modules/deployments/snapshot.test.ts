/**
 * Unit tests for the deployment target status snapshot.
 *
 * Covers the STICKY-FINISHED rule: once a target is 'installed', the snapshot
 * is frozen and NEVER overwritten by a later cancellation — preserves the
 * tracking that the device DID update successfully before the deployment was
 * cancelled.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { db } from '@common/db';
import { companies, deployments } from '@common/db/schema';
import { eq } from 'drizzle-orm';
import {
	updateTargetSnapshot,
	freezeTargetAsInstalled,
	freezeTargetAsCanceledIfNotInstalled,
	getSnapshot,
	isTargetFrozen,
	isTargetInstalled,
	type TargetStatusSnapshot,
} from '@modules/deployments/snapshot';

// Each test creates a unique deployment row so tests are isolated.
let testDsId = 900000;
const TEST_CONTROLLER = 'TEST0000000SNAPSHOT';
let testCompanyId: string;

async function seedDeployment(): Promise<number> {
	const dsId = testDsId++;
	await db
		.insert(deployments)
		.values({
			companyId: testCompanyId,
			hawkbitDsId: dsId,
			name: `snapshot-test-${dsId}`,
			artifactType: 'firmware-controller',
			targetStatusSnapshot: {},
		})
		.returning();
	return dsId;
}

async function cleanupDeployment(dsId: number): Promise<void> {
	await db.delete(deployments).where(eq(deployments.hawkbitDsId, dsId));
}

beforeEach(async () => {
	// Create a real company to satisfy the FK constraint.
	const [c] = await db
		.insert(companies)
		.values({ name: `snapshot-test-co-${Date.now()}-${Math.random()}` })
		.returning();
	testCompanyId = c.id;
});

afterAll(async () => {
	// Best-effort cleanup of test companies.
	try {
		await db.delete(companies).where(eq(companies.name, 'snapshot-test-co-' as any));
	} catch { /* ignore */ }
});

describe('snapshot — STICKY-FINISHED rule', () => {
	let dsId: number;

	beforeEach(async () => {
		dsId = await seedDeployment();
	});

	test('freezeTargetAsInstalled sets phase=installed + frozen=true', async () => {
		await freezeTargetAsInstalled(dsId, TEST_CONTROLLER, 100);
		const snap = await getSnapshot(dsId);
		expect(snap[TEST_CONTROLLER].phase).toBe('installed');
		expect(snap[TEST_CONTROLLER].frozen).toBe(true);
		expect(snap[TEST_CONTROLLER].finalStatus).toBe('finished');
		await cleanupDeployment(dsId);
	});

	test('STICKY: installed target is NOT overwritten by cancel', async () => {
		// First, mark as installed.
		await freezeTargetAsInstalled(dsId, TEST_CONTROLLER, 100);
		// Then try to cancel — must be ignored.
		await freezeTargetAsCanceledIfNotInstalled(dsId, TEST_CONTROLLER, 100);

		const snap = await getSnapshot(dsId);
		expect(snap[TEST_CONTROLLER].phase).toBe('installed'); // STILL installed!
		expect(snap[TEST_CONTROLLER].frozen).toBe(true);
		expect(isTargetInstalled(snap, TEST_CONTROLLER)).toBe(true);
		await cleanupDeployment(dsId);
	});

	test('non-installed target IS marked canceled on cancel', async () => {
		// First, mark as downloading (not terminal).
		await updateTargetSnapshot(dsId, TEST_CONTROLLER, {
			phase: 'downloading',
			actionId: 100,
			actionType: 'update',
		});
		// Then cancel — should succeed.
		await freezeTargetAsCanceledIfNotInstalled(dsId, TEST_CONTROLLER, 100);

		const snap = await getSnapshot(dsId);
		expect(snap[TEST_CONTROLLER].phase).toBe('canceled');
		expect(snap[TEST_CONTROLLER].frozen).toBe(true);
		await cleanupDeployment(dsId);
	});

	test('STICKY: frozen canceled does NOT downgrade to assigned', async () => {
		// Mark canceled first.
		await freezeTargetAsCanceledIfNotInstalled(dsId, TEST_CONTROLLER, 100);
		// Try to update to non-terminal 'assigned' — must be ignored.
		await updateTargetSnapshot(dsId, TEST_CONTROLLER, {
			phase: 'assigned',
			actionId: 100,
			actionType: 'update',
		});

		const snap = await getSnapshot(dsId);
		expect(snap[TEST_CONTROLLER].phase).toBe('canceled'); // kept
		await cleanupDeployment(dsId);
	});

	test('STICKY: frozen canceled CAN upgrade to installed (late feedback)', async () => {
		// Mark canceled first (race: cancel arrived before feedback).
		await freezeTargetAsCanceledIfNotInstalled(dsId, TEST_CONTROLLER, 100);
		// Late feedback: device actually finished — should upgrade.
		await freezeTargetAsInstalled(dsId, TEST_CONTROLLER, 100);

		const snap = await getSnapshot(dsId);
		expect(snap[TEST_CONTROLLER].phase).toBe('installed'); // upgraded
		await cleanupDeployment(dsId);
	});

	test('isTargetFrozen / isTargetInstalled helpers', async () => {
		let snap: TargetStatusSnapshot = {};
		expect(isTargetFrozen(snap, TEST_CONTROLLER)).toBe(false);
		expect(isTargetInstalled(snap, TEST_CONTROLLER)).toBe(false);

		await updateTargetSnapshot(dsId, TEST_CONTROLLER, {
			phase: 'downloading',
			actionId: 1,
			actionType: 'update',
		});
		snap = await getSnapshot(dsId);
		// downloading is not terminal → not frozen yet
		expect(isTargetFrozen(snap, TEST_CONTROLLER)).toBe(false);

		await freezeTargetAsInstalled(dsId, TEST_CONTROLLER, 1);
		snap = await getSnapshot(dsId);
		expect(isTargetFrozen(snap, TEST_CONTROLLER)).toBe(true);
		expect(isTargetInstalled(snap, TEST_CONTROLLER)).toBe(true);
		await cleanupDeployment(dsId);
	});
});
