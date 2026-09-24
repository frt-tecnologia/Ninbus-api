import type {
	ActionResponse,
	FirmwareRelease,
	FirmwareUploadInput,
	ListResponse,
} from '@/types/domain';
import { type DownloadResult, http } from './http';

/**
 * Firmware service — factory firmware catalog (super admin only).
 *
 * Endpoints consumed:
 *  GET    /api/admin/firmware            → list releases (chronological DESC)
 *  GET    /api/admin/firmware/latest     → latest PUBLISHED release per type
 *  POST   /api/admin/firmware            → upload a release (starts as draft)
 *  POST   /api/admin/firmware/deploy     → FORCE update to selected devices
 *  POST   /api/admin/firmware/:id/publish   → make a draft available to users
 *  POST   /api/admin/firmware/:id/unpublish → hide a release (emergency brake)
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
		// http.post passes FormData through verbatim (see http.ts).
		const form = new FormData();
		form.append('file', input.file);
		form.append('name', input.name);
		form.append('version', input.version);
		form.append('artifactType', input.artifactType);
		if (input.description) form.append('description', input.description);
		return http.post<ActionResponse>('/admin/firmware', form);
	},

	async remove(releaseId: string, opts?: { realignFloor?: boolean }): Promise<ActionResponse> {
		return http.delete<ActionResponse>(
			`/admin/firmware/${encodeURIComponent(releaseId)}`,
			opts?.realignFloor ? { realignFloor: 'true' } : undefined,
		);
	},

	/** Force firmware to the given devices (console path). releaseId → test a specific DRAFT. */
	async deploy(
		deviceIds: string[],
		artifactType?: string,
		releaseId?: string,
	): Promise<ActionResponse> {
		return http.post<ActionResponse>('/admin/firmware/deploy', {
			deviceIds,
			...(artifactType ? { artifactType } : {}),
			...(releaseId ? { releaseId } : {}),
		});
	},

	/** Publish a draft — makes it the latest version visible to end users. */
	async publish(releaseId: string): Promise<ActionResponse> {
		return http.post<ActionResponse>(
			`/admin/firmware/${encodeURIComponent(releaseId)}/publish`,
			{},
		);
	},

	/** Unpublish — emergency brake: hides the release from end users. */
	async unpublish(releaseId: string): Promise<ActionResponse> {
		return http.post<ActionResponse>(
			`/admin/firmware/${encodeURIComponent(releaseId)}/unpublish`,
			{},
		);
	},

	/** Download the SERVED artifact — byte-level ground truth (forensics).
	 * part='tar' → the stored package; part='image' → the inner .bin payload. */
	async downloadArtifact(
		releaseId: string,
		part: 'tar' | 'image' = 'tar',
	): Promise<DownloadResult> {
		return http.download(`/admin/firmware/${encodeURIComponent(releaseId)}/artifact`, {
			query: { part },
		});
	},
};
