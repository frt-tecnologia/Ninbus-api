'use client';
/**
 * useLive — subscribes the current screen to an SSE scope and reports
 * connection status for the "Ao vivo / Reconectando" indicator.
 *
 * Pass `null` on screens that must not stream (e.g. login) — the hook then
 * stays inert. The scope's EventSource is shared across every mounted
 * subscriber of the same scope (ref-counted in `sse-client`).
 */

import * as React from 'react';
import { onSseStatus, openSse, type SseScope, type SseStatus } from './sse-client';

export function useLive(scope: SseScope | null): SseStatus {
	const [status, setStatus] = React.useState<SseStatus>('off');

	React.useEffect(() => {
		if (!scope) {
			setStatus('off');
			return;
		}
		const release = openSse(scope);
		const off = onSseStatus(scope, setStatus);
		return () => {
			off();
			release();
		};
	}, [scope?.kind, scope]);

	return status;
}
