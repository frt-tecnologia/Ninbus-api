import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Company & multi-tenancy tables.
 * Each company maps to an isolated device fleet.
 */

export const companyRoleEnum = pgEnum('company_role', ['owner', 'admin', 'operator', 'viewer']);

export const companyStatusEnum = pgEnum('company_status', ['active', 'suspended']);

export const companies = pgTable('companies', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: text('name').notNull(),
	status: companyStatusEnum('status').notNull().default('active'),
	menderTenantId: text('mender_tenant_id'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const companyMembers = pgTable('company_members', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	companyId: uuid('company_id')
		.notNull()
		.references(() => companies.id, { onDelete: 'cascade' }),
	role: companyRoleEnum('role').notNull().default('viewer'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type CompanyMember = typeof companyMembers.$inferSelect;
export type NewCompanyMember = typeof companyMembers.$inferInsert;
