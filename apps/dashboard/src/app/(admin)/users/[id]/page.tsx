import { redirect } from 'next/navigation';

/** User details open in the users drawer (?detail=) under the Arc console. */
export default async function UserDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	redirect(`/users?detail=${id}`);
}
