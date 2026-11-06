import type {
	ActionResponse,
	Device,
	DeviceCategory,
	ListResponse,
	ProvisionDeviceInput,
} from '@/types/domain';
import { http } from './http';

/**
 * Device service — wraps all device-related API calls.
 *
 * Endpoints consumed:
 *  GET    /api/admin/devices                      → all devices (super admin)
 *  GET    /api/admin/companies/:id/devices        → devices of a company
 *  POST   /api/devices/provision                  → register device by serial
 *  DELETE /api/devices/deprovision/:serialNumber  → remove device
 */
export const deviceService = {
	async listAll(): Promise<ListResponse<Device>> {
		return http.get<ListResponse<Device>>('/admin/devices');
	},

	async listByCompany(companyId: string): Promise<ListResponse<Device>> {
		return http.get<ListResponse<Device>>(`/admin/companies/${companyId}/devices`);
	},

	async provision(input: ProvisionDeviceInput): Promise<ActionResponse> {
		return http.post<ActionResponse>('/devices/provision', input);
	},

	/** Claim a provisioned device for a company (by serial). */
	async claim(
		companyId: string,
		input: { serialNumber: string; name?: string },
	): Promise<ActionResponse> {
		return http.post<ActionResponse>(`/companies/${companyId}/devices`, input);
	},

	/** Update device metadata (name/description) — company-scoped. */
	async update(
		companyId: string,
		deviceId: string,
		input: { name?: string; description?: string },
	): Promise<ActionResponse> {
		return http.put<ActionResponse>(`/companies/${companyId}/devices/${deviceId}`, input);
	},

	/** Link a pending device to hawkBit (admin provides the factory key). */
	async link(companyId: string, deviceId: string, deviceKey: string): Promise<ActionResponse> {
		return http.put<ActionResponse>(`/companies/${companyId}/devices/${deviceId}/link`, {
			deviceKey,
		});
	},

	/** Remove the device from the company (unclaim — hawkBit target preserved). */
	async unlink(companyId: string, deviceId: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(`/companies/${companyId}/devices/${deviceId}`);
	},

	async deprovision(serialNumber: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(`/devices/deprovision/${encodeURIComponent(serialNumber)}`);
	},

	/** Force-refresh every device's connection status from hawkBit. */
	async syncAll(): Promise<ActionResponse> {
		return http.post<ActionResponse>('/admin/devices/sync');
	},

	/** List the categories (groups) assigned to a device. */
	async listCategories(companyId: string, deviceId: string): Promise<ListResponse<DeviceCategory>> {
		return http.get<ListResponse<DeviceCategory>>(
			`/companies/${companyId}/devices/${deviceId}/categories`,
		);
	},

	/** Replace ALL category assignments for a device (N:N). */
	async assignCategories(
		companyId: string,
		deviceId: string,
		categoryIds: string[],
	): Promise<ActionResponse> {
		return http.put<ActionResponse>(`/companies/${companyId}/devices/${deviceId}/categories`, {
			categoryIds,
		});
	},
};
