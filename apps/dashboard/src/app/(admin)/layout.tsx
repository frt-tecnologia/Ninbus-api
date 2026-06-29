import { type ReactNode } from 'react';
import { requireAdmin } from '@/lib/auth/session';
import { AppShell } from '@/components/layout/app-shell';

/**
 * Admin layout — wraps every /admin/* page.
 * Enforces the super-admin guard server-side (requireAdmin redirects to login
 * or a forbidden page if the visitor is not a platform admin), then mounts the
 * client <AppShell> (responsive rail + topbar + ⌘K + theme toggle).
 */
export default async function AdminLayout({
	children,
}: {
	children: ReactNode;
}) {
	const user = await requireAdmin();
	return <AppShell userEmail={user.email}>{children}</AppShell>;
}
