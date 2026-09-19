#!/usr/bin/env node
/**
 * verify-rollout-artifact.mjs — forensic answers for a bench rollout report.
 *
 * Answers, against the REAL server (hawkBit MGMT API + API database):
 *   (1) artifact actually attached to the DS behind an action: filename,
 *       size, sha256 + full manifest parse of data/firmware.npm
 *       (magic, counter, declared image size, image sha256)
 *   (3) DS/action state for the given actions (retired? active? autoclose hints)
 *   (4) action status history timestamps (closed failure etc.) + poll gap
 *       analysis from the API's device_connections table
 *   (5) who assigned a given action/deployment (activity_log + deployments)
 *
 * Usage (on the server, or anywhere with access):
 *   HAWKBIT_URL=http://localhost:8180 \
 *   HAWKBIT_USERNAME=admin HAWKBIT_PASSWORD=... \
 *   CONTROLLER=1AC1500103414FFF ACTIONS=658,660,661 \
 *   DATABASE_URL=postgresql://... \    # optional (items 4/5)
 *   node scripts/verify-rollout-artifact.mjs
 */
import { createHash } from 'node:crypto';

const BASE = (process.env.HAWKBIT_URL || 'http://localhost:8180').replace(/\/$/, '');
const USER = process.env.HAWKBIT_USERNAME;
const PASS = process.env.HAWKBIT_PASSWORD;
const CONTROLLER = process.env.CONTROLLER;
const ACTIONS = (process.env.ACTIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DB_URL = process.env.DATABASE_URL;

if (!USER || !PASS || !CONTROLLER || ACTIONS.length === 0) {
	console.error('Need HAWKBIT_USERNAME, HAWKBIT_PASSWORD, CONTROLLER, ACTIONS (csv).');
	process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const api = async (path) => {
	const res = await fetch(`${BASE}${path}`, { headers: { authorization: auth } });
	if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
	return res;
};
const j = async (path) => (await api(path)).json();

console.log(`\n════ Target ${CONTROLLER} — actions ${ACTIONS.join(', ')} ════`);

// (item 5) hawkBit-native poll granularity — lastControllerRequestAt is the
// authoritative "device actually hit the DDI API" signal, independent of our
// own connection tracking.
try {
	const t = await j(`/rest/v1/targets/${CONTROLLER}`);
	console.log(`  lastControllerRequestAt: ${t.lastControllerRequestAt ? new Date(t.lastControllerRequestAt).toISOString() : '-'} (hawkBit-native)`);
	console.log(`  updateStatus=${t.updateStatus} | lastUpdatedAt=${t.lastUpdatedAt ? new Date(t.lastUpdatedAt).toISOString() : '-'}`);
} catch (e) {
	console.log(`  target lookup failed: ${e.message}`);
}

for (const actionId of ACTIONS) {
	console.log(`\n───────── ACTION ${actionId} ─────────`);
	let action;
	try {
		action = await j(`/rest/v1/targets/${CONTROLLER}/actions/${actionId}`);
	} catch (e) {
		console.log(`  action lookup failed: ${e.message}`);
		continue;
	}
	console.log(`  type=${action.type} active=${action.active} status=${action.status}`);
	console.log(`  maintenanceWindow=${action.maintenanceWindowStatus ?? '-'} forceType=${action.forceType ?? '-'}`);
	const dsId = action.distributionSet?.id;
	console.log(`  DS #${dsId} "${action.distributionSet?.name}" v${action.distributionSet?.version} (${action.distributionSet?.typeName})`);

	// (3) action status history — timestamps of every report (closed failure etc.)
	let status;
	try {
		status = await j(`/rest/v1/targets/${CONTROLLER}/actions/${actionId}/status`);
	} catch {
		status = null;
	}
	if (status) {
		const entries = Array.isArray(status) ? status : (status.content ?? []);
		for (const s of entries) {
			console.log(
				`  status: ${new Date(s.reportedAt ?? s.createdAt).toISOString()} | ${s.status} | ${(s.messages ?? []).join(' | ').slice(0, 120)}`,
			);
		}
	}

	// (1) DS → assigned software module → artifact + manifest parse
	let modules;
	try {
		modules = await j(`/rest/v1/distributionsets/${dsId}/assignedSM`);
	} catch {
		modules = [];
	}
	const sms = Array.isArray(modules) ? modules : (modules?.content ?? []);
	for (const sm of sms) {
		console.log(`  DS module: SM #${sm.id} "${sm.name}" v${sm.version} (${sm.type})`);
		let arts;
		try {
			arts = await j(`/rest/v1/softwaremodules/${sm.id}/artifacts`);
		} catch {
			arts = [];
		}
		for (const a of Array.isArray(arts) ? arts : []) {
			console.log(`    artifact #${a.id}: ${a.providedFilename} | ${a.size} B`);
			console.log(`    sha256: ${a.hashes?.sha256 ?? '-'}`);
			if (/\.(tar|npm)$/i.test(a.providedFilename ?? '')) {
				try {
					const bin = Buffer.from(await (await api(`/rest/v1/softwaremodules/${sm.id}/artifacts/${a.id}/download`)).arrayBuffer());
					await parseTar(bin);
				} catch (e) {
					console.log(`    tar parse failed: ${e.message}`);
				}
			}
		}
	}
}

/** Minimal USTAR reader for artifact.info + data/firmware.npm + manifest. */
async function parseTar(buf) {
	let off = 0;
	while (off + 512 <= buf.length) {
		const header = buf.subarray(off, off + 512);
		if (header.every((b) => b === 0)) break;
		const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
		const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0| /g, ''), 8) || 0;
		const data = buf.subarray(off + 512, off + 512 + size);
		off += 512 + Math.ceil(size / 512) * 512;
		if (name.endsWith('artifact.info')) {
			console.log(`    artifact.info: ${data.toString('utf8').trim().slice(0, 120)}`);
		}
		if (name.endsWith('data/firmware.npm') || name.endsWith('firmware.npm')) {
			const magic = data.subarray(0, 4).toString('latin1');
			const imgSize = data.readUInt32LE(4);
			const counter = data.readUInt32LE(40);
			const image = data.subarray(128);
			const imgSha = createHash('sha256').update(image).digest('hex');
			console.log(`    manifest: magic=${JSON.stringify(magic)} imageBytes=${imgSize} counter=${counter}`);
			console.log(`    image actual=${image.length} B | sha256=${imgSha}`);
			console.log(
				`    verdict: magic ${magic === 'NPM\x01' ? 'OK' : 'WRONG'} | size ${imgSize === image.length ? 'OK' : `MISMATCH (decl ${imgSize} vs actual ${image.length})`}`,
			);
		}
	}
}

// (4)/(5) — database side (needs DATABASE_URL of the API's Neon)
if (DB_URL) {
	try {
		const mod = await import('postgres');
		const sql = mod.default(DB_URL, { prepare: false, max: 1 });
		console.log(`\n════ device row: poll floor + sync state (item 5) ════`);
		const dev = await sql`SELECT serial_display, last_poll_at, next_expected_poll_at, firmware_version,
			 hawkbit_update_status, connection_status, updated_at FROM devices
			 WHERE hawkbit_target_id = ${CONTROLLER} OR serial_number = ${CONTROLLER}`;
		dev.forEach((r) => console.log(`  ${r.serial_display ?? CONTROLLER} | last_poll=${r.last_poll_at?.toISOString?.() ?? '-'} | next_expected=${r.next_expected_poll_at?.toISOString?.() ?? '-'} | fw=${r.firmware_version ?? '-'} | updStatus=${r.hawkbit_update_status ?? '-'} | conn=${r.connection_status ?? '-'}`));

		console.log(`\n════ device_connections window (item 4) ════`);
		const polls = await sql`SELECT connected_at, disconnected_at, ip_address FROM device_connections
			 WHERE device_id = (SELECT id FROM devices WHERE hawkbit_target_id = ${CONTROLLER} OR serial_number = ${CONTROLLER})
			 ORDER BY connected_at DESC LIMIT 20`;
		polls.forEach((r) => console.log(`  ${r.connected_at?.toISOString?.()} → ${r.disconnected_at?.toISOString?.() ?? 'open'} ip=${r.ip_address}`));

		console.log(`\n════ deployments audit (item 5) ════`);
		const deps = await sql`SELECT id, name, status, artifact_version, artifact_name, created_by, created_at
			 FROM deployments ORDER BY created_at DESC LIMIT 8`;
		deps.forEach((r) => console.log(`  dep ${r.id} | ${r.artifact_name} v${r.artifact_version} | by=${r.created_by} | ${r.created_at?.toISOString?.()}`));

		console.log(`\n════ activity_log firmware events (items 2/5) ════`);
		const acts = await sql`SELECT action, actor_email, entity_label, created_at FROM activity_log
			 WHERE action LIKE 'firmware%' ORDER BY created_at DESC LIMIT 12`;
		acts.forEach((r) => console.log(`  ${r.created_at?.toISOString?.()} | ${r.action} | ${r.actor_email} | ${r.entity_label}`));
		await sql.end();
	} catch (e) {
		console.log(`\nDB check failed: ${e.message}`);
	}
} else {
	console.log('\n(DATABASE_URL not set — items 4/5 need the API database)');
}
