'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { DeviceTable } from '@/components/domain/devices/device-table';
import { ProvisionDialog } from '@/components/domain/devices/provision-dialog';
import { Button } from '@/components/ui/button';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deviceService } from '@/lib/api';

export default function DevicesPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const devices = useFetch(useCallback(() => deviceService.listAll(), []));
	const [syncing, setSyncing] = useState(false);

	async function refreshStatus() {
		setSyncing(true);
		try {
			const res = await deviceService.syncAll();
			toast.success(res?.message ?? 'Status atualizado.');
			// Re-fetch the table so the fresh connectionStatus/lastSeenAt show up.
			await devices.refetch();
		} catch (err: unknown) {
			const msg =
				err instanceof Error ? err.message : 'Falha ao sincronizar com o hawkBit.';
			toast.error(msg);
		} finally {
			setSyncing(false);
		}
	}

	return (
		<>
			<PageHeader
				title="Dispositivos"
				description="Frota OTA — estado de cada dispositivo em tempo real."
				action={
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={refreshStatus}
							disabled={syncing}
							title="Buscar o status atual de cada dispositivo no hawkBit"
						>
							<RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
							Atualizar status
						</Button>
						<ProvisionDialog
							onDone={() => {
								devices.refetch();
								companies.refetch();
							}}
						/>
					</>
				}
			/>
			<DeviceTable
				devices={devices.data?.data ?? []}
				companies={companies.data?.data ?? []}
				loading={devices.loading}
				error={devices.error}
				onRetry={devices.refetch}
			/>
		</>
	);
}
