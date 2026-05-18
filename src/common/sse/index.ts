/**
 * SSE (Server-Sent Events) module.
 *
 * Provides real-time event push to Flutter clients.
 * Eliminates the need for client-side polling.
 *
 * Usage:
 *   import { sseEmitter } from '@common/sse';
 *   sseEmitter.emit(companyId, 'device.status', { deviceId, connectionStatus });
 */
export { sseEmitter } from './emitter';
export type { SseEvent } from './emitter';
