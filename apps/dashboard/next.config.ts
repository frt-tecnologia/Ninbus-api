import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Ninbus Dashboard.
 *
 * basePath '/console' — the dashboard is an INTERNAL tool served at
 * ninbus.frt.com.br/console. The path is deliberately NOT the obvious '/admin'
 * (too guessable) and NOT the root '/' (reserved for the future public
 * site). nginx routes /console + /console/* to this container; everything else
 * on the host returns 404 so the dashboard's existence is not advertised.
 *
 * output: 'standalone' — produces a self-contained .next/standalone dir for the
 * Docker production image (~120MB, no node_modules needed at runtime).
 */
const nextConfig: NextConfig = {
	basePath: '/console',
	output: 'standalone',
	reactStrictMode: true,
	async headers() {
		return [
			{
				// The service worker must NEVER be cached long-term, or users get
				// stuck on an old SW version after a deploy. Serve it with a short
				// no-cache + correct JS MIME (some CDNs/proxies default to text/plain).
				source: '/sw.js',
				headers: [
					{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
					{ key: 'Service-Worker-Allowed', value: '/console' },
				],
			},
			{
				// Manifest should revalidate too (icon/name changes).
				source: '/manifest.webmanifest',
				headers: [
					{ key: 'Cache-Control', value: 'no-cache' },
					{ key: 'Content-Type', value: 'application/manifest+json' },
				],
			},
		];
	},
};

export default nextConfig;
