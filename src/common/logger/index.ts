/**
 * Application logger — production-safe, no worker threads.
 *
 * Production / Docker: JSON output via pino({ destination: 1 }).
 * Development: pino-pretty via CLI pipe (`bun run dev | npx pino-pretty`).
 * Test: silent.
 *
 * Why no pino.transport()?
 * pino-pretty uses thread-stream (worker threads) which cannot resolve
 * from a single bundled JS file. The Docker image has no node_modules.
 * In production, we use synchronous JSON logging to stdout (fd 1).
 * In development, the dev script pipes output through pino-pretty.
 */
import { env } from '@common/config/env';
import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test';

export const appLogger = pino({
	level: isTest ? 'silent' : (env.LOG_LEVEL ?? 'info'),
});
