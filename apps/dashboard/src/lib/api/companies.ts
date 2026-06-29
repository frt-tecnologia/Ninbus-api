import { http } from './http';
import type {
	Company,
	CompanyDetail,
	CompanyStatusUpdate,
	CreateCompanyInput,
	ListResponse,
	ActionResponse,
} from '@/types/domain';

/**
 * Company service — platform-level company management (super admin).
 *
 * Endpoints consumed:
 *  GET    /api/admin/companies                 → all companies with counts
 *  GET    /api/admin/companies/:id             → company detail
 *  PUT    /api/admin/companies/:id/status      → suspend / activate
 *  POST   /api/companies                       → create company + designate owner
 *  PUT    /api/companies/:id                   → update company
 *  DELETE /api/companies/:id                   → delete company
 */
export const companyService = {
	async list(): Promise<ListResponse<Company>> {
		return http.get<ListResponse<Company>>('/admin/companies');
	},

	async get(companyId: string): Promise<CompanyDetail> {
		return http.get<{ data: CompanyDetail }>(
			`/admin/companies/${companyId}`,
		).then((r) => r.data);
	},

	async create(input: CreateCompanyInput): Promise<ActionResponse> {
		return http.post<ActionResponse>('/companies', input);
	},

	async setStatus(
		companyId: string,
		status: CompanyStatusUpdate,
	): Promise<ActionResponse> {
		return http.put<ActionResponse>(
			`/admin/companies/${companyId}/status`,
			status,
		);
	},

	async update(
		companyId: string,
		data: Partial<Pick<Company, 'name'>>,
	): Promise<ActionResponse> {
		return http.put<ActionResponse>(`/companies/${companyId}`, data);
	},

	async remove(companyId: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(`/companies/${companyId}`);
	},
};
