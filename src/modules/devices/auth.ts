/**
 * Device-specific authorization helpers.
 */
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
