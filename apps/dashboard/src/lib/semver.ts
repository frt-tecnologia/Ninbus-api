/**
 * Client-side semver comparison — mirrors the API's compareVersions
 * (src/modules/firmware/versioning.ts) for UI-only decisions such as the
 * "latest vs superseded" column in the firmware table.
 */
export function compareVersionTags(a: string, b: string): number {
	const pa = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/.exec(a.trim());
	const pb = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/.exec(b.trim());
	if (!pa || !pb) return a.localeCompare(b);
	for (let i = 1; i <= 3; i++) {
		const diff = Number(pa[i]) - Number(pb[i]);
		if (diff !== 0) return diff;
	}
	if (!pa[4] && !pb[4]) return 0;
	if (!pa[4]) return 1;
	if (!pb[4]) return -1;
	return pa[4].localeCompare(pb[4] ?? '');
}
