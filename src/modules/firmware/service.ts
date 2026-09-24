/**
 * Firmware module barrel — re-exports the split submodules so external import
 * sites (routes, tests, app) stay stable. Structure: SKILL.md § Firmware OTA.
 */

export {
	downloadServedArtifact,
	extractImageFromTar,
	type ServedFirmwareArtifact,
} from './artifact-download';
export {
	catalogCounterFloor,
	FIRMWARE_TYPES,
	getFirmwareReleaseById,
	getLatestRelease,
	listFirmwareReleases,
} from './catalog';
export { deleteFirmwareRelease } from './delete';
export { triggerFirmwareUpdate } from './deploy-trigger';
export { type FirmwareErrorCode, FirmwareValidationError, firmwareErrorResponse } from './errors';
export {
	type GateCheck,
	type PublicationGateResult,
	runPublicationGate,
	setFirmwareReleaseStatus,
} from './publication-gate';
export {
	classifyDeviceFirmware,
	type DeviceFirmwareStatusValue,
	enrichDevicesWithFirmwareStatus,
	getCompanyFirmwareStatus,
} from './status-service';
export { type FirmwareUploadInput, uploadFirmwareRelease } from './upload';
export { compareVersions } from './versioning';
