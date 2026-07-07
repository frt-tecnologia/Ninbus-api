/**
 * Company member designation & resolution — the "factory onboarding" model.
 *
 * When the factory (super admin) creates a company with an ownerEmail whose user
 * does NOT exist yet, a row goes into `pending_company_members`. When that user
 * eventually signs up, `resolvePendingMembers()` (called from the Better Auth
 * user.create.after hook) grants the designated role automatically.
 *
 * If the user already exists at designation time, they are added directly to
 * `company_members` — no pending row is needed.
 */
import { db } from '@common/db';
import { companies, companyMembers, pendingCompanyMembers, user } from '@common/db/schema';
import { appLogger } from '@common/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';

/**
 * Resolves all pending designations for a given email into actual company_members.
 *
 * Called from:
 * 1. Better Auth `user.create.after` hook (automatic on sign-up).
 * 2. `GET /api/companies` fallback (safety net if the hook failed or the
 *    designation was created after the user signed up).
 *
 * Idempotent: skips designations already claimed, skips companies where the user
 * is already a member. Never throws — logs errors and returns gracefully so that
 * a DB hiccup doesn't block user registration.
 *
 * @returns number of newly granted memberships.
 */
export async function resolvePendingMembers(email: string, userId: string): Promise<number> {
	const normalizedEmail = email.trim().toLowerCase();
	if (!normalizedEmail) return 0;

	try {
		// Find all unclaimed designations for this email.
		const pending = await db
			.select()
			.from(pendingCompanyMembers)
			.where(
				and(
					sql`LOWER(${pendingCompanyMembers.email}) = ${normalizedEmail}`,
					isNull(pendingCompanyMembers.claimedAt),
				),
			);

		if (pending.length === 0) return 0;

		let granted = 0;
		for (const p of pending) {
			// Check if already a member (idempotency).
			const [existing] = await db
				.select({ id: companyMembers.id })
				.from(companyMembers)
				.where(and(eq(companyMembers.companyId, p.companyId), eq(companyMembers.userId, userId)));

			if (!existing) {
				await db.insert(companyMembers).values({
					companyId: p.companyId,
					userId,
					role: p.role as any,
				});
				granted++;
				appLogger.info(
					'[DESIGNATION] Granted role %s in company %s to user %s (email %s)',
					p.role,
					p.companyId,
					userId,
					normalizedEmail,
				);
			}

			// Mark as claimed regardless (even if already a member, the designation is consumed).
			await db
				.update(pendingCompanyMembers)
				.set({ claimedAt: new Date(), claimedBy: userId, updatedAt: new Date() })
				.where(eq(pendingCompanyMembers.id, p.id));
		}

		return granted;
	} catch (error: any) {
		// NEVER throw — this runs inside Better Auth's user creation flow.
		appLogger.error(
			'[DESIGNATION] Failed to resolve pending members for %s: %s',
			normalizedEmail,
			error?.message ?? 'unknown',
		);
		return 0;
	}
}

/**
 * Designates a member by email. If the user already exists, they are added to
 * company_members immediately. Otherwise, a pending row is created and resolved
 * automatically when the user signs up.
 *
 * @returns { granted: boolean, pending: boolean } — whether the role was granted
 *          immediately (user existed) or deferred (pending row created).
 */
export async function designateMember(data: {
	companyId: string;
	email: string;
	role: string;
	createdBy: string | null;
}): Promise<{ granted: boolean; pending: boolean }> {
	const normalizedEmail = data.email.trim().toLowerCase();
	if (!normalizedEmail) throw new Error('Email is required');

	// Check if the user already exists.
	const [existingUser] = await db
		.select({ id: user.id })
		.from(user)
		.where(sql`LOWER(${user.email}) = ${normalizedEmail}`);

	if (existingUser) {
		// User exists — add directly to company_members (idempotent).
		const [alreadyMember] = await db
			.select({ id: companyMembers.id })
			.from(companyMembers)
			.where(
				and(
					eq(companyMembers.companyId, data.companyId),
					eq(companyMembers.userId, existingUser.id),
				),
			);

		if (!alreadyMember) {
			await db.insert(companyMembers).values({
				companyId: data.companyId,
				userId: existingUser.id,
				role: data.role as any,
			});
			appLogger.info(
				'[DESIGNATION] Granted role %s in company %s to existing user %s',
				data.role,
				data.companyId,
				existingUser.id,
			);
		} else {
			// Already a member — update role.
			await db
				.update(companyMembers)
				.set({ role: data.role as any })
				.where(eq(companyMembers.id, alreadyMember.id));
		}

		// If there was a pending row for this email, mark it claimed.
		await markPendingClaimed(data.companyId, normalizedEmail, existingUser.id);

		return { granted: true, pending: false };
	}

	// User doesn't exist — create a pending designation.
	// UPSERT: if a pending row already exists for (company, email), update the role.
	await db
		.insert(pendingCompanyMembers)
		.values({
			companyId: data.companyId,
			email: normalizedEmail,
			role: data.role as any,
			createdBy: data.createdBy,
		})
		.onConflictDoUpdate({
			target: [pendingCompanyMembers.companyId, pendingCompanyMembers.email],
			set: { role: data.role as any, updatedAt: new Date() },
		});

	appLogger.info(
		'[DESIGNATION] Created pending designation: email=%s role=%s company=%s',
		normalizedEmail,
		data.role,
		data.companyId,
	);

	return { granted: false, pending: true };
}

/**
 * Marks a pending designation as claimed (used when the user already exists
 * and was granted the role directly).
 */
async function markPendingClaimed(companyId: string, normalizedEmail: string, userId: string) {
	await db
		.update(pendingCompanyMembers)
		.set({ claimedAt: new Date(), claimedBy: userId, updatedAt: new Date() })
		.where(
			and(
				eq(pendingCompanyMembers.companyId, companyId),
				sql`LOWER(${pendingCompanyMembers.email}) = ${normalizedEmail}`,
			),
		);
}

/**
 * Lists all pending (unclaimed) designations for a company.
 */
export async function getPendingDesignations(companyId: string) {
	return await db
		.select()
		.from(pendingCompanyMembers)
		.where(
			and(eq(pendingCompanyMembers.companyId, companyId), isNull(pendingCompanyMembers.claimedAt)),
		)
		.orderBy(pendingCompanyMembers.createdAt);
}

/**
 * Removes a pending designation (revokes an unclaimed designation).
 * Only works on unclaimed rows — claimed rows are retained for audit.
 */
export async function revokePendingDesignation(
	companyId: string,
	designationId: string,
): Promise<{ id: string; email: string; role: string } | null> {
	const result = await db
		.delete(pendingCompanyMembers)
		.where(
			and(
				eq(pendingCompanyMembers.id, designationId),
				eq(pendingCompanyMembers.companyId, companyId),
				isNull(pendingCompanyMembers.claimedAt),
			),
		)
		.returning({
			id: pendingCompanyMembers.id,
			email: pendingCompanyMembers.email,
			role: pendingCompanyMembers.role,
		});
	// `result[0]` is typed as `T | undefined` (array access) — coalesce to null.
	return result.length > 0 ? (result[0] ?? null) : null;
}

/**
 * Lists ALL pending designations across ALL companies — for the factory admin view.
 */
export async function getAllPendingDesignations() {
	return await db
		.select({
			id: pendingCompanyMembers.id,
			companyId: pendingCompanyMembers.companyId,
			companyName: companies.name,
			email: pendingCompanyMembers.email,
			role: pendingCompanyMembers.role,
			claimedAt: pendingCompanyMembers.claimedAt,
			createdAt: pendingCompanyMembers.createdAt,
		})
		.from(pendingCompanyMembers)
		.innerJoin(companies, eq(pendingCompanyMembers.companyId, companies.id))
		.orderBy(pendingCompanyMembers.createdAt);
}
