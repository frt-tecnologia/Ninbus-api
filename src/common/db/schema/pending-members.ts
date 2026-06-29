import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { companies, companyRoleEnum } from './companies';

/**
 * Pending company members — email-based designation by the factory (super admin).
 *
 * When the factory (super admin) creates a company with an ownerEmail whose user
 * does NOT exist yet, a row is inserted here. When that user eventually signs up,
 * the Better Auth `user.create.after` hook resolves all pending rows for that email
 * into actual `company_members` entries — granting the designated role automatically.
 *
 * This is the "designation" model (vs. "invitation/link" model): the factory decides
 * who gets access, and the user simply registers to receive it. No tokens, no
 * accept/reject flow, no expiration.
 *
 * Design:
 * - `email` is stored LOWERCASE to make matching case-insensitive.
 * - UNIQUE(company_id, email) prevents duplicate designations per company.
 * - `claimed_at`/`claimed_by` are NULL until the user signs up and the row is resolved.
 * - Rows are retained after claiming for audit purposes (never deleted automatically).
 */
export const pendingCompanyMembers = pgTable(
	'pending_company_members',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		companyId: uuid('company_id')
			.notNull()
			.references(() => companies.id, { onDelete: 'cascade' }),
		/** Designated member email — matched case-insensitively (stored lowercase). */
		email: text('email').notNull(),
		role: companyRoleEnum('role').notNull(),
		/** Super admin (factory) who created the designation. */
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		/** When the designated user signed up and the role was granted. NULL = still pending. */
		claimedAt: timestamp('claimed_at'),
		/** The user.id of the person who claimed this designation. NULL = still pending. */
		claimedBy: text('claimed_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => ({
		/** One pending designation per (company, email) pair. */
		companyEmailIdx: uniqueIndex('idx_pending_members_company_email').on(
			table.companyId,
			table.email,
		),
	}),
);

export type PendingCompanyMember = typeof pendingCompanyMembers.$inferSelect;
export type NewPendingCompanyMember = typeof pendingCompanyMembers.$inferInsert;
