import { categories } from '@common/db/schema';
import { dateTimeString, ErrorResponseSchema } from '@common/schemas';
import { createSelectSchema } from 'drizzle-typebox';
import { t } from 'elysia';

export const createCategorySchema = t.Object(
	{
		name: t.String({ minLength: 1, maxLength: 255, description: 'Category name' }),
		type: t.Union(
			[
				t.Literal('bus_line'),
				t.Literal('garage'),
				t.Literal('yard'),
				t.Literal('region'),
				t.Literal('custom'),
			],
			{ description: 'Category type' },
		),
		description: t.Optional(t.String({ maxLength: 1000, description: 'Category description' })),
	},
	{
		default: {
			name: 'Linha Azul 101',
			type: 'bus_line',
			description: 'Veículos designados para a rota azul',
		},
	},
);

export const updateCategorySchema = t.Object(
	{
		name: t.Optional(t.String({ minLength: 1, maxLength: 255, description: 'Updated name' })),
		description: t.Optional(t.String({ maxLength: 1000, description: 'Updated description' })),
	},
	{
		default: {
			name: 'Linha Azul 101 (Atualizada)',
			description: 'Nova descrição da linha',
		},
	},
);

export const selectCategorySchema = createSelectSchema(categories, {
	createdAt: dateTimeString,
	updatedAt: dateTimeString,
});

export const CategoryResponseSchema = t.Object({
	data: selectCategorySchema,
});

export const CategoryListResponseSchema = t.Object({
	data: t.Array(selectCategorySchema),
});

export const CategoryCreateResponseSchema = t.Object({
	message: t.String(),
	data: selectCategorySchema,
});

export const CategoryUpdateResponseSchema = t.Object({
	message: t.String(),
	data: selectCategorySchema,
});

export const CategoryDeleteResponseSchema = t.Object({
	message: t.String(),
});

export { ErrorResponseSchema };
