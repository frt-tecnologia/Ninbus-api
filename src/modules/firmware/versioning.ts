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
