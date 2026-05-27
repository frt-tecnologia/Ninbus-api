/**
 * Deployment helpers — target resolution and software module lookup.
 */
import { db } from '@common/db';
import { devices } from '@common/db/schema';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { getDeviceIdsByCategories, getHawkbitTargetIdsForCompany } from '@modules/devices/service';
import { and, eq, inArray } from 'drizzle-orm';

export async function resolveHawkbitTargetIds(
	companyId: string,
	options: {
		deviceIds?: string[];
		categoryIds?: string[];
		allDevices?: boolean;
	},
): Promise<string[]> {
	const targetIds = new Set<string>();

	if (options.deviceIds && options.deviceIds.length > 0) {
		const companyDevices = await db
			.select({ hawkbitTargetId: devices.hawkbitTargetId })
			.from(devices)
			.where(
				and(
					inArray(devices.id, options.deviceIds),
					eq(devices.companyId, companyId),
					eq(devices.status, 'accepted'),
				),
			);
		for (const d of companyDevices) {
			if (d.hawkbitTargetId) targetIds.add(d.hawkbitTargetId);
		}
	}

	if (options.categoryIds && options.categoryIds.length > 0) {
		const ninbusIds = await getDeviceIdsByCategories(companyId, options.categoryIds);
		if (ninbusIds.length > 0) {
			const companyDevices = await db
				.select({ hawkbitTargetId: devices.hawkbitTargetId })
				.from(devices)
				.where(
					and(
						inArray(devices.id, ninbusIds),
						eq(devices.companyId, companyId),
						eq(devices.status, 'accepted'),
					),
				);
			for (const d of companyDevices) {
				if (d.hawkbitTargetId) targetIds.add(d.hawkbitTargetId);
			}
		}
	}

	if (options.allDevices) {
		const allTargetIds = await getHawkbitTargetIdsForCompany(companyId);
		for (const id of allTargetIds) {
			targetIds.add(id);
		}
	}

	return [...targetIds];
}

export async function findSoftwareModule(
	artifactNameOrSmId: string,
	version: string,
	typeKey: string,
): Promise<{ id: number; name: string; version: string } | null> {
	const asNumber = Number(artifactNameOrSmId);
	if (!isNaN(asNumber) && asNumber > 0 && String(asNumber) === artifactNameOrSmId) {
		try {
			const sm = await hawkbitSoftwareModules.get(asNumber);
			return { id: sm.id, name: sm.name, version: sm.version };
		} catch {
			return null;
		}
	}
	const result = await hawkbitSoftwareModules.list({
		q: `name==${artifactNameOrSmId};version==${version};type==${typeKey}`,
	});
	if (result.content.length > 0) {
		const sm = result.content[0]!;
		return { id: sm.id, name: sm.name, version: sm.version };
	}
	const byNameType = await hawkbitSoftwareModules.list({
		q: `name==${artifactNameOrSmId};type==${typeKey}`,
	});
	if (byNameType.content.length > 0) {
		const sorted = byNameType.content.sort((a, b) => b.id - a.id);
		const sm = sorted[0]!;
		return { id: sm.id, name: sm.name, version: sm.version };
	}
	return null;
}
