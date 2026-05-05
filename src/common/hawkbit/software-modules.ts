/**
 * hawkBit Software Module API — CRUD, artifact upload/download.
 * Replaces Mender Artifacts.
 */
import { hawkbitRequest } from './http';
import type {
	HawkbitArtifact,
	HawkbitPagedResponse,
	HawkbitSoftwareModule,
	HawkbitSoftwareModuleType,
} from './types';

export const hawkbitSoftwareModules = {
	list(params?: { offset?: number; limit?: number; sort?: string; q?: string }): Promise<
		HawkbitPagedResponse<HawkbitSoftwareModule>
	> {
		return hawkbitRequest({ method: 'GET', path: '/rest/v1/softwaremodules', query: params });
	},

	get(smId: number): Promise<HawkbitSoftwareModule> {
		return hawkbitRequest({ method: 'GET', path: `/rest/v1/softwaremodules/${smId}` });
	},

	create(data: {
		name: string;
		version: string;
		type: string;
		description?: string;
		vendor?: string;
	}): Promise<HawkbitSoftwareModule> {
		return hawkbitRequest<HawkbitSoftwareModule[]>({
			method: 'POST',
			path: '/rest/v1/softwaremodules',
			body: [data],
		}).then((arr) => arr[0]);
	},

	update(smId: number, data: { description?: string }): Promise<void> {
		return hawkbitRequest({ method: 'PUT', path: `/rest/v1/softwaremodules/${smId}`, body: data });
	},

	delete(smId: number): Promise<void> {
		return hawkbitRequest({ method: 'DELETE', path: `/rest/v1/softwaremodules/${smId}` });
	},

	uploadArtifact(
		smId: number,
		file: File,
		params?: { filename?: string; md5sum?: string; sha1sum?: string; sha256sum?: string },
	): Promise<HawkbitArtifact> {
		const formData = new FormData();
		formData.append('file', file);
		return hawkbitRequest({
			method: 'POST',
			path: `/rest/v1/softwaremodules/${smId}/artifacts`,
			query: {
				filename: params?.filename ?? file.name,
				md5sum: params?.md5sum,
				sha1sum: params?.sha1sum,
				sha256sum: params?.sha256sum,
			},
			body: formData,
		});
	},

	listArtifacts(smId: number): Promise<HawkbitArtifact[]> {
		return hawkbitRequest({ method: 'GET', path: `/rest/v1/softwaremodules/${smId}/artifacts` });
	},

	getArtifact(smId: number, artifactId: number): Promise<HawkbitArtifact> {
		return hawkbitRequest({
			method: 'GET',
			path: `/rest/v1/softwaremodules/${smId}/artifacts/${artifactId}`,
		});
	},

	deleteArtifact(smId: number, artifactId: number): Promise<void> {
		return hawkbitRequest({
			method: 'DELETE',
			path: `/rest/v1/softwaremodules/${smId}/artifacts/${artifactId}`,
		});
	},
};

export const hawkbitSoftwareModuleTypes = {
	list(): Promise<HawkbitPagedResponse<HawkbitSoftwareModuleType>> {
		return hawkbitRequest({ method: 'GET', path: '/rest/v1/softwaremoduletypes' });
	},

	get(typeId: number): Promise<HawkbitSoftwareModuleType> {
		return hawkbitRequest({ method: 'GET', path: `/rest/v1/softwaremoduletypes/${typeId}` });
	},

	create(data: {
		key: string;
		name: string;
		description?: string;
		minArtifacts?: number;
		maxAssignments?: number;
	}): Promise<HawkbitSoftwareModuleType> {
		return hawkbitRequest<HawkbitSoftwareModuleType[]>({
			method: 'POST',
			path: '/rest/v1/softwaremoduletypes',
			body: [data],
		}).then((arr) => arr[0]);
	},
};
