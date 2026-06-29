import { redirect } from 'next/navigation';

/**
 * Root /admin redirect → overview.
 *
 * Navigation helpers (redirect/router.push/<Link>) auto-apply basePath
 * '/admin', so we write routes WITHOUT it: '/overview' → '/admin/overview'.
 */
export default function AdminRoot() {
	redirect('/overview');
}
