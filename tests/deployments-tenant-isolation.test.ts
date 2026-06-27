import { afterAll, describe, expect, it } from 'bun:test';
import { db } from '@common/db';
import { artifacts, companies } from '@common/db/schema';
import { findSoftwareModule } from '@modules/deployments/helpers';
import { cleanAll } from './test-helpers';

const COMPANY_A = '00000000-0000-0000-0000-0000000000aa';
const COMPANY_B = '00000000-0000-0000-0000-0000000000bb';

afterAll(async () => {
	await cleanAll();
});

describe('findSoftwareModule — tenant isolation (Frente B)', () => {
	it('setup: empresas A e B + seus artifacts', async () => {
		await db.insert(companies).values([
			{ id: COMPANY_A, name: 'Empresa A' },
			{ id: COMPANY_B, name: 'Empresa B' },
		]);
		await db.insert(artifacts).values([
			{
				companyId: COMPANY_A,
				hawkbitSmId: 9999,
				name: 'fw-empresa-a',
				artifactType: 'firmware-ninbus',
				version: '1.0',
			},
			{
				companyId: COMPANY_B,
				hawkbitSmId: 8888,
				name: 'fw-empresa-b',
				artifactType: 'firmware-ninbus',
				version: '1.0',
			},
		]);
	});

	it('B-T1 feliz: empresa A acha próprio artifact por nome', async () => {
		expect((await findSoftwareModule(COMPANY_A, 'fw-empresa-a'))?.id).toBe(9999);
	});

	it('B-T2 feliz: empresa A acha próprio artifact por SM ID', async () => {
		expect((await findSoftwareModule(COMPANY_A, '9999'))?.id).toBe(9999);
	});

	it('B-T3 CRITICO: empresa A NAO acha SM ID 8888 (empresa B) — cross-tenant bloqueado', async () => {
		expect(await findSoftwareModule(COMPANY_A, '8888')).toBeNull();
	});

	it('B-T5: empresa A tenta nome da empresa B → null', async () => {
		expect(await findSoftwareModule(COMPANY_A, 'fw-empresa-b')).toBeNull();
	});

	it('B-T6: brute-force SM IDs 1..10 → todos null p/ empresa A', async () => {
		for (let i = 1; i <= 10; i++) {
			expect(await findSoftwareModule(COMPANY_A, String(i))).toBeNull();
		}
	});

	it('B-T4: nome inexistente → null', async () => {
		expect(await findSoftwareModule(COMPANY_A, 'nao-existe')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// REGRESSÃO: findSoftwareModule robustez (versão NÃO é filtro de identidade)
// ---------------------------------------------------------------------------
// Bug: createDeployment passava smVersion = data.version ?? '1.0'. Se o artifact
// tinha versão != '1.0' e o app não enviava version, o lookup por SM ID numérico
// falhava (caminho numérico não tinha relax) → 422 "not found". Versão é metadado,
// não identidade. Fix: SM ID é único global → não filtra por versão/type.
// ---------------------------------------------------------------------------
describe('findSoftwareModule — robustez de versão (regressão 422)', () => {
	// Artifact da empresa A com versão NÃO-default (2.1.0), referenciado por SM ID.
	const SM_V210 = 7777;
	const NAME_V210 = 'fw-versao-divergente';

	it('setup: artifact com versão 2.1.0', async () => {
		await db.insert(artifacts).values([
			{
				companyId: COMPANY_A,
				hawkbitSmId: SM_V210,
				name: NAME_V210,
				artifactType: 'firmware-ninbus',
				version: '2.1.0',
			},
		]);
	});

	it('R-T1 FIX: SM ID numérico + version="1.0" (default) ≠ stored "2.1.0" → ACHA (não 422)', async () => {
		// Antes do fix: numeric ID + 1.0 != 2.1.0 → null → 422. Agora: SM ID é único, não filtra versão.
		expect(
			(await findSoftwareModule(COMPANY_A, String(SM_V210), '1.0', 'firmware-ninbus'))?.id,
		).toBe(SM_V210);
	});

	it('R-T2 FIX: SM ID numérico sem version/type → ACHA', async () => {
		expect((await findSoftwareModule(COMPANY_A, String(SM_V210)))?.id).toBe(SM_V210);
	});

	it('R-T3 FIX: SM ID com version explícito "2.1.0" → ACHA', async () => {
		expect((await findSoftwareModule(COMPANY_A, String(SM_V210), '2.1.0'))?.id).toBe(SM_V210);
	});

	it('R-T4 FIX: name + version default "1.0" ≠ stored "2.1.0" → ACHA (relax por nome)', async () => {
		expect((await findSoftwareModule(COMPANY_A, NAME_V210, '1.0', 'firmware-ninbus'))?.id).toBe(
			SM_V210,
		);
	});

	it('R-T5 FIX: name + artifactType errado → ACHA (relax por nome, type é advisory)', async () => {
		expect(
			(await findSoftwareModule(COMPANY_A, NAME_V210, undefined, 'firmware-controller'))?.id,
		).toBe(SM_V210);
	});

	it('R-T6 cross-tenant ainda bloqueado: empresa B não acha SM_V210 da empresa A por ID', async () => {
		expect(await findSoftwareModule(COMPANY_B, String(SM_V210))).toBeNull();
	});
});
