/**
 * Artifact ↔ Category grouping service.
 *
 * Groups are LOCAL ONLY (hawkBit has no Software Module grouping), so these
 * operations never call hawkBit and never require requireHawkbit() — they work
 * even when hawkBit is down. Mirrors devices/service.ts category functions.
 *
 * Tenant isolation: assignment filters categoryIds by companyId (cross-tenant
 * ids are silently dropped, exactly like device assignment).
 */
import { db } from '@common/db';
import { artifactCategoryAssignments, artifacts, categories } from '@common/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { ArtifactNotFoundError } from './types';

/** Resolve a hawkBit SM id (the route param) to the local artifact row, verifying company ownership. */
async function resolveArtifactForCompany(companyId: string, hawkbitSmId: number) {
	const [artifact] = await db
		.select({ id: artifacts.id, companyId: artifacts.companyId })
		.from(artifacts)
		.where(eq(artifacts.hawkbitSmId, hawkbitSmId));
	if (!artifact || artifact.companyId !== companyId) {
		throw new ArtifactNotFoundError(`Artifact #${hawkbitSmId} not found in this company`);
	}
	return artifact;
}

/** List the categories assigned to an artifact (verifies ownership first). */
export async function getArtifactCategories(companyId: string, hawkbitSmId: number) {
	const artifact = await resolveArtifactForCompany(companyId, hawkbitSmId);
	return await db
		.select({
			id: categories.id,
			companyId: categories.companyId,
			name: categories.name,
			type: categories.type,
			description: categories.description,
			createdAt: categories.createdAt,
			updatedAt: categories.updatedAt,
			assignedAt: artifactCategoryAssignments.assignedAt,
		})
		.from(artifactCategoryAssignments)
		.innerJoin(categories, eq(artifactCategoryAssignments.categoryId, categories.id))
		.where(eq(artifactCategoryAssignments.artifactId, artifact.id));
}

/**
 * Replace the full set of categories for an artifact (idempotent).
 * Cross-tenant categoryIds are silently dropped. Returns counts for transparency.
 */
export async function assignArtifactCategories(
	companyId: string,
	hawkbitSmId: number,
	categoryIds: string[],
): Promise<{ assigned: number; dropped: number }> {
	const artifact = await resolveArtifactForCompany(companyId, hawkbitSmId);

	// Keep only categories that belong to THIS company (cross-tenant safe).
	const requested = [...new Set(categoryIds)]; // dedupe
	const valid =
		requested.length === 0
			? []
			: await db
					.select({ id: categories.id })
					.from(categories)
					.where(and(eq(categories.companyId, companyId), inArray(categories.id, requested)));
	const validIds = valid.map((v) => v.id);

	await db.transaction(async (tx) => {
		await tx
			.delete(artifactCategoryAssignments)
			.where(eq(artifactCategoryAssignments.artifactId, artifact.id));
		if (validIds.length > 0) {
			await tx
				.insert(artifactCategoryAssignments)
				.values(validIds.map((categoryId) => ({ artifactId: artifact.id, categoryId })))
				.onConflictDoNothing(); // composite PK guard
		}
	});

	return { assigned: validIds.length, dropped: requested.length - validIds.length };
}

/** Remove a single category from an artifact (verifies ownership first). */
export async function removeArtifactCategory(
	companyId: string,
	hawkbitSmId: number,
	categoryId: string,
): Promise<void> {
	const artifact = await resolveArtifactForCompany(companyId, hawkbitSmId);
	await db
		.delete(artifactCategoryAssignments)
		.where(
			and(
				eq(artifactCategoryAssignments.artifactId, artifact.id),
				eq(artifactCategoryAssignments.categoryId, categoryId),
			),
		);
}
