/**
 * hawkBit Management API Client — Barrel export + utility functions.
 *
 * Re-exports all API sub-clients and Ninbus constants/types.
 * Provides utility functions for common hawkBit operations.
 */
import type { NinbusArtifactType } from './constants';
import { hawkbitDistributionSetTypes } from './distribution-sets';
import { hawkbitSoftwareModuleTypes } from './software-modules';

// Re-export all sub-modules
export { HawkbitApiError } from './http';
export { hawkbitTargets } from './targets';
export { hawkbitDistributionSets, hawkbitDistributionSetTypes } from './distribution-sets';
export { hawkbitSoftwareModules, hawkbitSoftwareModuleTypes } from './software-modules';

// Re-export constants and types
export {
	NINBUS_ARTIFACT_TYPES,
	NINBUS_ARTIFACT_TYPE_META,
	NINBUS_DEVICE_TYPE,
	isNinbusArtifactType,
	resolveArtifactType,
} from './constants';
export type { NinbusArtifactType } from './constants';

// Re-export all types
export type {
	HawkbitAction,
	HawkbitActionStatus,
	HawkbitArtifact,
	HawkbitDistributionSet,
	HawkbitDistributionSetType,
	HawkbitDSStatistics,
	HawkbitPagedResponse,
	HawkbitSoftwareModule,
	HawkbitSoftwareModuleType,
	HawkbitTarget,
	HawkbitTargetAttributes,
	HawkbitTargetRequestBody,
} from './types';

// ---------------------------------------------------------------------------
// Utility: Resolve Ninbus software module type ID
// ---------------------------------------------------------------------------

let cachedModuleTypes: Map<string, number> | null = null;
let cachedDsTypes: Map<string, number> | null = null;

/**
 * Get or create the Software Module Type ID for a Ninbus artifact type.
 * Caches results for the process lifetime.
 */
export async function getOrCreateSoftwareModuleType(artifactType: NinbusArtifactType): Promise<{
	typeId: number;
	typeKey: string;
	typeName: string;
}> {
	if (!cachedModuleTypes) {
		cachedModuleTypes = new Map();
		const types = await hawkbitSoftwareModuleTypes.list();
		for (const t of types.content) {
			cachedModuleTypes.set(t.key, t.id);
		}
	}

	const existing = cachedModuleTypes.get(artifactType);
	if (existing) {
		const t = await hawkbitSoftwareModuleTypes.get(existing);
		return { typeId: t.id, typeKey: t.key, typeName: t.name };
	}

	// Create the type if it doesn't exist
	const { NINBUS_ARTIFACT_TYPE_META } = await import('./constants');
	const meta = NINBUS_ARTIFACT_TYPE_META[artifactType];
	const created = await hawkbitSoftwareModuleTypes.create({
		key: artifactType,
		name: meta.label,
		description: meta.description,
		minArtifacts: 1,
		maxAssignments: 1,
	});
	cachedModuleTypes.set(artifactType, created.id);
	return { typeId: created.id, typeKey: created.key, typeName: created.name };
}

// ---------------------------------------------------------------------------
// Utility: Resolve Ninbus distribution set type
// ---------------------------------------------------------------------------

/**
 * Get or create a Distribution Set Type that supports Ninbus artifact types.
 * Each Ninbus artifact type gets its own DS type (1 SM type per DS type).
 * This is needed because hawkBit DS types define which SM types are compatible.
 */
export async function getOrCreateDistributionSetType(artifactType: NinbusArtifactType): Promise<{
	typeId: number;
	typeKey: string;
}> {
	const dsTypeKey = `ninbus-${artifactType}`;

	if (!cachedDsTypes) {
		cachedDsTypes = new Map();
		const types = await hawkbitDistributionSetTypes.list();
		for (const t of types.content) {
			cachedDsTypes.set(t.key, t.id);
		}
	}

	const existing = cachedDsTypes.get(dsTypeKey);
	if (existing) {
		return { typeId: existing, typeKey: dsTypeKey };
	}

	// Ensure SM type exists first
	const smType = await getOrCreateSoftwareModuleType(artifactType);

	const { NINBUS_ARTIFACT_TYPE_META } = await import('./constants');
	const meta = NINBUS_ARTIFACT_TYPE_META[artifactType];

	const created = await hawkbitDistributionSetTypes.create({
		key: dsTypeKey,
		name: `Ninbus ${meta.label}`,
		description: `Distribution set for ${meta.description}`,
	});

	// hawkBit DS type POST ignores modules field — must assign SM type separately
	await hawkbitDistributionSetTypes.assignMandatorySMType(created.id, smType.typeId);

	cachedDsTypes.set(dsTypeKey, created.id);
	return { typeId: created.id, typeKey: dsTypeKey };
}
