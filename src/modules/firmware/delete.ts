/**
 * Release delete — catalog × history semantics + anti-replay floor guard.
 * Contract: SKILL.md § Firmware OTA (COUNTER_FLOOR_BURNED / realignFloor).
 */
import { db } from '@common/db';
import { deployments, firmwareReleases } from '@common/db/schema';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { and, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { catalogCounterFloor } from './catalog';
import { FirmwareValidationError } from './errors';

type Release = typeof firmwareReleases.$inferSelect;

export async function deleteFirmwareRelease(releaseId: string, opts?: { realignFloor?: boolean }) {
	const release = await getReleaseOrThrow(releaseId);
	if (release.artifactType === 'firmware-ninbus' && release.counter != null) {
		await assertCounterFloorPreserved(release, opts?.realignFloor === true);
	}

	let hawkbitKept = false;
	try {
		await hawkbitSoftwareModules.delete(release.hawkbitSmId);
	} catch (error: any) {
		if (error?.status === 409 || error?.status === 423) {
			hawkbitKept = true;
		} else {
			throw error;
		}
	}

	await db.delete(firmwareReleases).where(eq(firmwareReleases.id, releaseId));
	appLogger.info(
		'[FIRMWARE] Release %s (%s v%s) deleted (hawkbitKept=%s)',
		releaseId,
		release.name,
		release.version,
		hawkbitKept,
	);
	return hawkbitKept
		? {
				message: `Release ${release.version} removed from the catalog. The binary remains on hawkBit as deployment history (it was already assigned to devices).`,
				hawkbitKept: true,
			}
		: { message: 'Firmware release deleted successfully', hawkbitKept: false };
}

async function getReleaseOrThrow(releaseId: string): Promise<Release> {
	const [release] = await db
		.select()
		.from(firmwareReleases)
		.where(eq(firmwareReleases.id, releaseId));
	if (!release) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}
	return release;
}

async function assertCounterFloorPreserved(release: Release, realign: boolean) {
	const served = await wasServed(release.version);
	if (!served) return;
	if ((await catalogCounterFloor()) !== release.counter) return;
	if (await hasOtherHolder(release)) return;

	if (realign) {
		await realignFloorToOlderRelease(release);
		return;
	}
	throw new FirmwareValidationError(
		`Release ${release.version} (counter ${release.counter}) was already SERVED to devices and is the catalog's sole holder of that counter. The bootloader anti-replay floor does not roll back — deleting it would make the next upload re-sign a burned counter (guaranteed replay rejection). Retry with ?realignFloor=true to transfer the floor to the newest older release automatically, or upload a new version (${release.version}.1).`,
		'COUNTER_FLOOR_BURNED',
	);
}

async function wasServed(version: string) {
	const [served] = await db
		.select({ id: deployments.id })
		.from(deployments)
		.where(
			and(
				eq(deployments.artifactType, 'firmware-ninbus'),
				eq(deployments.artifactVersion, version),
			),
		)
		.limit(1);
	return Boolean(served);
}

async function hasOtherHolder(release: Release) {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, 'firmware-ninbus'),
				eq(firmwareReleases.counter, release.counter!),
				ne(firmwareReleases.id, release.id),
			),
		);
	return Number(row?.n ?? 0) > 0;
}

async function realignFloorToOlderRelease(release: Release) {
	const [candidate] = await db
		.select({
			id: firmwareReleases.id,
			name: firmwareReleases.name,
			version: firmwareReleases.version,
		})
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, 'firmware-ninbus'),
				ne(firmwareReleases.id, release.id),
				or(isNull(firmwareReleases.counter), lt(firmwareReleases.counter, release.counter!)),
			),
		)
		.orderBy(desc(firmwareReleases.createdAt))
		.limit(1);
	if (!candidate) {
		throw new FirmwareValidationError(
			`Release ${release.version} (counter ${release.counter}) was already SERVED to devices and is the catalog's sole counter holder — and there is no OLDER release to realign the floor onto. Deleting it would make the next upload re-sign a burned counter (guaranteed replay rejection). Upload a new version instead (the build byte exists for this: ${release.version}.1).`,
			'COUNTER_FLOOR_BURNED',
		);
	}
	await db
		.update(firmwareReleases)
		.set({ counter: release.counter, updatedAt: new Date() })
		.where(eq(firmwareReleases.id, candidate.id));
	appLogger.warn(
		'[FIRMWARE] Counter floor realigned: release %s (%s v%s) now carries counter=%d (preserved across the delete of %s)',
		candidate.id,
		candidate.name,
		candidate.version,
		release.counter!,
		release.id,
	);
}
