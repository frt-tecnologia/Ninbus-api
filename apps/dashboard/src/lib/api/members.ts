import { http } from './http';
import type {
	User,
	ListResponse,
	ActionResponse,
} from '@/types/domain';

/**
 * Member service — manage members WITHIN a company (promote, demote, remove).
 *
 * Endpoints consumed (super admin bypasses membership via companyRole macro):
 *  GET    /api/admin/companies/:id/members           → list members
 *  POST   /api/companies/:id/members                 → add member
 *  PUT    /api/companies/:id/members/:userId         → change role
 *  DELETE /api/companies/:id/members/:userId         → remove member
 */
export type CompanyRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface AddMemberInput {
	email: string;
	role: CompanyRole;
}

export interface UpdateMemberInput {
	role: CompanyRole;
}

export interface Member {
	id: string;
	userId: string;
	companyId: string;
	role: CompanyRole | string;
	createdAt: string;
	/** Joined from the user table — always present in list responses. */
	name: string;
	email: string;
}

export const memberService = {
	async list(companyId: string): Promise<ListResponse<Member>> {
		return http.get<ListResponse<Member>>(
			`/admin/companies/${companyId}/members`,
		);
	},

	async add(companyId: string, input: AddMemberInput): Promise<ActionResponse> {
		return http.post<ActionResponse>(
			`/companies/${companyId}/members`,
			input,
		);
	},

	async updateRole(
		companyId: string,
		userId: string,
		input: UpdateMemberInput,
	): Promise<ActionResponse> {
		return http.put<ActionResponse>(
			`/companies/${companyId}/members/${userId}`,
			input,
		);
	},

	async remove(companyId: string, userId: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(
			`/companies/${companyId}/members/${userId}`,
		);
	},
};
