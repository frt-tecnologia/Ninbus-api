import { describe, expect, it, afterAll } from 'bun:test';
import { db } from '@common/db';
import { artifacts, companies } from '@common/db/schema';
import { findSoftwareModule } from '@modules/deployments/helpers';
import { cleanAll } from './test-helpers';

const COMPANY_A = '00000000-0000-0000-0000-0000000000aa';
const COMPANY_B = '00000000-0000-0000-0000-0000000000bb';

afterAll(async () => { await cleanAll(); });

describe('findSoftwareModule — tenant isolation (Frente B)', () => {
  it('setup: empresas A e B + seus artifacts', async () => {
    await db.insert(companies).values([
      { id: COMPANY_A, name: 'Empresa A' },
      { id: COMPANY_B, name: 'Empresa B' },
    ]);
    await db.insert(artifacts).values([
      { companyId: COMPANY_A, hawkbitSmId: 9999, name: 'fw-empresa-a', artifactType: 'firmware-ninbus', version: '1.0' },
      { companyId: COMPANY_B, hawkbitSmId: 8888, name: 'fw-empresa-b', artifactType: 'firmware-ninbus', version: '1.0' },
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
