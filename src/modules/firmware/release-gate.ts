import { db } from '@common/db';
import { firmwareReleases } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import { FirmwareValidationError } from './service';

// ---------------------------------------------------------------------------
// Publish gate (draft <-> published)
// ---------------------------------------------------------------------------

/** Fetch one release by id (any status) — throws NOT_FOUND if absent. */
export async function getFirmwareReleaseById(releaseId: string) {
	const [release] = await db.select().from(firmwareReleases).where(eq(firmwareReleases.id, releaseId));
	if (!release) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}
	return release;
}

// ---------------------------------------------------------------------------
// Publish gate (draft ⇄ published)
// ---------------------------------------------------------------------------

/**
 * Publish / unpublish a release — the factory test gate.
 *
 * Publishing makes the release visible to end users (mobile status + opt-in
 * trigger resolve it as latest). Unpublishing is the emergency brake: the
 * release disappears from user-facing endpoints even though deployments
 * already assigned to devices keep running (hawkBit-side).
 */
export async function setFirmwareReleaseStatus(
	releaseId: string,
	status: 'draft' | 'published',
) {
	const release = await getFirmwareReleaseById(releaseId);
	if (release.status === status) {
		throw new FirmwareValidationError(
			`Release ${release.version} is already ${status}.`,
			'INVALID_STATUS',
		);
	}
	const [updated] = await db
		.update(firmwareReleases)
		.set({ status, updatedAt: new Date() })
		.where(eq(firmwareReleases.id, releaseId))
		.returning();
	if (!updated) {
		throw new FirmwareValidationError('Firmware release not found', 'NOT_FOUND');
	}
	appLogger.info('[FIRMWARE] Release %s (%s v%s) → %s', releaseId, release.name, release.version, status);
	return updated;
}
