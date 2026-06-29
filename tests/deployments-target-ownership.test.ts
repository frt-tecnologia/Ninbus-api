/**
 * Target ownership isolation tests (Frente C).
 *
 * Routes that receive a raw `targetId` in the path (action status, ddi-check)
 * must verify the target belongs to the path's company BEFORE calling hawkBit.
 * `companyRole` alone only checks membership — not that the target is owned.
 *
 * These tests exercise `isTargetOwnedByCompany` (the guard) directly, since
 * the route handler delegates to it. No hawkBit calls (HAWKBIT_ENABLED=false).
 */
import { describe, expect, it, afterAll } from 'bun:test';
import { db } from '@common/db';
import { companies, devices } from '@common/db/schema';
import { isTargetOwnedByCompany } from '@modules/deployments/helpers';
import { cleanAll } from './test-helpers';

const COMPANY_A = '00000000-0000-0000-0000-0000000000aa';
const COMPANY_B = '00000000-0000-0000-0000-0000000000bb';
const TARGET_A = 'AAA1111111111111';
const TARGET_B = 'BBB2222222222222';

afterAll(async () => {
	await cleanAll();
});

describe('isTargetOwnedByCompany — tenant isolation (Frente C)', () => {
	it('setup: empresa A possui TARGET_A, empresa B possui TARGET_B', async () => {
		await db.insert(companies).values([
			{ id: COMPANY_A, name: 'Empresa A' },
			{ id: COMPANY_B, name: 'Empresa B' },
		]);
		await db.insert(devices).values([
			{ name: 'Device A', serialNumber: 'AAA1111111111111', hawkbitTargetId: TARGET_A, companyId: COMPANY_A, status: 'accepted' },
			{ name: 'Device B', serialNumber: 'BBB2222222222222', hawkbitTargetId: TARGET_B, companyId: COMPANY_B, status: 'accepted' },
		]);
	});

	it('C-T1 feliz: empresa A é dona de TARGET_A', async () => {
		expect(await isTargetOwnedByCompany(COMPANY_A, TARGET_A)).toBe(true);
	});

	it('C-T2 CRÍTICO: empresa A NÃO é dona de TARGET_B (empresa B)', async () => {
		// Before Frente C, the action-status / ddi-check routes called hawkBit
		// with this targetId directly → leaked data. Now the guard rejects it.
		expect(await isTargetOwnedByCompany(COMPANY_A, TARGET_B)).toBe(false);
	});

	it('C-T3: target inexistente → false', async () => {
		expect(await isTargetOwnedByCompany(COMPANY_A, 'ZZZ9999999999999')).toBe(false);
	});

	it('C-T4: empresa B é dona de TARGET_B (simetria)', async () => {
		expect(await isTargetOwnedByCompany(COMPANY_B, TARGET_B)).toBe(true);
	});

	it('C-T5: empresa B NÃO é dona de TARGET_A', async () => {
		expect(await isTargetOwnedByCompany(COMPANY_B, TARGET_A)).toBe(false);
	});
});
