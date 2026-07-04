import type { ActionResponse, Device, DeviceCategory, ListResponse } from '@/types/domain';
import { http } from './http';

/**
 * Category service — device groups (garage / bus_line / region / custom).
 *
 * Endpoints consumed (super admin bypasses companyRole):
 *  GET    /api/companies/:id/categories                 → list categories
 *  PUT    /api/companies/:id/categories/:catId          → rename category
 *  DELETE /api/companies/:id/categories/:catId          → delete category
 *  GET    /api/companies/:id/categories/:catId/devices  → list members
 *  POST   /api/companies/:id/categories/:catId/devices  → add members
 *  DELETE /api/companies/:id/categories/:catId/devices/:devId → remove member
 */
export const categoryService = {
	/** List all categories (groups) of a company. */
	async listByCompany(companyId: string): Promise<ListResponse<DeviceCategory>> {
		return http.get<ListResponse<DeviceCategory>>(`/companies/${companyId}/categories`);
	},

	/** Rename a category. */
	async rename(companyId: string, categoryId: string, name: string): Promise<ActionResponse> {
		return http.put<ActionResponse>(`/companies/${companyId}/categories/${categoryId}`, { name });
	},

	/** Delete a category. */
	async remove(companyId: string, categoryId: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(`/companies/${companyId}/categories/${categoryId}`);
	},

	/** List devices that are members of a category. */
	async listMembers(companyId: string, categoryId: string): Promise<ListResponse<Device>> {
		return http.get<ListResponse<Device>>(
			`/companies/${companyId}/categories/${categoryId}/devices`,
		);
	},

	/** Add devices to a category (idempotent bulk). */
	async addMembers(
		companyId: string,
		categoryId: string,
		deviceIds: string[],
	): Promise<ActionResponse> {
		return http.post<ActionResponse>(`/companies/${companyId}/categories/${categoryId}/devices`, {
			deviceIds,
		});
	},

	/** Remove a single device from a category. */
	async removeMember(
		companyId: string,
		categoryId: string,
		deviceId: string,
	): Promise<ActionResponse> {
		return http.delete<ActionResponse>(
			`/companies/${companyId}/categories/${categoryId}/devices/${deviceId}`,
		);
	},
};
