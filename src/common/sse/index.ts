/**
 * SSE (Server-Sent Events) module.
 *
 * Provides real-time event push to Flutter clients.
 * Eliminates the need for client-side polling.
 *
 * Usage:
 *   import { sseEmitter, statusCoalescer } from '@common/sse';
 *   // Single-device event (rare, specific: claim/unclaim/deployment action):
 *   sseEmitter.emit(companyId, 'device.status', { deviceId, connectionStatus });
 *   // Bulk connection-status changes (frequent, high-volume): buffer via coalescer:
 *   statusCoalescer.record(companyId, { id, s, u, t });
 */

export type { SseEvent } from './emitter';
export { sseEmitter } from './emitter';
export type { DeviceStatusDelta } from './status-coalescer';
export { statusCoalescer } from './status-coalescer';
