import { companyService, deviceService, userService, designationService } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, StatCard } from '@/components/ui/Card';
import { Building2, HardDrive, Users, FileText } from 'lucide-react';

/**
 * Overview — platform-wide counts.
 * Server component: fetches directly through the proxy (cookie available in RSC).
 */
export default async function OverviewPage() {
	// Fetch in parallel; tolerate partial failures (each returns [] on error).
	const [companies, devices, users, designations] = await Promise.allSettled([
		companyService.list(),
		deviceService.listAll(),
		userService.list(),
		designationService.listPending(),
	]);

	const companyCount = fulfilled(companies)?.data.length ?? 0;
	const deviceCount = fulfilled(devices)?.data.length ?? 0;
	const userCount = fulfilled(users)?.data.length ?? 0;
	const pendingCount = fulfilled(designations)?.data.length ?? 0;

	return (
		<>
			<PageHeader
				title="Visão geral"
				description="Métricas globais da plataforma Ninbus"
			/>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Empresas"
					value={companyCount}
					icon={<Building2 className="h-6 w-6" />}
				/>
				<StatCard
					label="Dispositivos"
					value={deviceCount}
					icon={<HardDrive className="h-6 w-6" />}
				/>
				<StatCard
					label="Usuários"
					value={userCount}
					icon={<Users className="h-6 w-6" />}
				/>
				<StatCard
					label="Designações pendentes"
					value={pendingCount}
					icon={<FileText className="h-6 w-6" />}
					hint="Emails aguardando registro"
				/>
			</div>

			<Card className="mt-6">
				<CardBody>
					<p className="text-sm text-gray-600">
						Use o menu lateral para gerenciar dispositivos, empresas, usuários,
						deployments e designações. Todas as operações são feitas pela API
						oficial do Ninbus.
					</p>
				</CardBody>
			</Card>
		</>
	);
}

function fulfilled<T>(r: PromiseSettledResult<T>): T | null {
	return r.status === 'fulfilled' ? r.value : null;
}
