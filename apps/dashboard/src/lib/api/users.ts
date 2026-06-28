import { http } from './http';
import type { User, ListResponse, PendingDesignation, ActionResponse } from '@/types/domain';

/**
 * User & designation service — platform-wide user listing + designations.
 *
 * Endpoints consumed:
 *  GET    /api/admin/users                       → all users (with isSuperAdmin)
 *  GET    /api/admin/pending-designations        → pending designations
 *  POST   /api/companies/:id/designations        → designate email
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
		return http.get<ListResponse<PendingDesignation>>(
			'/admin/pending-designations',
		);
	},

	async create(
		companyId: string,
		input: CreateDesignationInput,
	): Promise<ActionResponse> {
		return http.post<ActionResponse>(
			`/companies/${companyId}/designations`,
			input,
		);
	},

	async cancel(
		companyId: string,
		designationId: string,
	): Promise<ActionResponse> {
		return http.delete<ActionResponse>(
			`/companies/${companyId}/designations/${designationId}`,
		);
	},
};
