/**
 * SSE End-to-End Test Simulation
 *
 * Run: bun run src/scripts/sse-test-simulation.ts
 *
 * This script:
 * 1. Starts the app server
 * 2. Creates a test session (signs in)
 * 3. Opens an SSE connection
 * 4. Triggers test events via POST /api/sse/test/:companyId
 * 5. Triggers simulated events via POST /api/sse/simulate/:companyId
 * 6. Verifies events are received on the SSE stream
 * 7. Reports PASS/FAIL
 *
 * Prerequisites: .env configured with a valid test user.
 */

const BASE_URL = process.env['SSE_TEST_URL'] || 'http://localhost:8081';
const TEST_EMAIL = process.env['SSE_TEST_EMAIL'] || 'admin@ninbus.io';
const TEST_PASSWORD = process.env['SSE_TEST_PASSWORD'] || 'Admin123!';
const TEST_COMPANY_ID = process.env['SSE_TEST_COMPANY_ID'] || '';

interface TestResult {
	name: string;
	passed: boolean;
	detail: string;
}

const results: TestResult[] = [];

function log(msg: string) {
	console.log(`[SSE-TEST] ${new Date().toISOString()} ${msg}`);
}

function result(name: string, passed: boolean, detail: string) {
	results.push({ name, passed, detail });
	const icon = passed ? '✅' : '❌';
	log(`${icon} ${name}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signIn(): Promise<string> {
	const res = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
	});

	if (!res.ok) {
		throw new Error(`Sign-in failed: ${res.status} ${await res.text()}`);
	}

	// Extract session cookie from Set-Cookie header
	const setCookie = res.headers.getSetCookie();
	const cookies = setCookie
		.map((c: string) => c.split(';')[0])
		.join('; ');

	if (!cookies) {
		throw new Error('No session cookie received after sign-in');
	}

	log(`Signed in as ${TEST_EMAIL}`);
	return cookies;
}

async function getFirstCompany(cookies: string): Promise<string> {
	if (TEST_COMPANY_ID) return TEST_COMPANY_ID;

	const res = await fetch(`${BASE_URL}/api/companies/`, {
		headers: { Cookie: cookies },
	});

	if (!res.ok) {
		throw new Error(`Failed to list companies: ${res.status}`);
	}

	const companies = await res.json() as any[];
	if (!companies.length) {
		throw new Error('No companies found for this user');
	}

	log(`Using company: ${companies[0].id} (${companies[0].name})`);
	return companies[0].id;
}

interface SseRawEvent {
	id?: string;
	event: string;
	data: string;
}

/**
 * Connect to SSE and collect events for `durationMs`.
 * Uses raw fetch + ReadableStream parsing (no browser EventSource).
 */
async function collectSseEvents(
	cookies: string,
	companyId: string,
	durationMs: number,
): Promise<SseRawEvent[]> {
	return new Promise((resolve, reject) => {
		const events: SseRawEvent[] = [];
		let eventType = '';
		let data = '';
		let eventId: string | undefined;
		let lineBuffer = '';

		const timeout = setTimeout(() => {
			log(`SSE collection done — ${events.length} events received`);
			cleanup();
			resolve(events);
		}, durationMs);

		const cleanup = () => {
			clearTimeout(timeout);
		};

		log(`Connecting to SSE for company ${companyId}...`);

		fetch(`${BASE_URL}/api/companies/${companyId}/sse`, {
			headers: {
				Cookie: cookies,
				Accept: 'text/event-stream',
				'Cache-Control': 'no-cache',
			},
		})
			.then(async (res) => {
				if (!res.ok) {
					reject(new Error(`SSE connection failed: ${res.status} ${await res.text()}`));
					return;
				}

				if (res.headers.get('content-type') !== 'text/event-stream') {
					reject(new Error(`Wrong content-type: ${res.headers.get('content-type')}`));
					return;
				}

				log(`SSE connected — Content-Type: ${res.headers.get('content-type')}`);

				const reader = res.body!.getReader();
				const decoder = new TextDecoder();

				const read = async () => {
					while (true) {
						const { done, value } = await reader.read();
						if (done) {
							log('SSE stream ended');
							break;
						}

						const text = decoder.decode(value, { stream: true });
						const combined = lineBuffer + text;
						const lines = combined.split('\n');
						lineBuffer = lines.pop()!; // Last element may be partial

						for (const rawLine of lines) {
							const line = rawLine.replace(/\r/g, '');
							if (line.startsWith('event: ')) {
								eventType = line.substring(7).trim();
							} else if (line.startsWith('data: ')) {
								data = line.substring(6);
							} else if (line.startsWith('data:')) {
								data = line.substring(5);
							} else if (line.startsWith('id: ')) {
								eventId = line.substring(4).trim();
							} else if (line === '') {
								if (data) {
									events.push({ id: eventId, event: eventType, data });
								}
								eventType = '';
								data = '';
								eventId = undefined;
							}
						}
					}
				};

				await read();
				cleanup();
				resolve(events);
			})
			.catch((err) => {
				cleanup();
				reject(err);
			});
	});
}

async function triggerTestEvent(cookies: string, companyId: string): Promise<any> {
	const res = await fetch(`${BASE_URL}/api/sse/test/${companyId}`, {
		method: 'POST',
		headers: { Cookie: cookies, 'Content-Type': 'application/json' },
	});
	if (!res.ok) {
		throw new Error(`Test event trigger failed: ${res.status}`);
	}
	return res.json();
}

async function triggerSimulation(
	cookies: string,
	companyId: string,
	opts: { eventCount?: number; intervalMs?: number; eventType?: string },
): Promise<any> {
	const res = await fetch(`${BASE_URL}/api/sse/simulate/${companyId}`, {
		method: 'POST',
		headers: { Cookie: cookies, 'Content-Type': 'application/json' },
		body: JSON.stringify(opts),
	});
	if (!res.ok) {
		throw new Error(`Simulation trigger failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function checkDebugConnections(cookies: string): Promise<any> {
	const res = await fetch(`${BASE_URL}/api/sse/debug/connections`, {
		headers: { Cookie: cookies },
	});
	if (!res.ok) {
		throw new Error(`Debug connections check failed: ${res.status}`);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

async function runTests() {
	log('═══════════════════════════════════════════════════════');
	log('SSE End-to-End Test Simulation');
	log('═══════════════════════════════════════════════════════');
	log(`Server: ${BASE_URL}`);

	// ── Step 1: Sign in ──────────────────────────────────
	let cookies: string;
	try {
		cookies = await signIn();
		result('Sign-in', true, `Authenticated as ${TEST_EMAIL}`);
	} catch (e: any) {
		result('Sign-in', false, e.message);
		printSummary();
		return;
	}

	// ── Step 2: Get company ──────────────────────────────
	let companyId: string;
	try {
		companyId = await getFirstCompany(cookies);
		result('Company selection', true, `Company ${companyId}`);
	} catch (e: any) {
		result('Company selection', false, e.message);
		printSummary();
		return;
	}

	// ── Step 3: Open SSE connection and collect events ────
	log('Opening SSE connection...');
	const ssePromise = collectSseEvents(cookies, companyId, 15_000);

	// Wait a moment for SSE to connect
	await new Promise((r) => setTimeout(r, 2000));

	// ── Step 4: Check debug connections ───────────────────
	try {
		const debug = await checkDebugConnections(cookies);
		result(
			'SSE connection registered',
			debug.totalConnections >= 1,
			`${debug.totalConnections} active connection(s), heartbeat: ${debug.emitterInfo?.heartbeatRunning}`,
		);
	} catch (e: any) {
		result('SSE connection registered', false, e.message);
	}

	// ── Step 5: Trigger test event ────────────────────────
	try {
		const testResult = await triggerTestEvent(cookies, companyId);
		result('Test event triggered', true, `Response: ${JSON.stringify(testResult)}`);
	} catch (e: any) {
		result('Test event triggered', false, e.message);
	}

	// ── Step 6: Wait and trigger simulation ───────────────
	await new Promise((r) => setTimeout(r, 1500));

	try {
		const simResult = await triggerSimulation(cookies, companyId, {
			eventCount: 3,
			intervalMs: 500,
			eventType: 'device.status',
		});
		result('Simulation triggered', true, `Sending ${simResult.eventCount} events every ${simResult.intervalMs}ms`);
	} catch (e: any) {
		result('Simulation triggered', false, e.message);
	}

	// ── Step 7: Collect and analyze SSE events ────────────
	log('Waiting for SSE events to arrive...');
	const events = await ssePromise;

	// Check connected event
	const connectedEvent = events.find((e) => e.event === 'connected');
	result(
		'connected event received',
		!!connectedEvent,
		connectedEvent ? `Data: ${connectedEvent.data}` : 'No connected event found',
	);

	// Check test event
	const testEvent = events.find((e) => e.event === 'test');
	result(
		'test event received',
		!!testEvent,
		testEvent ? `Data: ${testEvent.data}` : 'No test event found',
	);

	// Check simulated device.status events
	const deviceStatusEvents = events.filter((e) => e.event === 'device.status');
	result(
		'device.status events received',
		deviceStatusEvents.length >= 3,
		`Received ${deviceStatusEvents.length}/3 simulated device.status events`,
	);

	// Check event data is valid JSON
	let validJsonCount = 0;
	for (const e of events) {
		try {
			JSON.parse(e.data);
			validJsonCount++;
		} catch {
			log(`Invalid JSON in event ${e.event}: ${e.data}`);
		}
	}
	result(
		'All event data is valid JSON',
		validJsonCount === events.length,
		`${validJsonCount}/${events.length} events have valid JSON`,
	);

	// Check event IDs are sequential
	const ids = events
		.map((e) => parseInt(e.id || '0', 10))
		.filter((id) => id > 0);
	const sequential = ids.length > 0 && ids.every((id, i) => i === 0 || id > ids[i - 1]!);
	result(
		'Event IDs are sequential',
		sequential,
		`IDs: ${ids.join(', ')}`,
	);

	// Heartbeat may or may not arrive in 15s window — just log it
	const heartbeatEvents = events.filter((e) => e.event === 'heartbeat');
	log(`Heartbeat events: ${heartbeatEvents.length} (expected 0-1 in 15s window)`);

	printSummary();
}

function printSummary() {
	log('═══════════════════════════════════════════════════════');
	log('TEST RESULTS');
	log('═══════════════════════════════════════════════════════');

	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;

	for (const r of results) {
		const icon = r.passed ? '✅' : '❌';
		log(`${icon} ${r.name}: ${r.detail}`);
	}

	log('───────────────────────────────────────────────────────');
	log(`TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
	log('═══════════════════════════════════════════════════════');

	if (failed > 0) {
		process.exit(1);
	}
}

// Run
runTests().catch((err) => {
	log(`Fatal error: ${err}`);
	process.exit(1);
});
