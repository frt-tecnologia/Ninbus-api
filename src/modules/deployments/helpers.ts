/**
 * Deployment helpers — target resolution and software module lookup.
 */
import { db } from '@common/db';
import { artifacts, deployments, devices } from '@common/db/schema';
import { appLogger } from '@common/logger';
import type { LocalDeploymentRecord } from '@modules/deployments/enrichment';
import { getDeviceIdsByCategories, getHawkbitTargetIdsForCompany } from '@modules/devices/service';
import { and, eq, inArray } from 'drizzle-orm';

/** Fetch the local DB audit record for a deployment (by hawkBit DS ID).
 *  Returns null if not found or on DB error (best-effort, non-fatal). */
export async function getLocalDeployment(dsId: number): Promise<LocalDeploymentRecord | null> {
	try {
		const [row] = await db
			.select()
			.from(deployments)
			.where(eq(deployments.hawkbitDsId, dsId))
			.limit(1);
		return (row as LocalDeploymentRecord) ?? null;
	} catch {
		return null;
	}
}

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

/**
 * Resolve the hawkBit Software Module for a deployment, **scoped by company**.
 *
 * Accepts either the artifact display name OR its hawkBit SM ID, but in BOTH
 * cases the lookup goes through the local `artifacts` table filtered by
 * companyId. This is the tenant-isolation boundary: a SM that exists in hawkBit
 * but is NOT registered for this company is rejected (null) — so an operator
 * cannot reference another company's artifact by guessing/enumerating the
 * sequential SM ID, and brute-forcing IDs returns 404 for every foreign one.
 *
 * hawkBit itself is single-tenant ("DEFAULT") and has no notion of companyId,
 * so ownership MUST be enforced here on the local registry (write-through
 * pattern, same as devices/artifacts modules).
 */
export async function findSoftwareModule(
	companyId: string,
	artifactNameOrSmId: string,
	version?: string,
	typeKey?: string,
): Promise<{ id: number; name: string; version: string; artifactType: string } | null> {
	const asNumber = Number(artifactNameOrSmId);
	const isNumericId =
		!Number.isNaN(asNumber) && asNumber > 0 && String(asNumber) === artifactNameOrSmId;

	const selectCols = {
		hawkbitSmId: artifacts.hawkbitSmId,
		name: artifacts.name,
		version: artifacts.version,
		artifactType: artifacts.artifactType,
	};

	if (isNumericId) {
		// SM ID is globally unique (uniqueIndex on hawkbit_sm_id). Once we confirm
		// it belongs to this company, it identifies the EXACT artifact — version/type
		// are metadata, NOT identity. We must NOT filter by version here: the caller
		// passes a default '1.0' (or a client-supplied version) that may diverge from
		// the stored version, causing a false 422 "not found". There is also no
		// relax path for numeric IDs (the name-relax below is name-only), so a
		// version mismatch here was an unrecoverable 422. Cross-tenant is still
		// blocked: a foreign SM ID simply has no row for this companyId → null.
		const [row] = await db
			.select(selectCols)
			.from(artifacts)
			.where(and(eq(artifacts.companyId, companyId), eq(artifacts.hawkbitSmId, asNumber)))
			.limit(1);
		if (!row) {
			appLogger.debug(
				{ companyId, smId: asNumber },
				'[findSoftwareModule] no local artifact record for SM ID — not registered for this company (run backfill-artifacts.ts) or cross-tenant.',
			);
			return null;
		}
		return {
			id: row.hawkbitSmId,
			name: row.name,
			version: row.version,
			artifactType: row.artifactType,
		};
	}

	// Name lookup: try fully-qualified (name + version + type) first, then relax to
	// name only. Version/type are ADVISORY here — they disambiguate when several
	// artifacts share a display name, but never cause a false 422. Both paths stay
	// scoped by companyId (tenant isolation). Never a global hawkBit lookup.
	const qualified: ReturnType<typeof eq>[] = [
		eq(artifacts.companyId, companyId),
		eq(artifacts.name, artifactNameOrSmId),
	];
	if (version) qualified.push(eq(artifacts.version, version));
	if (typeKey) qualified.push(eq(artifacts.artifactType, typeKey));

	let [row] = await db
		.select(selectCols)
		.from(artifacts)
		.where(and(...qualified))
		.limit(1);

	if (!row) {
		// Relax: match by name only (still company-scoped). Latest-updated wins
		// when several artifacts share the name.
		[row] = await db
			.select(selectCols)
			.from(artifacts)
			.where(and(eq(artifacts.companyId, companyId), eq(artifacts.name, artifactNameOrSmId)))
			.orderBy(artifacts.updatedAt)
			.limit(1);
	}

	if (!row) {
		appLogger.debug(
			{ companyId, name: artifactNameOrSmId, version, typeKey },
			'[findSoftwareModule] no local artifact record for this name — not registered for this company (run backfill-artifacts.ts), name mismatch, or cross-tenant.',
		);
		return null; // cross-tenant or genuinely missing → 422
	}

	return {
		id: row.hawkbitSmId,
		name: row.name,
		version: row.version,
		artifactType: row.artifactType,
	};
}

/**
 * Verify that a hawkBit target (controllerId) belongs to `companyId`.
 *
 * Tenant-isolation guard for routes that receive a raw `targetId` in the
 * path (e.g. action status, ddi-check). `companyRole` only validates that
 * the caller is a member of the path's company — it does NOT verify the
 * `targetId` belongs to that company. Without this check, a viewer of
 * company A could read action/diagnostic data of a target that belongs to
 * company B by guessing its controllerId.
 *
 * @returns true if the target belongs to the company, false otherwise (caller
 *          should respond 404 — never 403, to avoid leaking existence).
 */
export async function isTargetOwnedByCompany(
	companyId: string,
	targetId: string,
): Promise<boolean> {
	const [device] = await db
		.select({ id: devices.id })
		.from(devices)
		.where(and(eq(devices.hawkbitTargetId, targetId), eq(devices.companyId, companyId)))
		.limit(1);
	return !!device;
}
