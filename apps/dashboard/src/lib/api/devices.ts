import { http } from './http';
import type {
	Device,
	ListResponse,
	ProvisionDeviceInput,
	ActionResponse,
} from '@/types/domain';

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
		return http.get<ListResponse<Device>>(
			`/admin/companies/${companyId}/devices`,
		);
	},

	async provision(input: ProvisionDeviceInput): Promise<ActionResponse> {
		return http.post<ActionResponse>('/devices/provision', input);
	},

	async deprovision(serialNumber: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(
			`/devices/deprovision/${encodeURIComponent(serialNumber)}`,
		);
	},
};
