import { jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Company & multi-tenancy tables.
 * Roles: owner > manager > operator > observer (RBAC v2 — docs/rbac-roles-and-permissions.md).
 */

export const companyRoleEnum = pgEnum('company_role', ['owner', 'manager', 'operator', 'observer']);

export const companyStatusEnum = pgEnum('company_status', ['active', 'suspended']);

export const companies = pgTable('companies', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	status: companyStatusEnum('status').notNull().default('active'),
	hawkbitTenantId: text('hawkbit_tenant_id'),
	/** Audit: who created this company (super admin). Nullable for pre-existing rows. */
	createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const companyMembers = pgTable('company_members', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	role: companyRoleEnum('role').notNull().default('observer'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-company role permission overrides, edited by platform super admins. */
export const companyRolePolicies = pgTable(
	'company_role_policies',
	{
		companyId: uuid('company_id')
			.notNull()
			.references(() => companies.id, { onDelete: 'cascade' }),
		role: companyRoleEnum('role').notNull(),
		overrides: jsonb('overrides').$type<Record<string, boolean>>().notNull().default({}),
		updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.companyId, table.role] })],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyMember = typeof companyMembers.$inferSelect;
export type NewCompanyMember = typeof companyMembers.$inferInsert;
export type CompanyRolePolicy = typeof companyRolePolicies.$inferSelect;
export type NewCompanyRolePolicy = typeof companyRolePolicies.$inferInsert;
