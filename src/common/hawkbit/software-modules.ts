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

	async uploadArtifact(
		smId: number,
		file: File,
		params?: { filename?: string; md5sum?: string; sha1sum?: string; sha256sum?: string },
	): Promise<HawkbitArtifact> {
		/**
		 * hawkBit does NOT auto-detect artifact size from multipart uploads.
		 * Spring's MultipartFile.getSize() returns 0 when the HTTP client
		 * sends FormData without per-part Content-Length (Bun's fetch behavior).
		 *
		 * Fix: Build the multipart/form-data body manually as a raw Buffer
		 * with an explicit Content-Length header. This guarantees Spring Boot
		 * correctly parses the file size and hawkBit stores it in the DB.
		 */
		const filename = params?.filename ?? file.name;
		const boundary = `----NinbusFormBoundary${Date.now().toString(36)}`;

		// Read file content as Uint8Array
		const fileBytes = new Uint8Array(await file.arrayBuffer());

		// Build multipart body: --boundary\r\n headers \r\n\r\n data \r\n--boundary--\r\n
		const headerPart =
			`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
			`Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
		const headerBytes = Buffer.from(headerPart);
		const footerBytes = Buffer.from(`\r\n--${boundary}--\r\n`);
		const body = Buffer.concat([headerBytes, fileBytes, footerBytes]);

		return hawkbitRequest<HawkbitArtifact>({
			method: 'POST',
			path: `/rest/v1/softwaremodules/${smId}/artifacts`,
			query: {
				filename,
				md5sum: params?.md5sum,
				sha1sum: params?.sha1sum,
				sha256sum: params?.sha256sum,
			},
			body,
			headers: {
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': String(body.length),
			},
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
