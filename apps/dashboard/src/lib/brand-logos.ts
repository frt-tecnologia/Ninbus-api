/**
 * Brand asset URLs (remote — CloudFront CDN).
 *
 * Single source of truth for the Ninbus + FRT logos. Used by <Brand>, the
 * login page, and the favicon metadata. The logos are served from the FRT
 * CloudFront distribution so they are always the canonical/latest versions
 * (same source Ninbus emails + the mobile app reference).
 *
 * These are ABSOLUTE URLs, so they are unaffected by the dashboard basePath
 * ('/console'). Rendered with plain <img> (not next/image): brand logos are
 * tiny, load on every page, and self-optimizing them through the Next image
 * optimizer in a standalone Docker image behind nginx is unnecessary overhead.
 */
export const BRAND_LOGOS = {
	ninbus: 'https://da19p053f3dc1.cloudfront.net/IMAGES/ninbus-logo.png',
	frt: 'https://da19p053f3dc1.cloudfront.net/IMAGES/logo-frt.jfif',
} as const;
