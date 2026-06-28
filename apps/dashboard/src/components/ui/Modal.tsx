'use client';

import { type ReactNode, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Modal — accessible dialog with backdrop, escape-to-close, and confirm/cancel.
 * Used for create/edit forms and destructive confirmations.
 */
export function Modal({
	open,
	onClose,
	title,
	description,
	children,
	footer,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	description?: string;
	children?: ReactNode;
	footer?: ReactNode;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			<div
				className="w-full max-w-lg rounded-xl bg-white shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="border-b border-gray-100 px-5 py-4">
					<h2 className="text-lg font-semibold text-gray-900">{title}</h2>
					{description && (
						<p className="mt-1 text-sm text-gray-500">{description}</p>
					)}
				</div>
				{children && <div className="px-5 py-4">{children}</div>}
				{footer && (
					<div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
						{footer}
					</div>
				)}
			</div>
		</div>
	);
}

/** Convenience confirm dialog for destructive actions. */
export function ConfirmDialog({
	open,
	onClose,
	onConfirm,
	title,
	message,
	confirmLabel = 'Confirmar',
	loading,
}: {
	open: boolean;
	onClose: () => void;
	onConfirm: () => void;
	title: string;
	message: string;
	confirmLabel?: string;
	loading?: boolean;
}) {
	return (
		<Modal
			open={open}
			onClose={onClose}
			title={title}
			footer={
				<>
					<Button variant="outline" onClick={onClose} disabled={loading}>
						Cancelar
					</Button>
					<Button variant="danger" onClick={onConfirm} loading={loading}>
						{confirmLabel}
					</Button>
				</>
			}
		>
			<p className="text-sm text-gray-600">{message}</p>
		</Modal>
	);
}
