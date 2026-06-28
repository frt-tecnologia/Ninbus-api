import { type ReactNode } from 'react';
import { requireAdmin } from '@/lib/auth/session';
import { Sidebar } from '@/components/layout/Sidebar';

/**
 * Admin layout — wraps every /admin/* page.
 * Enforces the super-admin guard server-side (requireAdmin redirects to login
 * or a forbidden page if the visitor is not a platform admin).
 */
export default async function AdminLayout({
	children,
}: {
	children: ReactNode;
}) {
	const user = await requireAdmin();
	return (
		<div className="flex min-h-screen bg-gray-50">
			<Sidebar userEmail={user.email} />
			<main className="flex-1 overflow-x-hidden">
				<div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
			</main>
		</div>
	);
}
