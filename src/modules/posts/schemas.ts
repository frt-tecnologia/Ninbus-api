import { posts } from '@common/db/schema';
import { dateTimeString, ErrorResponseSchema } from '@common/schemas';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-typebox';
import { t } from 'elysia';

/**
 * API validation schemas using drizzle-typebox.
 * When you add/remove fields in Drizzle, they auto-include here.
 *
 * @see https://elysiajs.com/integrations/drizzle
 */

export const createPostSchema = createInsertSchema(posts, {
	title: t.String({ minLength: 1, maxLength: 255 }),
	content: t.String({ minLength: 1 }),
});

export const updatePostSchema = createUpdateSchema(posts, {
	title: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
	content: t.Optional(t.String({ minLength: 1 })),
});

export const CreatePostBodySchema = t.Omit(
	createPostSchema,
	['id', 'authorId', 'createdAt', 'updatedAt'],
	{
		default: {
			title: 'My First Post',
			content: 'This is the content of my very first post on the platform.',
		},
	},
);

export const UpdatePostBodySchema = t.Omit(
	updatePostSchema,
	['id', 'authorId', 'createdAt', 'updatedAt'],
	{
		default: {
			title: 'My Updated Post',
			content: 'This is the updated content.',
		},
	},
);

export const selectPostSchema = createSelectSchema(posts, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});

export const PostResponseSchema = t.Object({
	data: selectPostSchema,
});

export const PostListResponseSchema = t.Object({
	data: t.Array(selectPostSchema),
	total: t.Number(),
});

export const PostCreateResponseSchema = t.Object({
	message: t.String(),
	data: selectPostSchema,
});

export const PostUpdateResponseSchema = t.Object({
	message: t.String(),
	data: selectPostSchema,
});

export const PostDeleteResponseSchema = t.Object({
	message: t.String(),
});

export { ErrorResponseSchema };
