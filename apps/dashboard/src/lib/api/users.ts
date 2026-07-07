import type { ActionResponse, ListResponse, PendingDesignation, User } from '@/types/domain';
import { http } from './http';

/**
 * User & designation service — platform-wide user listing + designations.
 *
 * Endpoints consumed:
 *  GET    /api/admin/users                       → all users (with isSuperAdmin)
 *  GET    /api/admin/pending-designations        → pending designations
 *  POST   /api/companies/:id/members             → designate email (creates pending if no account)
 *  DELETE /api/companies/:id/designations/:id    → cancel designation
 */
export const userService = {
	async list(): Promise<ListResponse<User>> {
		return http.get<ListResponse<User>>('/admin/users');
	},
};

export interface CreateDesignationInput {
	email: string;
	role: string;
}

export const designationService = {
	async listPending(): Promise<ListResponse<PendingDesignation>> {
		return http.get<ListResponse<PendingDesignation>>('/admin/pending-designations');
	},

	/** Designate an email to a company. If the user already has an account they
	 *  gain access immediately; otherwise a PENDING designation is created that
	 *  activates when they sign up. Backed by POST /companies/:id/members. */
	async create(companyId: string, input: CreateDesignationInput): Promise<ActionResponse> {
		return http.post<ActionResponse>(`/companies/${companyId}/members`, input);
	},

	async cancel(companyId: string, designationId: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(`/companies/${companyId}/designations/${designationId}`);
	},
};
