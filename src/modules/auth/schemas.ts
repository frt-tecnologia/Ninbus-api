import { t } from 'elysia';

export const UserSchema = t.Object({
	id: t.String(),
	name: t.String(),
	email: t.String(),
	emailVerified: t.Boolean(),
	image: t.Nullable(t.String()),
	createdAt: t.String(),
	updatedAt: t.String(),
});

export const SessionSchema = t.Object({
	id: t.String(),
	userId: t.String(),
	token: t.String(),
	expiresAt: t.String(),
	ipAddress: t.Nullable(t.String()),
	userAgent: t.Nullable(t.String()),
});

export const AuthResponseSchema = t.Object({
	user: UserSchema,
	session: SessionSchema,
});

// Shared schemas from common — single definition
export { ErrorResponseSchema } from '@common/schemas';

export const SuccessResponseSchema = t.Object({
	success: t.Boolean(),
});

export const StatusResponseSchema = t.Object({
	status: t.Boolean(),
});

// Request Body Schemas (documentation)
export const SignUpBodySchema = t.Object({
	email: t.String({ format: 'email', default: 'user@example.com' }),
	password: t.String({ minLength: 8, default: 'SecurePass123!' }),
	name: t.String({ default: 'John Doe' }),
	image: t.Optional(t.String({ default: 'https://example.com/avatar.png' })),
});

export const SignInBodySchema = t.Object({
	email: t.String({ format: 'email', default: 'user@example.com' }),
	password: t.String({ default: 'SecurePass123!' }),
});

export const RequestPasswordResetBodySchema = t.Object({
	email: t.String({ format: 'email', default: 'user@example.com' }),
});

export const ResetPasswordBodySchema = t.Object({
	token: t.String({ default: 'reset-token-here' }),
	newPassword: t.String({ minLength: 8, default: 'NewSecurePass123!' }),
});
