import { redirect } from 'next/navigation';

/** Device details open in the devices drawer (?detail=) under the Arc console. */
export default async function DeviceDetailRedirect({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	redirect(`/devices?detail=${id}`);
}
