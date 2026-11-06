import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const platformSettings = pgTable('platform_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformSetting = typeof platformSettings.$inferSelect;
