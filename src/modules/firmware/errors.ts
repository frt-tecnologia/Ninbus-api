/**
 * Firmware module error type + canonical code→HTTP mapping.
 * Single source for every route catch block (see SKILL.md § Firmware OTA).
 */
export type FirmwareErrorCode =
	| 'INVALID_EXTENSION'
	| 'FILE_TOO_LARGE'
	| 'EMPTY_FILE'
	| 'MISSING_FILE'
	| 'HAWKBIT_NOT_ENABLED'
	| 'NOT_FOUND'
	| 'DUPLICATE_VERSION'
	| 'LOCKED'
	| 'INVALID_STATUS'
	| 'INVALID_PACKAGE'
	| 'SIGNING_KEY_NOT_CONFIGURED'
	| 'INVALID_KEY'
	| 'INVALID_IMAGE'
	| 'INVALID_COUNTER'
	| 'INVALID_SIGNATURE'
	| 'INVALID_VERSION'
	| 'COUNTER_FLOOR_BURNED'
	| 'GATE_FAILED'
	| 'REJECTED_ARTIFACT';

export class FirmwareValidationError extends Error {
	constructor(
		message: string,
		public readonly code: FirmwareErrorCode,
	) {
		super(message);
		this.name = 'FirmwareValidationError';
	}
}

/** Codes that conflict with persisted/device state (not a malformed request). */
const CONFLICT_CODES: ReadonlySet<FirmwareErrorCode> = new Set<FirmwareErrorCode>([
	'DUPLICATE_VERSION',
	'INVALID_STATUS',
	'COUNTER_FLOOR_BURNED',
	'GATE_FAILED',
	'REJECTED_ARTIFACT',
]);

export function firmwareErrorResponse(error: FirmwareValidationError): {
	status: number;
	body: { error: string; message: string; code: FirmwareErrorCode };
} {
	const status = error.code === 'NOT_FOUND' ? 404 : CONFLICT_CODES.has(error.code) ? 409 : 400;
	return {
		status,
		body: {
			error: status === 404 ? 'Not Found' : status === 409 ? 'Conflict' : 'Validation error',
			message: error.message,
			code: error.code,
		},
	};
}
