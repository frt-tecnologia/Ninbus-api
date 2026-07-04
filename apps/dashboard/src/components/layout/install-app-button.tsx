'use client';

import { Button } from '@/components/ui/button';
import { usePwaInstall } from '@/lib/pwa/use-pwa-install';
import { Check, Download } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

/**
 * <InstallAppButton> — shows a compact "Install app" button in the topbar when
 * the browser signals the native prompt is available. Clicking it calls the
 * deferred prompt (from a user gesture, per the PWA spec).
 *
 * Hidden when: already running standalone, or no prompt available (iOS/Safari
 * has no beforeinstallprompt — installation there is manual via Share menu).
 */
export function InstallAppButton() {
	const { canInstall, isStandalone, install } = usePwaInstall();
	const [busy, setBusy] = React.useState(false);

	// Don't render anything if there's nothing to do (keeps the topbar clean).
	if (isStandalone || !canInstall) return null;

	async function onClick() {
		setBusy(true);
		try {
			const outcome = await install();
			if (outcome === 'accepted') toast.success('App instalado.');
			else if (outcome === 'dismissed') toast('Instalação cancelada.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<Button
			variant="outline"
			size="sm"
			onClick={onClick}
			disabled={busy}
			className="h-8 gap-1.5 text-xs"
			aria-label="Instalar como app"
		>
			{busy ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
			<span className="hidden sm:inline">Instalar app</span>
		</Button>
	);
}
