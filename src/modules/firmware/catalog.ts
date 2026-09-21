/**
 * Firmware catalog reads + the anti-replay counter floor query.
 */
import { db } from '@common/db';
import { firmwareReleases } from '@common/db/schema';
import { NINBUS_ARTIFACT_TYPES } from '@common/hawkbit/client';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { FirmwareValidationError } from './errors';
import { compareVersions } from './versioning';

/** Firmware types accepted in the factory catalog (configuration-nfx is
 *  company-scoped operational data, not a firmware release). */
export const FIRMWARE_TYPES = [
	NINBUS_ARTIFACT_TYPES.NINBUS_FIRMWARE,
	NINBUS_ARTIFACT_TYPES.CONTROLLER_FIRMWARE,
] as const;

export async function listFirmwareReleases(params?: { type?: string }) {
	const rows = await db
		.select()
		.from(firmwareReleases)
		.where(params?.type ? eq(firmwareReleases.artifactType, params.type) : undefined)
		.orderBy(desc(firmwareReleases.createdAt));
	return { data: rows, total: rows.length };
}

/** Latest release of a type — highest semver, tie-broken by recency. */
export async function getLatestRelease(type: string, publishedOnly = true) {
	const rows = await db
		.select()
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, type),
				publishedOnly ? eq(firmwareReleases.status, 'published') : undefined,
			),
		)
		.orderBy(desc(firmwareReleases.createdAt));
	if (rows.length === 0) return null;
	return rows.reduce((latest, r) => (compareVersions(r.version, latest.version) > 0 ? r : latest));
}

export async function getFirmwareReleaseById(releaseId: string) {
	const [release] = await db
		.select()
		.from(firmwareReleases)
		.where(eq(firmwareReleases.id, releaseId));
	if (!release) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}
	return release;
}

/**
 * Max manifest counter in the catalog (0 when none) — the monotonic floor.
 * `publishedOnly` compares against published releases only (publication gate);
 * default counts drafts too (upload signing + delete guard).
 */
export async function catalogCounterFloor(
	artifactType = 'firmware-ninbus',
	opts?: { excludeId?: string; publishedOnly?: boolean },
): Promise<number> {
	const [row] = await db
		.select({ maxCounter: sql<number>`coalesce(max(${firmwareReleases.counter}), 0)` })
		.from(firmwareReleases)
		.where(
			and(
				eq(firmwareReleases.artifactType, artifactType),
				opts?.publishedOnly ? eq(firmwareReleases.status, 'published') : undefined,
				opts?.excludeId ? ne(firmwareReleases.id, opts.excludeId) : undefined,
			),
		);
	return Number(row?.maxCounter ?? 0);
}
