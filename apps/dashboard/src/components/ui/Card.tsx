import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				'rounded-xl border border-gray-200 bg-white shadow-sm',
				className,
			)}
		>
			{children}
		</div>
	);
}

export function CardHeader({
	title,
	description,
	action,
}: {
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
			<div>
				<h3 className="text-base font-semibold text-gray-900">{title}</h3>
				{description && (
					<p className="mt-0.5 text-sm text-gray-500">{description}</p>
				)}
			</div>
			{action}
		</div>
	);
}

export function CardBody({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn('p-5', className)}>{children}</div>;
}

export function StatCard({
	label,
	value,
	icon,
	hint,
}: {
	label: string;
	value: string | number;
	icon?: ReactNode;
	hint?: string;
}) {
	return (
		<Card>
			<div className="flex items-center justify-between p-5">
				<div>
					<p className="text-sm font-medium text-gray-500">{label}</p>
					<p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
					{hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
				</div>
				{icon && (
					<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
						{icon}
					</div>
				)}
			</div>
		</Card>
	);
}
