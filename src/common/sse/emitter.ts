import { env } from '@common/config/env';
/**
 * SSE Event Emitter — company-scoped real-time push.
 * W3C SSE format: id: N\nevent: type\ndata: json\n\n
 */
import { appLogger } from '@common/logger';
import { statusCoalescer } from './status-coalescer';

export interface SseEvent {
	event: string;
	data: Record<string, unknown>;
}

interface SseConnection {
	controller: ReadableStreamDefaultController;
	companyId: string;
	connectedAt: Date;
	lastSendAt: Date | null;
	lastEventId: number;
}

// ---------------------------------------------------------------------------
// SSE formatting
// ---------------------------------------------------------------------------

function formatSSE(id: number, event: string, data: Record<string, unknown>): string {
	const json = JSON.stringify(data);
	return `id: ${id}\nevent: ${event}\ndata: ${json}\n\n`;
}

// ---------------------------------------------------------------------------
// Emitter singleton
// ---------------------------------------------------------------------------

class SseEmitter {
	private connections = new Map<string, Set<SseConnection>>();
	private globalEventId = 0;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private readonly maxPerCompany: number;
	private readonly heartbeatMs: number;

	constructor() {
		this.maxPerCompany = env.SSE_MAX_CONNECTIONS_PER_COMPANY ?? 50;
		this.heartbeatMs = (env.SSE_HEARTBEAT_SEC ?? 30) * 1000;
	}

	// -------------------------------------------------------------------------
	// Connection management
	// -------------------------------------------------------------------------

	/**
	 * Register a new SSE connection for a company.
	 * Returns the connection handle (caller keeps reference for cleanup).
	 */
	addConnection(companyId: string, controller: ReadableStreamDefaultController): SseConnection {
		let companyConns = this.connections.get(companyId);
		if (!companyConns) {
			companyConns = new Set();
			this.connections.set(companyId, companyConns);
		}

		// Enforce max connections — evict oldest
		if (companyConns.size >= this.maxPerCompany) {
			const oldest = [...companyConns][0]!;
			this.closeConnection(oldest);
			appLogger.debug(
				`[SSE] Evicted oldest connection for company ${companyId} (max ${this.maxPerCompany})`,
			);
		}

		const conn: SseConnection = {
			controller,
			companyId,
			connectedAt: new Date(),
			lastSendAt: null,
			lastEventId: this.globalEventId,
		};

		companyConns.add(conn);

		// Send connected event immediately
		this.sendToConnection(conn, 'connected', {
			companyId,
			timestamp: new Date().toISOString(),
		});

		appLogger.debug(
			`[SSE] Connection opened for company ${companyId} (${companyConns.size} active)`,
		);
		return conn;
	}

	/**
	 * Remove a connection (client disconnected or error).
	 */
	removeConnection(conn: SseConnection): void {
		const companyConns = this.connections.get(conn.companyId);
		if (companyConns) {
			companyConns.delete(conn);
			if (companyConns.size === 0) {
				this.connections.delete(conn.companyId);
			}
		}
	}

	/**
	 * Close a connection gracefully — send close signal and remove.
	 */
	private closeConnection(conn: SseConnection): void {
		try {
			conn.controller.close();
		} catch {
			// Already closed — ignore
		}
		this.removeConnection(conn);
	}

	// -------------------------------------------------------------------------
	// Event emission
	// -------------------------------------------------------------------------

	/**
	 * Emit an event to ALL connections of a specific company.
	 */
	emit(companyId: string, event: string, data: Record<string, unknown>): void {
		const companyConns = this.connections.get(companyId);
		if (companyConns && companyConns.size > 0) {
			for (const conn of companyConns) {
				this.sendToConnection(conn, event, data);
			}
		}

		// Also send to global listeners (admin dashboard)
		const globalConns = this.connections.get('__global__');
		if (globalConns && globalConns.size > 0) {
			for (const conn of globalConns) {
				this.sendToConnection(conn, event, { ...data, _companyId: companyId });
			}
		}
	}

	/**
	 * Emit an event with PRE-SERIALISED payload — the JSON is encoded to a
	 * Uint8Array exactly ONCE and the same buffer is enqueued to every
	 * connection. Use for high-volume / large-payload events (e.g. the
	 * coalesced `devices.batch` with hundreds of deltas).
	 *
	 * For 1000 connections this avoids 1000× redundant JSON.stringify + encode
	 * calls — the dominant CPU cost at scale.
	 */
	emitBulk(companyId: string, event: string, data: Record<string, unknown>): void {
		const companyConns = this.connections.get(companyId);
		const globalConns = this.connections.get('__global__');
		const hasLocal = companyConns && companyConns.size > 0;
		const hasGlobal = globalConns && globalConns.size > 0;
		if (!hasLocal && !hasGlobal) return;

		// Pre-serialise ONCE for company connections.
		if (hasLocal) {
			const id = ++this.globalEventId;
			const frame = this.encodeFrame(id, event, data);
			for (const conn of companyConns!) {
				this.enqueueBulk(conn, id, frame);
			}
		}
		// Global connections get a copy with _companyId — needs its own frame.
		if (hasGlobal) {
			const id = ++this.globalEventId;
			const frame = this.encodeFrame(id, event, { ...data, _companyId: companyId });
			for (const conn of globalConns!) {
				this.enqueueBulk(conn, id, frame);
			}
		}
	}

	/** Encode an SSE frame to a reusable Uint8Array (no per-connection work). */
	private encodeFrame(id: number, event: string, data: Record<string, unknown>): Uint8Array {
		return new TextEncoder().encode(formatSSE(id, event, data));
	}

	/** Enqueue a pre-encoded frame to a connection (bulk path). */
	private enqueueBulk(conn: SseConnection, id: number, frame: Uint8Array): void {
		try {
			conn.lastEventId = id;
			conn.controller.enqueue(frame);
			conn.lastSendAt = new Date();
		} catch (error) {
			appLogger.debug(`[SSE] Bulk send failed, removing: ${error}`);
			this.removeConnection(conn);
		}
	}

	/** Whether a company has ANY active SSE connection.
	 *  Used by the status coalescer to short-circuit buffering when nobody is
	 *  listening — the key scale lever (idle companies cost ~zero CPU). */
	hasCompanyConnections(companyId: string): boolean {
		const conns = this.connections.get(companyId);
		return !!conns && conns.size > 0;
	}

	/**
	 * Send a single event to one connection.
	 */
	private sendToConnection(
		conn: SseConnection,
		event: string,
		data: Record<string, unknown>,
	): void {
		try {
			this.globalEventId++;
			conn.lastEventId = this.globalEventId;
			const sseString = formatSSE(conn.lastEventId, event, data);
			conn.controller.enqueue(new TextEncoder().encode(sseString));
			conn.lastSendAt = new Date();
		} catch (error) {
			// Connection likely closed — clean up
			appLogger.debug(`[SSE] Failed to send to connection, removing: ${error}`);
			this.removeConnection(conn);
		}
	}

	// -------------------------------------------------------------------------
	// Heartbeat & cleanup
	// -------------------------------------------------------------------------

	/**
	 * Start the heartbeat timer. Called at app startup.
	 */
	startHeartbeat(): void {
		if (this.heartbeatTimer) return;

		this.heartbeatTimer = setInterval(() => this.runHeartbeat(), this.heartbeatMs);
		// Start the status coalescer flush timer alongside the heartbeat.
		statusCoalescer.start();

		appLogger.info(
			`[SSE] Heartbeat started (interval: ${this.heartbeatMs / 1000}s, max/company: ${this.maxPerCompany})`,
		);
	}

	/** Run one heartbeat cycle — send to all active connections, cleanup stale. */
	private runHeartbeat(): void {
		const now = Date.now();
		let active = 0;

		for (const [companyId, companyConns] of this.connections) {
			for (const conn of companyConns) {
				// Stale = no send for 5 minutes
				if (conn.lastSendAt && now - conn.lastSendAt.getTime() > 300_000) {
					this.closeConnection(conn);
					continue;
				}

				try {
					this.sendToConnection(conn, 'heartbeat', { timestamp: new Date().toISOString() });
					active++;
				} catch {
					this.removeConnection(conn);
				}
			}
			if (companyConns.size === 0) this.connections.delete(companyId);
		}

		if (active > 0) appLogger.debug(`[SSE] Heartbeat: ${active} connections`);
	}

	/**
	 * Stop the heartbeat timer. Called on graceful shutdown.
	 */
	stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		// Drain any pending coalesced deltas before closing connections.
		statusCoalescer.stop();

		// Close all connections
		for (const [, companyConns] of this.connections) {
			for (const conn of companyConns) {
				this.closeConnection(conn);
			}
		}
		this.connections.clear();
		appLogger.info('[SSE] All connections closed');
	}

	/** Get total active connections. */
	get connectionCount(): number {
		let t = 0;
		for (const c of this.connections.values()) t += c.size;
		return t;
	}

	/** Get companies with active connections. */
	get companyCount(): number {
		return this.connections.size;
	}

	/** Whether the heartbeat timer is running. */
	get isHeartbeatRunning(): boolean {
		return this.heartbeatTimer !== null;
	}
}

// Singleton instance
export const sseEmitter = new SseEmitter();
