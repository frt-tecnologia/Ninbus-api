import { type ReactNode } from 'react';

export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
}) {
	return (
		<div className="mb-6 flex items-start justify-between">
			<div>
				<h1 className="text-2xl font-bold text-gray-900">{title}</h1>
				{description && (
					<p className="mt-1 text-sm text-gray-500">{description}</p>
				)}
			</div>
			{actions && <div className="flex items-center gap-2">{actions}</div>}
		</div>
	);
}
