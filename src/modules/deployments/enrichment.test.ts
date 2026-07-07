/**
 * Unit tests for deployment enrichment — local DB merge & historical target data.
 *
 * Covers the fixes for:
 * - H1 (empty target lists in old deployments) — enrichOrphanedDeployment / enrichDeployment
 *   must surface targetIds, targetCount, artifactVersion from the local DB record.
 * - H2 (inconsistent version) — `version` must equal the artifact version, not hawkBit's
 *   internal DS timestamp.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { hawkbitDistributionSets } from '@common/hawkbit/client';
import {
	type LocalDeploymentRecord,
	enrichDeployment,
	enrichOrphanedDeployment,
} from '@modules/deployments/enrichment';

// Monkey-patch the shared client object (stable across Bun versions, unlike mock.module).
const realGetStatistics = hawkbitDistributionSets.getStatistics;
let statsResult: unknown = { actions: { total: 3, FINISHED: 3 } };
let statsShouldThrow = false;

beforeEach(() => {
	statsResult = { actions: { total: 3, FINISHED: 3 } };
	statsShouldThrow = false;
	hawkbitDistributionSets.getStatistics = (async () => {
		if (statsShouldThrow) throw new Error('503');
		return statsResult as any;
	}) as any;
});

afterEach(() => {
	hawkbitDistributionSets.getStatistics = realGetStatistics;
});

function makeLocal(overrides: Partial<LocalDeploymentRecord> = {}): LocalDeploymentRecord {
	return {
		id: 'dep-uuid-1',
		name: 'Deploy Firmware v2.1.0 (todos os veículos)',
		hawkbitDsId: 42,
		artifactType: 'firmware-ninbus',
		artifactName: 'ninbus-firmware-test',
		artifactVersion: '2.1.0',
		artifactOriginalFile: 'firmware-v2.1.0.bin',
		targetCount: 3,
		targetIds: JSON.stringify(['DEV1', 'DEV2', 'DEV3']),
		createdBy: null,
		creatorEmail: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-02T00:00:00Z'),
		...overrides,
	};
}

const dsFixture = {
	id: 42,
	name: 'ds-uuid',
	version: 'v-1781981079402', // internal timestamp (should NOT leak as version)
	type: 'ninbus-firmware-ninbus',
	typeName: 'Ninbus Firmware Ninbus',
	description: 'Deploy Firmware v2.1.0 | artifact: ninbus-firmware-test | uuid: abc',
	createdAt: 1781981079402,
	lastModifiedAt: 1781981079402,
	deleted: false,
	locked: true,
	complete: true,
	valid: true,
} as any;

// ---------------------------------------------------------------------------
// enrichOrphanedDeployment (pure — no hawkBit dependency)
// ---------------------------------------------------------------------------
describe('enrichOrphanedDeployment', () => {
	test('surfaces artifactVersion as version (not the internal DS version)', () => {
		const result = enrichOrphanedDeployment(makeLocal());
		expect(result.version).toBe('2.1.0');
		expect(result.artifactVersion).toBe('2.1.0');
	});

	test('includes the full historical targetIds list', () => {
		const result = enrichOrphanedDeployment(makeLocal());
		expect(result.targetIds).toEqual(['DEV1', 'DEV2', 'DEV3']);
		expect(result.targetCount).toBe(3);
	});

	test('includes artifact audit metadata', () => {
		const result = enrichOrphanedDeployment(makeLocal());
		expect(result.artifactName).toBe('ninbus-firmware-test');
		expect(result.artifactOriginalFile).toBe('firmware-v2.1.0.bin');
		expect(result.displayName).toBe('Deploy Firmware v2.1.0 (todos os veículos)');
	});

	test('marks a finished targetCount as completed', () => {
		const result = enrichOrphanedDeployment(makeLocal());
		expect(result.status).toBe('completed');
		expect(result.statistics.totalTargets).toBe(3);
		expect(result.statistics.finished).toBe(3);
	});

	test('handles missing targetIds (null) without throwing', () => {
		const result = enrichOrphanedDeployment(makeLocal({ targetIds: null }));
		expect(result.targetIds).toBeUndefined();
		expect(result.targetCount).toBe(3);
	});

	test('handles malformed targetIds JSON gracefully', () => {
		const result = enrichOrphanedDeployment(makeLocal({ targetIds: 'not-valid-json{' }));
		expect(result.targetIds).toBeUndefined();
	});

	test('handles non-array targetIds payload', () => {
		const result = enrichOrphanedDeployment(
			makeLocal({ targetIds: JSON.stringify({ not: 'array' }) }),
		);
		expect(result.targetIds).toBeUndefined();
	});

	test('filters non-string entries from targetIds', () => {
		const result = enrichOrphanedDeployment(
			makeLocal({ targetIds: JSON.stringify(['DEV1', 123, null, 'DEV2']) }),
		);
		expect(result.targetIds).toEqual(['DEV1', 'DEV2']);
	});

	test('uses null artifactVersion → undefined version', () => {
		const result = enrichOrphanedDeployment(makeLocal({ artifactVersion: null }));
		expect(result.version).toBeUndefined();
		expect(result.artifactVersion).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// enrichDeployment (with local DB merge)
// ---------------------------------------------------------------------------
describe('enrichDeployment — local DB merge', () => {
	test('uses artifactVersion (from local) as version — not the DS internal timestamp', async () => {
		const result = await enrichDeployment(dsFixture, makeLocal());
		expect(result.version).toBe('2.1.0');
		expect(result.artifactVersion).toBe('2.1.0');
	});

	test('merges targetIds from local record (historical truth)', async () => {
		const result = await enrichDeployment(dsFixture, makeLocal());
		expect(result.targetIds).toEqual(['DEV1', 'DEV2', 'DEV3']);
		expect(result.targetCount).toBe(3);
		expect(result.artifactName).toBe('ninbus-firmware-test');
	});

	test('prefers local name as displayName', async () => {
		const result = await enrichDeployment(dsFixture, makeLocal());
		expect(result.displayName).toBe('Deploy Firmware v2.1.0 (todos os veículos)');
	});

	test('falls back to DS version when no local record', async () => {
		const result = await enrichDeployment(dsFixture, undefined);
		expect(result.version).toBe('v-1781981079402');
		expect(result.artifactName).toBeUndefined();
		expect(result.targetIds).toBeUndefined();
		expect(result.targetCount).toBeUndefined();
	});

	test('falls back to DS description parsing for displayName without local', async () => {
		const result = await enrichDeployment(dsFixture, undefined);
		expect(result.displayName).toBe('Deploy Firmware v2.1.0');
	});

	test('falls back to DS version when local has no artifactVersion', async () => {
		const result = await enrichDeployment(dsFixture, makeLocal({ artifactVersion: null }));
		expect(result.version).toBe('v-1781981079402');
	});

	test('computes status completed when all actions finished', async () => {
		statsResult = { actions: { total: 3, FINISHED: 3 } };
		const result = await enrichDeployment(dsFixture, makeLocal());
		expect(result.status).toBe('completed');
		expect(result.statistics.finished).toBe(3);
	});

	test('returns unknown status when statistics fetch fails', async () => {
		statsShouldThrow = true;
		const result = await enrichDeployment(dsFixture, makeLocal());
		expect(result.status).toBe('unknown');
	});
});
