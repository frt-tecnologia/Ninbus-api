/**
 * Shared query-cache keys.
 *
 * Convention: `<resource>:<scope>` — the SSE client invalidates by resource
 * token (e.g. every `devices:*` key on `device.claimed`), so building keys
 * here (instead of inline in screens) is what makes selective invalidation
 * work. When Fase 2 adds server-side pagination, the paged variant appends
 * the page/search/sort params to the same prefix.
 */

export const qk = {
	adminCompanies: 'companies:admin',
	adminDevices: 'devices:admin',
	adminUsers: 'users:admin',
	adminDeployments: 'deployments:admin',
	adminActivity: 'activity:admin',
	adminPolling: 'polling:admin',
	firmwareReleases: 'firmware:releases',
	artifactTypes: 'firmware:artifact-types',

	company: (id: string) => `companies:${id}`,
	companyDevices: (id: string) => `devices:company:${id}`,
	companyMembers: (id: string) => `members:${id}`,
	rolePolicies: (id: string) => `role-policies:${id}`,
	companyCategories: (id: string) => `categories:${id}`,
	companyDeployments: (id: string) => `deployments:${id}`,
	companyInvites: (id: string) => `invites:${id}`,
	companyConnections: (id: string, range: string) => `connections:${id}:${range}`,
	companyActivity: (id: string, period: string) => `activity:company:${id}:${period}`,

	/** Aggregate: every company's deployments (overview + deployments screens). */
	allDeployments: (ids: string[]) => `deployments:all:${ids.join(',')}`,
	/** Global pending invites (admin). */
	adminInvites: 'invites:admin',
	/** Latest published factory release for an artifact type. */
	latestRelease: (artifactType: string) => `firmware:latest:${artifactType}`,

	session: 'auth:session',
} as const;

/** Resource token of a key — its part before the first `:`. */
export const resourceOf = (key: string) => key.split(':')[0] ?? key;
