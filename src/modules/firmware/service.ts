/**
 * Firmware module barrel — re-exports the split submodules so external import
 * sites (routes, tests, app) stay stable. Structure: SKILL.md § Firmware OTA.
 */
export { FirmwareValidationError, type FirmwareErrorCode, firmwareErrorResponse } from './errors';
export {
	catalogCounterFloor,
	getFirmwareReleaseById,
	getLatestRelease,
	listFirmwareReleases,
} from './catalog';
export { type FirmwareUploadInput, uploadFirmwareRelease } from './upload';
export { deleteFirmwareRelease } from './delete';
export {
	type GateCheck,
	type PublicationGateResult,
	runPublicationGate,
	setFirmwareReleaseStatus,
} from './publication-gate';
export { triggerFirmwareUpdate } from './deploy-trigger';
export { type ServedFirmwareArtifact, downloadServedArtifact, extractImageFromTar } from './artifact-download';
export {
	classifyDeviceFirmware,
	enrichDevicesWithFirmwareStatus,
	getCompanyFirmwareStatus,
	type DeviceFirmwareStatusValue,
} from './status-service';
export { compareVersions } from './versioning';
export { FIRMWARE_TYPES } from './catalog';
