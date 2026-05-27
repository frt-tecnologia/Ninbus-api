/**
 * SSE Event Emitter — company-scoped real-time push.
 * W3C SSE format: id: N\nevent: type\ndata: json\n\n
 */
import { appLogger } from '@common/logger';
import { env } from '@common/config/env';

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
	get companyCount(): number { return this.connections.size; }

	/** Whether the heartbeat timer is running. */
	get isHeartbeatRunning(): boolean { return this.heartbeatTimer !== null; }
}

// Singleton instance
export const sseEmitter = new SseEmitter();
