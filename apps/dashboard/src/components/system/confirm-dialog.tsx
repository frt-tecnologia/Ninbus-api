'use client';

import { Loader2 } from 'lucide-react';
import * as React from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * <ConfirmDialog> — the app-wide replacement for window.confirm().
 *
 * Controlled component: parent owns `open`/`onOpenChange` and renders it
 * next to the trigger. `onConfirm` may be async — the action button shows
 * a spinner and the dialog only closes on success (errors keep it open so
 * the message stays visible via toast).
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = 'Confirmar',
	cancelLabel = 'Cancelar',
	destructive = false,
	onConfirm,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description?: React.ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	onConfirm: () => Promise<void> | void;
	/** Optional trigger content (renders as the dialog trigger). */
	children?: React.ReactNode;
}) {
	const [loading, setLoading] = React.useState(false);

	async function handleConfirm() {
		try {
			setLoading(true);
			await onConfirm();
			onOpenChange(false);
		} finally {
			setLoading(false);
		}
	}

	const dialog = (
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogTitle>{title}</AlertDialogTitle>
				{description && <AlertDialogDescription>{description}</AlertDialogDescription>}
			</AlertDialogHeader>
			<AlertDialogFooter>
				<AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
				<AlertDialogAction
					disabled={loading}
					onClick={(e) => {
						// Prevent the default close-on-click: we close after onConfirm.
						e.preventDefault();
						void handleConfirm();
					}}
					className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
				>
					{loading && <Loader2 className="animate-spin" />}
					{confirmLabel}
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	);

	if (children) {
		return (
			<AlertDialog open={open} onOpenChange={onOpenChange}>
				<AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
				{dialog}
			</AlertDialog>
		);
	}
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			{dialog}
		</AlertDialog>
	);
}
