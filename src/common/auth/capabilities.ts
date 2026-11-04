/** Company role capabilities — RBAC v2 (docs/rbac-roles-and-permissions.md). */

export const COMPANY_ROLES = ['owner', 'manager', 'operator', 'observer'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const ROLE_LABELS: Record<CompanyRole, string> = {
	owner: 'Titular',
	manager: 'Gestor',
	operator: 'Operador',
	observer: 'Observador',
};

export const CAPABILITIES = [
	'devices.read',
	'devices.write',
	'devices.delete',
	'groups.manage',
	'members.manage',
	'rollouts.create',
	'rollouts.abort',
	'rollouts.delete',
	'releases.publish',
	'releases.delete',
	'company.settings',
	'company.delete',
	'audit.read',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type PermissionMap = Partial<Record<Capability, boolean>>;

/** Legacy→new role mapping for pre-RBAC-v2 data. */
export const ROLE_ALIASES: Record<string, CompanyRole> = {
	admin: 'manager',
	viewer: 'observer',
};

export const normalizeRole = (role: string): CompanyRole | null => {
	if ((COMPANY_ROLES as readonly string[]).includes(role)) return role as CompanyRole;
	return ROLE_ALIASES[role] ?? null;
};

/** Minimum role required by a capability when no override applies. */
export const ROLE_DEFAULTS: Record<CompanyRole, readonly Capability[]> = {
	owner: CAPABILITIES, // everything, including company.delete
	manager: [
		'devices.read',
		'devices.write',
		'devices.delete',
		'groups.manage',
		'members.manage',
		'rollouts.create',
		'rollouts.abort',
		'rollouts.delete',
		'releases.publish',
		'releases.delete',
		'company.settings',
		'audit.read',
	],
	operator: [
		'devices.read',
		'devices.write',
		'groups.manage',
		'rollouts.create',
		'rollouts.abort',
		'audit.read',
	],
	observer: ['devices.read', 'audit.read'],
};

/** defaults ∪ override — override wins per capability key. */
export function resolvePermissions(
	role: CompanyRole,
	override?: PermissionMap | null,
): Set<Capability> {
	const granted = new Set<Capability>(ROLE_DEFAULTS[role]);
	if (override) {
		for (const [capability, allowed] of Object.entries(override) as [Capability, boolean][]) {
			if (allowed) granted.add(capability);
			else granted.delete(capability);
		}
	}
	return granted;
}

export const hasCapability = (
	role: CompanyRole,
	capability: Capability,
	override?: PermissionMap | null,
): boolean => resolvePermissions(role, override).has(capability);

/** Minimum role required by each capability when no override applies. */
export const MINIMUM_ROLE_FOR: Record<Capability, CompanyRole> = {
	'company.delete': 'owner',
	'company.settings': 'manager',
	'members.manage': 'manager',
	'releases.publish': 'manager',
	'releases.delete': 'manager',
	'devices.delete': 'manager',
	'rollouts.delete': 'manager',
	'rollouts.create': 'operator',
	'rollouts.abort': 'operator',
	'groups.manage': 'operator',
	'devices.write': 'operator',
	'devices.read': 'observer',
	'audit.read': 'observer',
};
