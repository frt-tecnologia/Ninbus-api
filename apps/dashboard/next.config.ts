import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Ninbus Dashboard.
 *
 * The dashboard is served at the ROOT of ninbus.frt.com.br — NO '/admin'
 * basePath. The dashboard URL must NEVER reveal an internal path like
 * '/admin' to the visitor (it's the entire site, not a sub-section).
 *
 * output: 'standalone' — produces a self-contained .next/standalone dir for the
 * Docker production image (~120MB, no node_modules needed at runtime).
 */
const nextConfig: NextConfig = {
	output: 'standalone',
	reactStrictMode: true,
	// The dashboard never talks to the API directly from the browser (cross-origin
	// cookie). All API calls go through the Route Handler proxy at /api/[...path].
	// No rewrites needed — the proxy handles forwarding to http://api:8081.
};

export default nextConfig;
