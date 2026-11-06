/**
 * Global device polling interval (platform super admin).
 * GET  /admin/polling → effective seconds + source (override | env-default)
 * PUT  /admin/polling → validate (5-86400s), push to hawkBit, persist override
 */

import { http } from './http';

export interface PollingTimeState {
	effectiveSec: number;
	source: 'override' | 'env-default';
	updatedBy: string | null;
	updatedAt: string | null;
}

export const pollingService = {
	async get(): Promise<{ data: PollingTimeState }> {
		return http.get<{ data: PollingTimeState }>('/admin/polling');
	},

	async set(pollingSec: number): Promise<{ data: PollingTimeState }> {
		return http.put<{ data: PollingTimeState }>('/admin/polling', { pollingSec });
	},
};
