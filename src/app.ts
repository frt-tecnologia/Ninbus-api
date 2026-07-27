import { env } from '@common/config/env';
import { HawkbitApiError } from '@common/hawkbit/client';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { adminModule } from '@modules/admin';
import { artifactsModule } from '@modules/artifacts';
import { artifactManageRoutes } from '@modules/artifacts/manage-routes';
import { artifactCategoryRoutes } from '@modules/artifacts/category-routes';
import { authModule } from '@modules/auth';
import { categoriesModule } from '@modules/categories';
import { categoryMemberRoutes } from '@modules/categories/member-routes';
import { companiesModule } from '@modules/companies';
import { designationRoutes } from '@modules/companies/designation-routes';
import { companyMemberRoutes } from '@modules/companies/member-routes';
import { deploymentsModule } from '@modules/deployments';
import { deploymentDeviceRoutes } from '@modules/deployments/device-routes';
import { devicesModule } from '@modules/devices';
import { deviceCategoryRoutes } from '@modules/devices/category-routes';
import { deviceConnectionsRoutes } from '@modules/devices/connections-routes';
import { deviceHawkbitRoutes } from '@modules/devices/hawkbit-routes';
import { provisioningRoutes } from '@modules/devices/provision-routes';
import { DeviceSyncEngine } from '@modules/devices/sync';
import { healthModule } from '@modules/health';
import { observabilityModule } from '@modules/observability';
import { startTelemetryRetention } from '@modules/observability/retention';
import { postsModule } from '@modules/posts';
import { sseGlobalModule, sseModule } from '@modules/sse';
import { sseTestModule } from '@modules/sse/test-routes';
import { Elysia } from 'elysia';
import { appLogger } from './common/logger';
import { authRateLimit, globalRateLimit } from './common/middleware/rate-limiter';
import { requestLogger } from './common/middleware/request-logger';
import { swaggerConfig } from './common/swagger-config';

/**
 * Application composition root.
 *
 * Registers global middleware, OpenAPI/Scalar documentation,
 * error handling, and feature modules.
 *
 * @see https://elysiajs.com/concepts/plugin.html
 */
export const createApp = () => {
	const app = new Elysia()
		.use(requestLogger)
		.use(globalRateLimit)
		.use(
			cors({
				origin: env.CORS_ORIGIN,
				credentials: true,
			}),
		)
		.use(swagger(swaggerConfig))
		.onError(({ code, error, set }) => {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Handle hawkBit API errors globally
			if (error instanceof HawkbitApiError) {
				appLogger.warn(
					'[HAWKBIT] API error %d on %s: %j',
					error.status,
					error.endpoint,
					error.body,
				);

				if (error.status === 409) {
					set.status = 409;
					// Parse hawkBit error for user-friendly message
					const hbError = error.body as any;
					const hbMessage = hbError?.message ?? 'Entity already exists';
					return {
						error: 'Conflict',
						message: hbMessage,
					};
				}

				if (error.status === 404) {
					set.status = 404;
					return { error: 'Not Found', message: 'Resource not found in hawkBit' };
				}

				// Other hawkBit errors → 502 (bad gateway)
				set.status = 502;
				return {
					error: 'Upstream Error',
					message: `hawkBit returned ${error.status}`,
				};
			}

			if (code === 'NOT_FOUND') {
				set.status = 404;
				return { error: 'Route not found' };
			}

			if (code === 'VALIDATION') {
				set.status = 400;

				let parsedMessage: any = errorMessage;
				try {
					if (typeof errorMessage === 'string' && errorMessage.startsWith('{')) {
						parsedMessage = JSON.parse(errorMessage);
					}
				} catch {}

				// Detect file field validation errors — provide clear guidance
				const hasFileError =
					parsedMessage?.errors?.some(
						(e: any) => e?.schema?.format === 'binary' || e?.message?.includes('Expected kind'),
					) ?? parsedMessage?.message?.includes?.("Expected kind 'File'");

				if (hasFileError) {
					return {
						error: 'Validation error',
						message:
							'File upload requires multipart/form-data with a binary file field. Send Content-Type: multipart/form-data with the file attached.',
					};
				}

				appLogger.warn({ code, error: parsedMessage });

				return {
					error: 'Validation error',
					message: parsedMessage,
				};
			}

			// Malformed request body (e.g. invalid JSON) → 400, not 500.
			if (code === 'PARSE') {
				set.status = 400;
				appLogger.warn('[APP] Malformed request body: %s', errorMessage);
				return { error: 'Bad Request', message: 'Malformed request body' };
			}

			appLogger.error({
				code,
				error: errorMessage,
				stack: env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
			});

			set.status = 500;
			return {
				error: 'Internal server error',
				message: env.NODE_ENV === 'development' ? errorMessage : undefined,
			};
		})

		// Root endpoint - API info
		.get('/', () => ({
			name: 'Ninbus API',
			version: '2.0.0',
			docs: '/docs',
			health: '/health',
		}))

		// Feature modules
		.use(healthModule)
		.use(postsModule)
		.use(adminModule)
		.use(observabilityModule)
		.use(companiesModule)
		.use(companyMemberRoutes)
		.use(designationRoutes)
		.use(categoriesModule)
		.use(categoryMemberRoutes)
		.use(devicesModule)
		.use(deviceCategoryRoutes)
		.use(deviceConnectionsRoutes)
		.use(provisioningRoutes)
		.use(deviceHawkbitRoutes)
		.use(deploymentsModule)
		.use(deploymentDeviceRoutes)
		.use(artifactsModule)
		.use(artifactManageRoutes)
		.use(artifactCategoryRoutes)
		.use(sseModule)
		.use(sseGlobalModule)
		.use(sseTestModule);

	if (env.ENABLE_AUTH) {
		app.use(authRateLimit);
		app.use(authModule);
		appLogger.info('[AUTH] Authentication module enabled');
	} else {
		appLogger.info('[AUTH] Authentication disabled (ENABLE_AUTH=false)');
	}

	// Start hawkBit background sync worker
	DeviceSyncEngine.startBackgroundSync();

	// Start telemetry retention worker (hourly prune of old device_connections)
	startTelemetryRetention();

	return app;
};
