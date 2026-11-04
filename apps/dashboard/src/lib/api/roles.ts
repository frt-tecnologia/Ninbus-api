/**
 * RBAC v2 — per-company role permission policies (platform super admin).
 * GET  /admin/companies/:id/role-policies → effective matrix per role
 * PUT  /admin/companies/:id/role-policies → replace one role's overrides
 */

import type { ActionResponse } from '@/types/domain';
import { http } from './http';

export interface RolePolicy {
	role: 'owner' | 'manager' | 'operator' | 'observer';
	defaults: string[];
	overrides: Record<string, boolean>;
	effective: string[];
}

export const rolePolicyService = {
	async list(companyId: string): Promise<{ data: RolePolicy[] }> {
		return http.get<{ data: RolePolicy[] }>(`/admin/companies/${companyId}/role-policies`);
	},

	async save(
		companyId: string,
		role: RolePolicy['role'],
		overrides: Record<string, boolean>,
	): Promise<ActionResponse> {
		return http.put<ActionResponse>(`/admin/companies/${companyId}/role-policies`, {
			role,
			overrides,
		});
	},
};
