import { expect, test } from 'bun:test';
/**
 * Unit tests for deployment error classification.
 *
 * Guards the 503→404 masking fix: a DeploymentNotFoundError (thrown by
 * requireDeploymentOwnership when a DS is not in the local DB) MUST map to 404,
 * never to a misleading 503. hawkBit network/auth errors are classified distinctly.
 */
import { HawkbitApiError } from '@common/hawkbit/http';
import { DeploymentNotFoundError, classifyDeploymentError } from './errors';

test('DeploymentNotFoundError → 404 (the masking fix)', () => {
	const { status, error, message } = classifyDeploymentError(
		new DeploymentNotFoundError('Deployment #240 not found in this company'),
	);
	expect(status).toBe(404);
	expect(error).toBe('Not Found');
	expect(message).toBe('Deployment #240 not found in this company');
});

test('HawkbitApiError 404 → 404 (DS orphaned in hawkBit)', () => {
	const { status, error } = classifyDeploymentError(
		new HawkbitApiError(404, {}, '/rest/v1/distributionsets/240'),
	);
	expect(status).toBe(404);
	expect(error).toBe('Not Found');
});

test('HawkbitApiError 401 → 502 (auth misconfigured, NOT 503)', () => {
	const { status, error, message } = classifyDeploymentError(
		new HawkbitApiError(401, {}, '/rest/v1/distributionsets/240'),
	);
	expect(status).toBe(502);
	expect(error).toBe('Bad Gateway');
	expect(message).toContain('authentication');
});

test('HawkbitApiError 503 → 503 (hawkBit unreachable)', () => {
	const { status } = classifyDeploymentError(
		new HawkbitApiError(503, { error: 'econnrefused' }, '/rest/v1/targets'),
	);
	expect(status).toBe(503);
});

test('HawkbitApiError 408 → 503 (timeout)', () => {
	const { status } = classifyDeploymentError(
		new HawkbitApiError(408, {}, '/rest/v1/distributionsets/240'),
	);
	expect(status).toBe(503);
});

test('HawkbitApiError 500 → 502 (surfaces real status)', () => {
	const { status, message } = classifyDeploymentError(new HawkbitApiError(500, {}, '/rest/v1/x'));
	expect(status).toBe(502);
	expect(message).toContain('500');
});

test('plain Error → 503 fallback with message preserved', () => {
	const { status, message } = classifyDeploymentError(new Error('something broke'));
	expect(status).toBe(503);
	expect(message).toBe('something broke');
});

test('non-Error value → 503 fallback', () => {
	const { status } = classifyDeploymentError('weird');
	expect(status).toBe(503);
});
