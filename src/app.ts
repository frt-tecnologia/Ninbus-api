import { env } from '@common/config/env';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { artifactsModule } from '@modules/artifacts';
import { artifactManageRoutes } from '@modules/artifacts/manage-routes';
import { authModule } from '@modules/auth';
import { categoriesModule } from '@modules/categories';
import { companiesModule } from '@modules/companies';
import { companyMemberRoutes } from '@modules/companies/member-routes';
import { deploymentsModule } from '@modules/deployments';
import { deploymentDeviceRoutes } from '@modules/deployments/device-routes';
import { devicesModule } from '@modules/devices';
import { deviceHawkbitRoutes } from '@modules/devices/hawkbit-routes';
import { healthModule } from '@modules/health';
import { postsModule } from '@modules/posts';
import { Elysia } from 'elysia';
import { appLogger } from './common/logger';
import { authRateLimit, globalRateLimit } from './common/middleware/rate-limiter';
import { requestLogger } from './common/middleware/request-logger';

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
		// ---  API Documentation (open at /docs) --->
		.use(
			swagger({
				path: '/docs',
				documentation: {
					info: {
						title: 'Ninbus API',
						version: '2.0.0',
						description:
							'Ninbus IoT Platform — Device management, OTA deployments and fleet orchestration.\n\n' +
							'Powered by Elysia.js + Eclipse hawkBit.\n\n' +
							'Full Better Auth documentation: https://better-auth.com',
					},
					tags: [
						{ name: 'Health', description: 'Health check endpoints' },
						{
							name: 'Auth',
							description: 'Authentication endpoints (Better Auth)',
						},
						{
							name: 'Posts',
							description: 'Posts CRUD endpoints (reference implementation)',
						},
						{
							name: 'Companies',
							description: 'Multi-tenancy company management',
						},
						{
							name: 'Categories',
							description: 'Device grouping categories (bus lines, garages, yards, regions)',
						},
						{
							name: 'Devices',
							description: 'Ninbus device registry with Eclipse hawkBit integration',
						},
						{
							name: 'Deployments',
							description:
								'OTA deployment creation, monitoring and management via hawkBit Distribution Sets',
						},
						{
							name: 'Artifacts',
							description: 'Firmware artifact management via hawkBit Software Modules',
						},
					],
				},
				scalarConfig: {
					// @ts-ignore - fastify might not be in the local elysia scalar types yet
					theme: 'fastify',
					defaultOpenAllTags: false,
					hideModels: true,
					hideClientButton: false,
					showSidebar: true,
					showDeveloperTools: 'localhost',
					showToolbar: 'localhost',
					operationTitleSource: 'summary',
					persistAuth: false,
					telemetry: true,
					externalUrls: {
						dashboardUrl: 'https://dashboard.scalar.com',
						registryUrl: 'https://registry.scalar.com',
						proxyUrl: 'https://proxy.scalar.com',
						apiBaseUrl: 'https://api.scalar.com',
					},
					layout: 'modern',
					isEditable: false,
					isLoading: false,
					documentDownloadType: 'both',
					hideTestRequestButton: false,
					hideSearch: false,
					showOperationId: false,
					hideDarkModeToggle: false,
					withDefaultFonts: true,
					defaultOpenFirstTag: true,
					expandAllModelSections: false,
					expandAllResponses: false,
					orderSchemaPropertiesBy: 'alpha',
					orderRequiredPropertiesFirst: true,
					_integration: 'elysiajs',
					default: false,
					slug: 'ninbus-api',
					title: 'Ninbus API',
				},
			}),
		)
		.onError(({ code, error, set }) => {
			const errorMessage = error instanceof Error ? error.message : String(error);

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
					) ??
					parsedMessage?.message?.includes?.("Expected kind 'File'");

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
		.use(companiesModule)
		.use(companyMemberRoutes)
		.use(categoriesModule)
		.use(devicesModule)
		.use(deviceHawkbitRoutes)
		.use(deploymentsModule)
		.use(deploymentDeviceRoutes)
		.use(artifactsModule)
		.use(artifactManageRoutes);

	if (env.ENABLE_AUTH) {
		app.use(authRateLimit);
		app.use(authModule);
		appLogger.info('[AUTH] Authentication module enabled');
	} else {
		appLogger.info('[AUTH] Authentication disabled (ENABLE_AUTH=false)');
	}

	return app;
};
