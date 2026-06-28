import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
	return (
		<div className={cn('flex items-center justify-center p-8', className)}>
			<svg
				className="h-8 w-8 animate-spin text-brand-600"
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				aria-label="Carregando"
			>
				<circle
					className="opacity-25"
					cx="12"
					cy="12"
					r="10"
					stroke="currentColor"
					strokeWidth="4"
				/>
				<path
					className="opacity-75"
					fill="currentColor"
					d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
				/>
			</svg>
		</div>
	);
}

export function EmptyState({
	title,
	description,
	icon,
	action,
}: {
	title: string;
	description?: string;
	icon?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center px-6 py-12 text-center">
			{icon && <div className="mb-3 text-gray-300">{icon}</div>}
			<h3 className="text-sm font-semibold text-gray-900">{title}</h3>
			{description && (
				<p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>
			)}
			{action && <div className="mt-4">{action}</div>}
		</div>
	);
}

export function ErrorState({
	message,
	onRetry,
}: {
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center px-6 py-12 text-center">
			<div className="mb-2 text-2xl">⚠️</div>
			<h3 className="text-sm font-semibold text-red-700">Erro ao carregar</h3>
			<p className="mt-1 max-w-sm text-sm text-gray-500">{message}</p>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
				>
					Tentar novamente
				</button>
			)}
		</div>
	);
}
