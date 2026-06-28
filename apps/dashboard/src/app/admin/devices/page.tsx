'use client';

import { useCallback } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DevicesTable } from '@/components/tables/DevicesTable';
import { ProvisionDeviceDialog } from '@/components/forms/ProvisionDeviceDialog';
import { useFetch, useMutation } from '@/hooks/useFetch';
import { deviceService, companyService } from '@/lib/api';
import { useState } from 'react';

export default function DevicesPage() {
	const devices = useFetch(useCallback(() => deviceService.listAll(), []));
	const companies = useFetch(useCallback(() => companyService.list(), []));
	const [showProvision, setShowProvision] = useState(false);

	return (
		<>
			<PageHeader
				title="Dispositivos"
				description="Todos os dispositivos da plataforma. Busque, filtre, ordene e cadastre novos."
			/>
			<DevicesTable
				devices={devices.data?.data ?? []}
				companies={companies.data?.data ?? []}
				loading={devices.loading}
				error={devices.error}
				onRetry={devices.refetch}
				onProvision={() => setShowProvision(true)}
			/>
			<ProvisionDeviceDialog
				open={showProvision}
				onClose={() => setShowProvision(false)}
				onProvisioned={devices.refetch}
			/>
		</>
	);
}
