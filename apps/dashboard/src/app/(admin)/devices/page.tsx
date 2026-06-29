'use client';

import { useCallback } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { DeviceTable } from '@/components/domain/devices/device-table';
import { ProvisionDialog } from '@/components/domain/devices/provision-dialog';
import { useFetch } from '@/hooks/useFetch';
import { companyService, deviceService } from '@/lib/api';

export default function DevicesPage() {
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const devices = useFetch(useCallback(() => deviceService.listAll(), []));

	return (
		<>
			<PageHeader
				title="Dispositivos"
				description="Frota OTA — estado de cada dispositivo em tempo real."
				action={
				<ProvisionDialog
					onDone={() => {
						devices.refetch();
						companies.refetch();
					}}
				/>
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
