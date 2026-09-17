import { http } from './http';
import type {
	ActionResponse,
	FirmwareRelease,
	FirmwareUploadInput,
	ListResponse,
} from '@/types/domain';

/**
 * Firmware service — factory firmware catalog (super admin only).
 *
 * Endpoints consumed:
 *  GET    /api/admin/firmware            → list releases (chronological DESC)
 *  GET    /api/admin/firmware/latest     → latest release per type
 *  POST   /api/admin/firmware            → publish a release (multipart upload)
 *  DELETE /api/admin/firmware/:releaseId → remove a release
 */
export const firmwareService = {
	async list(type?: string): Promise<ListResponse<FirmwareRelease>> {
		return http.get<ListResponse<FirmwareRelease>>('/admin/firmware', { type });
	},

	async latest(type?: string): Promise<{ data: FirmwareRelease | null }> {
		return http.get<{ data: FirmwareRelease | null }>('/admin/firmware/latest', { type });
	},

	async upload(input: FirmwareUploadInput): Promise<ActionResponse> {
		// Multipart upload — the API expects a binary file field, not JSON.
		const form = new FormData();
		form.append('file', input.file);
		form.append('name', input.name);
		form.append('version', input.version);
		form.append('artifactType', input.artifactType);
		if (input.description) form.append('description', input.description);
		return http.post<ActionResponse>('/admin/firmware', form as unknown as Record<string, unknown>);
	},

	async remove(releaseId: string): Promise<ActionResponse> {
		return http.delete<ActionResponse>(`/admin/firmware/${encodeURIComponent(releaseId)}`);
	},
};
