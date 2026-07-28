import { env } from '@common/config/env';
/**
 * Status Coalescer — batches device status changes into a single SSE event.
 *
 * PROBLEM: emitting one `device.status` event per device does not scale to
 * fleets of 50k+ devices. A single sync cycle touching 5k devices would
 * produce 5k × N-connections writes on the event loop (potentially millions).
 *
 * SOLUTION: buffer per-company status deltas and flush them as ONE
 * `devices.batch` event every `SSE_FLUSH_MS` (default 1500ms). Within the
 * window, deltas are de-duplicated by deviceId (last state wins), so a device
 * that oscillates online↔offline collapses to its final state.
 *
 * Cost model per window:
 *   Before: (changedDevices) × (activeConnections) writes
 *   After:  1 write × (activeConnections)   ← O(connections), not O(devices×conn)
 *
 * The coalescer also SHORT-CIRCUITS when a company has zero active SSE
 * connections (no point buffering deltas nobody will receive) — this is the
 * key AWS cost saver: idle companies cost ~zero CPU.
 */
import { appLogger } from '@common/logger';
import { sseEmitter } from './emitter';

/**
 * Compact status delta. Field names are intentionally short (`id`, `s`, `u`,
 * `t`) to minimise payload size when serialising thousands of deltas per
 * flush. The frontend maps them via a documented contract.
 */
export interface DeviceStatusDelta {
	/** Device UUID. */
	id: string;
	/** Connection status: 'connected' | 'disconnected' | 'online' | 'offline' | 'unknown'. */
	s: string;
	/** hawkBit update status (only present when it changed). */
	u?: string;
	/** Last poll time ISO UTC (only present when changed / non-null). */
	t?: string | null;
}

interface CompanyBuffer {
	/** deviceId → latest delta (de-dup: last write wins). */
	changes: Map<string, DeviceStatusDelta>;
}

class StatusCoalescer {
	private buffers = new Map<string, CompanyBuffer>();
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private readonly flushMs: number;
	private readonly batchMax: number;

	constructor() {
		this.flushMs = env.SSE_FLUSH_MS ?? 1500;
		this.batchMax = env.SSE_BATCH_MAX ?? 500;
	}

	/**
	 * Record a status delta for a device. Buffered per-company; flushed on the
	 * next timer tick (or immediately if the company buffer hits batchMax).
	 *
	 * If the company has NO active SSE connections, the call is a no-op —
	 * avoids burning CPU building payloads nobody will receive.
	 */
	record(companyId: string, delta: DeviceStatusDelta): void {
		// Short-circuit: no listeners → no work. This is the primary scale lever:
		// a company with 50k devices but zero open dashboard tabs costs nothing.
		if (!sseEmitter.hasCompanyConnections(companyId)) return;

		let buf = this.buffers.get(companyId);
		if (!buf) {
			buf = { changes: new Map() };
			this.buffers.set(companyId, buf);
		}

		// De-duplicate by deviceId: last state wins (handles oscillation within window).
		buf.changes.set(delta.id, delta);

		// Force an early flush for THIS company if the payload is getting large.
		// Prevents unbounded memory / frame size during mass outages.
		if (buf.changes.size >= this.batchMax) {
			this.flushCompany(companyId, buf);
		}
	}

	/** Start the periodic flush timer. Called at app startup (alongside heartbeat). */
	start(): void {
		if (this.flushTimer) return;
		this.flushTimer = setInterval(() => this.flushAll(), this.flushMs);
		appLogger.info(
			'[SSE] Status coalescer started (flush: %dms, batchMax: %d)',
			this.flushMs,
			this.batchMax,
		);
	}

	/** Stop the flush timer and drain remaining buffers. Called on shutdown. */
	stop(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
		this.flushAll();
	}

	/** Number of companies with pending (un-flushed) deltas. */
	get pendingCompanies(): number {
		return this.buffers.size;
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private flushAll(): void {
		if (this.buffers.size === 0) return;
		for (const [companyId, buf] of this.buffers) {
			this.flushCompany(companyId, buf);
		}
		this.buffers.clear();
	}

	private flushCompany(companyId: string, buf: CompanyBuffer): void {
		if (buf.changes.size === 0) return;

		const changes = [...buf.changes.values()];
		buf.changes.clear();

		// Emit ONE batched event. sseEmitter fans out to all connections of the
		// company, serialising the payload exactly once (see emitter.emitBulk).
		sseEmitter.emitBulk(companyId, 'devices.batch', {
			count: changes.length,
			changes,
			timestamp: new Date().toISOString(),
		});
	}
}

// Singleton
export const statusCoalescer = new StatusCoalescer();
