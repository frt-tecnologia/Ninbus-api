/**
 * Firmware update trigger — release resolution (published-only default,
 * explicit draft = pilot channel), anti re-offer guard and deployment.
 * Contract: SKILL.md § Firmware OTA.
 */
import { hawkbitConfig } from '@common/config/hawkbit';
import { db } from '@common/db';
import { deployments, devices } from '@common/db/schema';
import type { firmwareReleases } from '@common/db/schema';
import { hawkbitSoftwareModules } from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { deploySoftwareModuleToTargets } from '@modules/deployments/deploy';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { getFirmwareReleaseById, getLatestRelease } from './catalog';
import { FirmwareValidationError } from './errors';
import { runPublicationGate } from './publication-gate';
import { compareVersions } from './versioning';

export async function triggerFirmwareUpdate(
	companyId: string,
	userId: string,
	deviceIds: string[],
	artifactType: 'firmware-ninbus' | 'firmware-controller' = 'firmware-ninbus',
	opts?: { releaseId?: string; force?: boolean },
) {
	if (!hawkbitConfig.enabled) {
		throw new FirmwareValidationError(
			'Firmware operations require hawkBit to be enabled',
			'HAWKBIT_NOT_ENABLED',
		);
	}

	const release = opts?.releaseId
		? await getFirmwareReleaseById(opts.releaseId)
		: await getLatestRelease(artifactType);
	if (!release) {
		throw new FirmwareValidationError(
			`No ${artifactType} release has been published yet. The factory must publish one first.`,
			'NOT_FOUND',
		);
	}
	if (release.artifactType !== artifactType) {
		throw new FirmwareValidationError(
			`Release ${release.version} is of type ${release.artifactType}, not ${artifactType}.`,
			'NOT_FOUND',
		);
	}

	const draftPilot = await requirePilotGateIfDraft(release);
	await assertNotRejectedArtifact(release, artifactType, opts?.force === true);

	const targets = await db
		.select({ id: devices.id, hawkbitTargetId: devices.hawkbitTargetId })
		.from(devices)
		.where(
			and(
				eq(devices.companyId, companyId),
				eq(devices.status, 'accepted'),
				isNotNull(devices.hawkbitTargetId),
				inArray(devices.id, deviceIds),
			),
		);
	if (targets.length === 0) {
		throw new FirmwareValidationError(
			'None of the given devices are eligible for update in this company.',
			'NOT_FOUND',
		);
	}

	const sm = await hawkbitSoftwareModules.get(release.hawkbitSmId);
	const draftWarning = await resolveDraftWarning(release, artifactType, opts?.releaseId);

	const result = await deploySoftwareModuleToTargets(
		companyId,
		userId,
		{ id: sm.id, name: sm.name, version: sm.version },
		release.artifactType,
		`Firmware ${release.artifactType} ${release.version}`,
		targets.map((t) => t.hawkbitTargetId as string),
		{
			artifactName: `${release.name} (release ${release.version})`,
			artifactOriginalFile: release.originalFilename,
		},
	);
	const flags: Record<string, string> = {};
	if (draftWarning) flags['draftWarning'] = draftWarning;
	if (draftPilot) flags['draftPilot'] = draftPilot;
	return Object.keys(flags).length ? { ...result, ...flags } : result;
}

type Release = typeof firmwareReleases.$inferSelect;

/** Draft + explicit releaseId = pilot channel: structural gate + warning flag. */
async function requirePilotGateIfDraft(release: Release): Promise<string | undefined> {
	if (release.status === 'published') return undefined;
	const gate = await runPublicationGate(release.id, 'pilot');
	if (!gate.passed) {
		const failed = gate.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
		throw new FirmwareValidationError(
			`Pilot gate FAILED for draft ${release.version} — ${failed.join(' | ')}`,
			'GATE_FAILED',
		);
	}
	const warning = `PILOT: draft ${release.version} deployed to assigned test devices only — NOT published; companies will not see it until the publication gate passes.`;
	appLogger.warn('[FIRMWARE] %s', warning);
	return warning;
}

/** Block re-offering the SAME artifact the devices already rejected. */
async function assertNotRejectedArtifact(release: Release, artifactType: string, force: boolean) {
	if (force) return;
	const [lastDeploy] = await db
		.select({
			artifactVersion: deployments.artifactVersion,
			createdAt: deployments.createdAt,
			snapshot: deployments.targetStatusSnapshot,
		})
		.from(deployments)
		.where(eq(deployments.artifactType, artifactType))
		.orderBy(desc(deployments.createdAt))
		.limit(1);
	if (!lastDeploy || lastDeploy.artifactVersion !== release.version) return;
	// Identity discriminator: only the artifact that WAS offered is blocked;
	// a same-version re-upload created after the failure (re-sign path) passes.
	if (release.createdAt > lastDeploy.createdAt) return;
	const snap = lastDeploy.snapshot as Record<string, { phase?: string }> | null;
	const entries = snap ? Object.values(snap) : [];
	const allError = entries.length > 0 && entries.every((e) => e.phase === 'error');
	if (!allError) return;
	throw new FirmwareValidationError(
		`The latest ${artifactType} deployment served version ${release.version} and every target ended in ERROR — the devices rejected this artifact (anti-replay floor / readback). Re-offering the same binary will be rejected again: upload + publish a NEW release (higher version + counter), or retry with force=true if the failure was transient (e.g. devices offline).`,
		'REJECTED_ARTIFACT',
	);
}

/** Warn when the resolved published release is older than an existing draft. */
async function resolveDraftWarning(
	release: Release,
	artifactType: string,
	explicitReleaseId?: string,
): Promise<string | undefined> {
	if (explicitReleaseId) return undefined;
	const latestAny = await getLatestRelease(artifactType, false);
	if (!latestAny || latestAny.id === release.id) return undefined;
	if (compareVersions(latestAny.version, release.version) <= 0) return undefined;
	const warning =
		`Deployed PUBLISHED ${release.version}, but a NEWER DRAFT ${latestAny.version} ` +
		`(${latestAny.name}) exists in the catalog. Publish it if it should ship.`;
	appLogger.warn('[FIRMWARE] %s', warning);
	return warning;
}
