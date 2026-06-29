/**
 * Sync Engine — hawkBit fetch utilities (paginated target queries).
 * Shared between all sync strategies.
 */
import { hawkbitTargets } from '@common/hawkbit/client';

// ---------------------------------------------------------------------------
// hawkBit fetch utilities
// ---------------------------------------------------------------------------

/** Fetch ALL hawkBit targets (paginated). */
export async function fetchAllHawkBitTargets(): Promise<Map<string, any>> {
	const targetMap = new Map<string, any>();
	const pageSize = 500;
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const response = await hawkbitTargets.list({ offset, limit: pageSize });
		for (const target of response.content) {
			targetMap.set(target.controllerId, target);
		}
		offset += pageSize;
		hasMore = response.content.length === pageSize && offset < (response.total ?? 0);
	}

	return targetMap;
}

/** Fetch hawkBit targets modified since a timestamp (incremental sync). */
export async function fetchModifiedTargets(sinceTimestamp: number): Promise<Map<string, any>> {
	const targetMap = new Map<string, any>();
	const pageSize = 500;
	let offset = 0;
	let hasMore = true;
	const q = `lastModifiedAt>${sinceTimestamp}`;

	while (hasMore) {
		const response = await hawkbitTargets.list({ offset, limit: pageSize, q });
		for (const target of response.content) {
			targetMap.set(target.controllerId, target);
		}
		offset += pageSize;
		hasMore = response.content.length === pageSize && offset < (response.total ?? 0);
	}

	return targetMap;
}

/** Fetch hawkBit targets by controllerId list (company-scoped). */
export async function fetchTargetsByIds(controllerIds: string[]): Promise<Map<string, any>> {
	if (controllerIds.length === 0) return new Map();

	const targetMap = new Map<string, any>();
	const batchSize = 100; // hawkBit RSQL URL length limits

	for (let i = 0; i < controllerIds.length; i += batchSize) {
		const batch = controllerIds.slice(i, i + batchSize);
		const q = `controllerId=in=(${batch.join(',')})`;
		const response = await hawkbitTargets.list({ limit: batchSize, q });
		for (const target of response.content) {
			targetMap.set(target.controllerId, target);
		}
	}

	return targetMap;
}
