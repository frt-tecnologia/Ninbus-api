/**
 * Shared response schemas and parameter schemas.
 *
 * Single definition = consistent Swagger docs + no duplication.
 * Each module's schemas.ts imports from here and extends as needed.
 */
import { t } from 'elysia';

// ── Drizzle Timestamp Overrides ─────────────────────────────────────────

/**
 * `drizzle-typebox` generates `t.Date()` for `timestamp` columns,
 * which produces `"type": "Date"` — NOT a valid OpenAPI 3.0.3 type.
 * Use this override in `createSelectSchema(table, overrides)` to produce
 * `"type": "string", "format": "date-time"` instead.
 */
export const dateTimeString = t.String({ format: 'date-time' });

/**
 * Nullable variant for optional timestamp columns (e.g. lastSeenAt).
 */
export const nullableDateTimeString = t.Union([t.String({ format: 'date-time' }), t.Null()]);

// ── Generic Responses ──────────────────────────────────────────────────

/** Standard error response — used on 4xx/5xx */
export const ErrorResponseSchema = t.Object({
	error: t.String({ description: 'Error type (e.g. "Not Found", "Forbidden")' }),
	message: t.String({ description: 'Human-readable error detail' }),
});

/** Standard success response with message only */
export const GenericActionResponseSchema = t.Object({
	message: t.String({ description: 'Success message' }),
});
