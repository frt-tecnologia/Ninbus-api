/**
 * Semver utilities for the firmware catalog.
 *
 * Release tags are strict semver (`MAJOR.MINOR.PATCH` with optional
 * prerelease/build suffix). "Latest" is resolved by comparing tags, with a
 * recency tie-break for pathological cases (same tag republished).
 */

/** Strict semver with optional prerelease/build suffix. */
export const SEMVER_PATTERN = '^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$';

/** Compare two semver strings: negative | 0 | positive (release > prerelease). */
export function compareVersions(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return a.localeCompare(b);

	for (let i = 0; i < 3; i++) {
		const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
		if (diff !== 0) return diff;
	}
	// A release WITHOUT pre-release outranks one WITH it (4.0.1 > 4.0.1-rc.1).
	if (!pa.pre && !pb.pre) return 0;
	if (!pa.pre) return 1;
	if (!pb.pre) return -1;
	return pa.pre.localeCompare(pb.pre);
}

function parseSemver(v: string): { core: [number, number, number]; pre: string | null } | null {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/.exec(v.trim());
	if (!m) return null;
	return {
		core: [Number(m[1]), Number(m[2]), Number(m[3])],
		pre: m[4] ?? null,
	};
}

/**
 * Publish-gate fleet-floor verdict. EQUAL is NOT a downgrade: the floor can
 * come from this very release's pilot/test installs (or a prior rollout of
 * the same tag) — devices already on it classify as up_to_date and never get
 * an offer. Only strictly-lower needs signed allow_downgrade. Anti-replay
 * stays guaranteed by the separate counter-monotonic check.
 */
export function fleetVersionFloorVerdict(
	releaseVersion: string,
	fleetFloorVersion: string | null,
	allowDowngrade: boolean,
): { passed: boolean; detail: string } {
	if (!fleetFloorVersion) {
		return {
			passed: true,
			detail: 'no device reports a firmware version yet — nothing to floor against.',
		};
	}
	if (allowDowngrade) {
		return { passed: true, detail: 'allow_downgrade is signed (bit0) — floor check waived.' };
	}
	const cmp = compareVersions(releaseVersion, fleetFloorVersion);
	if (cmp === 0) {
		return {
			passed: true,
			detail: `declared ${releaseVersion} matches the fleet floor ${fleetFloorVersion} — not a downgrade (the floor came from this very release's pilot/rollout installs; devices on it are already up_to_date).`,
		};
	}
	return cmp > 0
		? { passed: true, detail: `declared ${releaseVersion} > fleet floor ${fleetFloorVersion}` }
		: {
				passed: false,
				detail: `declared ${releaseVersion} < fleet floor ${fleetFloorVersion} — re-sign with a higher version or --allow-downgrade.`,
			};
}
