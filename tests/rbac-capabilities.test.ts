import { describe, expect, test } from 'bun:test';
import {
	CAPABILITIES,
	COMPANY_ROLES,
	hasCapability,
	MINIMUM_ROLE_FOR,
	normalizeRole,
	type PermissionMap,
	ROLE_ALIASES,
	ROLE_DEFAULTS,
	resolvePermissions,
} from '@common/auth/capabilities';

describe('rbac capabilities', () => {
	test('factory defaults per role', () => {
		expect([...resolvePermissions('owner')]).toEqual([...CAPABILITIES]);
		expect(resolvePermissions('manager').has('company.delete')).toBe(false);
		expect(resolvePermissions('manager').has('members.manage')).toBe(true);
		expect(resolvePermissions('operator').has('devices.write')).toBe(true);
		expect(resolvePermissions('operator').has('members.manage')).toBe(false);
		expect(resolvePermissions('observer').has('devices.read')).toBe(true);
		expect(resolvePermissions('observer').has('devices.write')).toBe(false);
	});

	test('override grants a capability the role lacks by default', () => {
		const override: PermissionMap = { 'devices.delete': true };
		expect(hasCapability('operator', 'devices.delete', override)).toBe(true);
		expect(hasCapability('observer', 'rollouts.create', { 'rollouts.create': true })).toBe(true);
	});

	test('override denies a capability the role has by default', () => {
		const override: PermissionMap = { 'devices.write': false };
		expect(hasCapability('manager', 'devices.write', override)).toBe(false);
		expect(hasCapability('operator', 'devices.write', override)).toBe(false);
	});

	test('owner company.delete can be denied by override, everything else kept', () => {
		const override: PermissionMap = { 'company.delete': false };
		const granted = resolvePermissions('owner', override);
		expect(granted.has('company.delete')).toBe(false);
		expect(granted.has('members.manage')).toBe(true);
	});

	test('legacy role aliases normalize', () => {
		expect(normalizeRole('admin')).toBe('manager');
		expect(normalizeRole('viewer')).toBe('observer');
		expect(normalizeRole('manager')).toBe('manager');
		expect(normalizeRole('unknown')).toBeNull();
	});

	test('minimum-role table is total and ordered', () => {
		for (const capability of CAPABILITIES) {
			expect(MINIMUM_ROLE_FOR[capability]).toBeDefined();
		}
		const level = { observer: 1, operator: 2, manager: 3, owner: 4 };
		expect(level[MINIMUM_ROLE_FOR['company.delete']]).toBe(4);
		expect(level[MINIMUM_ROLE_FOR['devices.read']]).toBe(1);
	});

	test('role sets are internally consistent', () => {
		for (const role of COMPANY_ROLES) {
			for (const capability of ROLE_DEFAULTS[role]) {
				expect(CAPABILITIES).toContain(capability);
			}
		}
		expect(Object.keys(ROLE_ALIASES).sort()).toEqual(['admin', 'viewer']);
	});
});
