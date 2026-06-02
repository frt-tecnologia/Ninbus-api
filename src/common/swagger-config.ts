/**
 * Swagger / Scalar documentation configuration.
 * Extracted from app.ts to keep composition root under 250 lines.
 */
export const swaggerConfig = {
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
		components: {
			securitySchemes: {
				cookieAuth: {
					type: 'apiKey' as const,
					in: 'cookie' as const,
					name: 'auth.session_token',
					description:
						'Session cookie obtained via POST /api/auth/sign-in/email. ' +
						'Sign in first, then the browser will send the cookie automatically.',
				},
				bearerAuth: {
					type: 'http' as const,
					scheme: 'bearer' as const,
					description:
						'Bearer token from sign-in response (token field). ' +
						'Send as: Authorization: Bearer <token>. ' +
						'Use this for mobile apps and API clients that cannot manage cookies.',
				},
			},
		},
		tags: [
			{ name: 'Health', description: 'Health check endpoints' },
			{ name: 'Auth', description: 'Authentication endpoints (Better Auth)' },
			{
				name: 'Provisioning',
				description:
					'Pre-registration of devices in hawkBit. Done at the factory or warehouse BEFORE any company claims the device.',
			},
			{
				name: 'Companies',
				description: 'Multi-tenancy company management. Members: viewer | operator | admin | owner.',
			},
			{
				name: 'Categories',
				description: 'Device grouping within a company (bus lines, garages, yards, regions)',
			},
			{
				name: 'Devices',
				description:
					'Company device management — CRUD, categories, claim, hawkBit operations. All routes require company membership with RBAC.',
			},
			{
				name: 'Deployments',
				description: 'OTA deployment creation, monitoring and management via hawkBit Distribution Sets',
			},
			{
				name: 'Artifacts',
				description: 'Firmware artifact management via hawkBit Software Modules',
			},
			{ name: 'Posts', description: 'Posts CRUD (reference implementation)' },
		],
	},
	scalarConfig: {
		spec: { url: '/docs/json' },
		// @ts-ignore
		theme: 'fastify',
		defaultOpenAllTags: false,
		hideModels: true,
		hideClientButton: false,
		showSidebar: true,
		showDeveloperTools: 'localhost',
		showToolbar: 'localhost',
		operationTitleSource: 'summary',
		persistAuth: true,
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
};
