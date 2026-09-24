/**
 * Device-specific authorization helpers.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { checkMembership } from '@common/middleware/company-check';

export { checkMembership };

export async function loadDevice(
	deviceId: string,
	companyId: string,
): Promise<{ device: any } | { status: number; body: any }> {
	const { getDeviceById } = await import('./service');
	const device = await getDeviceById(deviceId, companyId);
	if (!device) return { status: 404, body: { error: 'Not Found', message: 'Device not found' } };
	return { device };
}

export function requireHawkbitLink(device: { hawkbitTargetId: string | null }): {
	status: number;
	body: any;
} | null {
	if (!device.hawkbitTargetId) {
		return {
			status: 400,
			body: { error: 'Bad Request', message: 'Device is not linked to hawkBit' },
		};
	}
	return null;
}

/**
 * Level-1 hawkBit guard (two-level protection): when HAWKBIT_ENABLED=false the
 * route must answer a clear 400 instead of letting the HTTP client attempt a
 * connection (which onError maps to 502/503 and cascades as a 5xx).
 */
export function requireHawkbitEnabled(): { status: number; body: any } | null {
	if (!hawkbitConfig.enabled) {
		return {
			status: 400,
			body: {
				error: 'Bad Request',
				message: 'hawkBit integration is disabled (HAWKBIT_ENABLED=false)',
			},
		};
	}
	return null;
}
