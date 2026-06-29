/**
 * Shared response schemas and parameter schemas.
 *
 * Single definition = consistent Swagger docs + no duplication.
 * Each module's schemas.ts imports from here and extends as needed.
 */
import { t } from 'elysia';

// ── Drizzle Timestamp Overrides ─────────────────────────────────────────

/**
 * Use in response schemas for timestamp columns.
 * Accepts both Date objects (from Drizzle) and ISO strings (from JSON).
 * Elysia's t.Date() produces: anyOf[Date, date-time string, date string, number]
 */
export const dateTimeString = t.Date();

/**
 * Nullable variant for optional timestamp columns (e.g. lastSeenAt).
 */
export const nullableDateTimeString = t.Union([t.Date(), t.Null()]);

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
