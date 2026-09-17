/**
 * Shared deployment execution — creates a Distribution Set from a Software
 * Module, assigns it to targets, verifies DDI readiness, and writes the local
 * audit record.
 *
 * Extracted from service.ts so both flows share the exact same semantics:
 *  1. Company deployment (createDeployment) — SM from the company catalog.
 *  2. Factory firmware update (POST /devices/firmware/update) — SM from the
 *     global firmware_releases catalog.
 */
import { randomUUID } from 'node:crypto';
import { db } from '@common/db';
import { artifacts, deployments } from '@common/db/schema';
import {
	getOrCreateDistributionSetType,
	hawkbitDistributionSets,
	hawkbitSoftwareModules,
	hawkbitTargets,
} from '@common/hawkbit/client';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';
import { forceCloseActiveActions, forceCloseCancelActions } from './actions';

export interface DeployAuditOverrides {
	/** Display name recorded in the audit trail (defaults: resolve from `artifacts`). */
	artifactName?: string;
	/** Original filename recorded in the audit trail. */
	artifactOriginalFile?: string | null;
}

/** A Software Module reference — only id/name/version are needed to deploy. */
export type DeployableSoftwareModule = {
	id: number;
	name: string;
	version: string;
};

/** Verify the SM carries at least one artifact binary — DDI skips empty DSes. */
export async function verifySoftwareModuleHasArtifacts(
	sm: DeployableSoftwareModule,
): Promise<boolean> {
	try {
		const smFiles = await hawkbitSoftwareModules.listArtifacts(sm.id);
		return smFiles.length > 0;
	} catch {
		return false;
	}
}

/**
 * Deploy a Software Module to a set of hawkBit targets and register the
 * deployment locally (write-through). Shared by all deployment entrypoints.
 */
export async function deploySoftwareModuleToTargets(
	companyId: string,
	userId: string,
	sm: DeployableSoftwareModule,
	artifactType: string,
	deploymentName: string,
	targetIds: string[],
	audit?: DeployAuditOverrides,
) {
	if (targetIds.length === 0) {
		throw new Error('No eligible devices found for deployment');
	}

	// Verify SM has at least one artifact (binary file)
	const smHasArtifacts = await verifySoftwareModuleHasArtifacts(sm);
	if (!smHasArtifacts) {
		throw new Error(
			`Software Module "${sm.name}" (#${sm.id}) has no artifacts (binary files). Upload the artifact file first. DDI will not offer deploymentBase for an incomplete DS.`,
		);
	}
	const dsType = await getOrCreateDistributionSetType(artifactType as any);
	const dsUuid = randomUUID();
	const ds = await hawkbitDistributionSets.create({
		name: `ds-${dsUuid}`,
		version: `v-${Date.now()}`,
		description: `${deploymentName} | artifact: ${sm.name} (${artifactType}) | uuid: ${dsUuid}`,
		type: dsType.typeKey,
		modules: [{ id: sm.id }],
	});

	appLogger.info(
		`[DEPLOY] Created DS #${ds.id} (type=${dsType.typeKey}) with SM #${sm.id} (${sm.name}). Assigning to ${targetIds.length} targets...`,
	);

	// Step 1: Force-close ALL pre-existing active actions.
	await forceCloseActiveActions(targetIds);

	// Step 2: Assign targets to the new DS.
	await hawkbitDistributionSets.assignTargets(ds.id, targetIds);

	// Step 3: Force-close auto-created cancel actions.
	await forceCloseCancelActions(targetIds);

	// Step 4: Verify deployment is properly offered via DDI.
	const { checkDDiReadiness } = await import('./ddi-diagnostics');
	let verifiedCount = 0;
	const failedTargets: string[] = [];

	for (const targetId of targetIds) {
		try {
			const targetActions = await hawkbitTargets.getActions(targetId, { limit: 10 });
			const activeUpdate = targetActions.content.find(
				(a: { active: boolean; type: string }) => a.active && a.type === 'update',
			);
			if (activeUpdate) {
				verifiedCount++;
			} else {
				failedTargets.push(targetId);
			}
		} catch {
			failedTargets.push(targetId);
		}
	}

	if (failedTargets.length > 0) {
		appLogger.warn(
			'[DEPLOY] %d/%d targets FAILED verification.',
			failedTargets.length,
			targetIds.length,
		);
		for (const targetId of failedTargets.slice(0, 3)) {
			try {
				const diag = await checkDDiReadiness(targetId);
				appLogger.error({ targetId, ...diag }, '[DEPLOY] DDI Diagnostic');
			} catch {
				/* diagnostic failed */
			}
		}
	}

	// Write-through: register in local DB with audit data.
	// Resolve artifact metadata for the audit trail (unless the caller
	// provided overrides — e.g. firmware releases live outside `artifacts`).
	let artifactDisplayName = audit?.artifactName ?? deploymentName;
	let artifactOrigFile = audit?.artifactOriginalFile ?? null;
	if (!audit?.artifactName) {
		try {
			const [localArtifact] = await db
				.select({ name: artifacts.name, originalFilename: artifacts.originalFilename })
				.from(artifacts)
				.where(eq(artifacts.hawkbitSmId, sm.id));
			if (localArtifact) {
				artifactDisplayName = localArtifact.name;
				artifactOrigFile = localArtifact.originalFilename ?? null;
			}
		} catch {
			/* non-critical */
		}
	}

	await db.insert(deployments).values({
		companyId,
		hawkbitDsId: ds.id,
		name: deploymentName,
		artifactType,
		artifactName: artifactDisplayName,
		artifactVersion: sm.version,
		artifactOriginalFile: artifactOrigFile,
		targetCount: targetIds.length,
		targetIds: JSON.stringify(targetIds),
		createdBy: userId,
	});

	appLogger.info('[DEPLOY] Registered DS %d for company %s', ds.id, companyId);

	appLogger.info(
		`[DEPLOY] "${deploymentName}" (DS #${ds.id}): ${verifiedCount}/${targetIds.length} verified.`,
	);

	return {
		dsId: ds.id,
		name: deploymentName,
		version: ds.version,
		targetsAssigned: targetIds.length,
		artifactType,
		smId: sm.id,
		smName: sm.name,
		verified: verifiedCount,
		failed: failedTargets.length,
	};
}
