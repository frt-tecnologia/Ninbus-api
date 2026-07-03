/**
 * Platform statistics — aggregated data powering the rich Overview page.
 *
 * One endpoint returns everything the overview needs (avoids N parallel
 * fetches from the client). Aggregations are SQL-side (cheap, indexed):
 *   - daily online-device histogram (from connection transitions)
 *   - deployment counts + failures (from activity_log)
 *   - most active companies (from activity_log)
 *   - update-hour distribution (when updates usually happen)
 *
 * All scoped to a [from, to] time window.
 */
import { db } from '@common/db';
import { activityLog } from '@common/db/schema';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

export interface DailyOnlinePoint {
	date: string; // YYYY-MM-DD
	online: number; // distinct devices that went online that day
}

export interface DeploymentFailReason {
	deploymentId: string;
	deploymentName: string | null;
	companyId: string | null;
	companyName: string | null;
	reason: string | null;
	actorEmail: string | null;
	createdAt: Date;
}

export interface CompanyActivity {
	companyId: string;
	companyName: string | null;
	actions: number;
}

export interface HourlyBucket {
	hour: number; // 0-23
	count: number;
}

export interface PlatformStats {
	range: { from: Date; to: Date };
	onlineHistogram: DailyOnlinePoint[];
	deploymentCreated: number;
	deploymentDeleted: number;
	artifactUploaded: number;
	topCompanies: CompanyActivity[];
	updateHourDistribution: HourlyBucket[];
	newUserDesignations: number;
}

/** Daily histogram of distinct devices that came online per day in [from,to]. */
async function dailyOnlineHistogram(from: Date, to: Date): Promise<DailyOnlinePoint[]> {
	const fromIso = from.toISOString();
	const toIso = to.toISOString();
	const rows = await db.execute(sql`
		SELECT
			to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day_key,
			COUNT(DISTINCT device_id)::int AS online
		FROM device_connections
		WHERE occurred_at >= ${fromIso} AND occurred_at <= ${toIso} AND event = 'online'
		GROUP BY day_key
		ORDER BY day_key ASC
	`);
	return (rows as unknown as { day_key: string; online: number }[]).map((r) => ({
		date: r.day_key,
		online: r.online,
	}));
}

/** Most active companies (by action count) in the window. */
async function topCompanies(from: Date, to: Date, limit = 5): Promise<CompanyActivity[]> {
	const fromIso = from.toISOString();
	const toIso = to.toISOString();
	const rows = await db.execute(sql`
		SELECT
			a.company_id AS "companyId",
			c.name AS "companyName",
			COUNT(*)::int AS actions
		FROM activity_log a
		LEFT JOIN companies c ON c.id = a.company_id
		WHERE a.created_at >= ${fromIso} AND a.created_at <= ${toIso} AND a.company_id IS NOT NULL
		GROUP BY a.company_id, c.name
		ORDER BY actions DESC
		LIMIT ${limit}
	`);
	return rows as unknown as CompanyActivity[];
}

/** Hour-of-day distribution of deployment.created events (peak update times). */
async function updateHourDistribution(from: Date, to: Date): Promise<HourlyBucket[]> {
	const fromIso = from.toISOString();
	const toIso = to.toISOString();
	const rows = await db.execute(sql`
		SELECT
			EXTRACT(HOUR FROM created_at)::int AS hour,
			COUNT(*)::int AS count
		FROM activity_log
		WHERE created_at >= ${fromIso}
		  AND created_at <= ${toIso}
		  AND action = 'deployment.created'
		GROUP BY hour
		ORDER BY hour ASC
	`);
	return rows as unknown as HourlyBucket[];
}

/** Count of a single action in the window. */
async function countAction(action: string, from: Date, to: Date): Promise<number> {
	const rows = await db
		.select({ c: sql<number>`COUNT(*)::int` })
		.from(activityLog)
		.where(
			and(
				eq(activityLog.action, action as any),
				gte(activityLog.createdAt, from),
				lte(activityLog.createdAt, to),
			),
		);
	return Number(rows[0]?.c ?? 0);
}

/**
 * Compute all platform statistics for the overview. Cheap (5 indexed queries).
 * Returns an empty-shaped result when there is no data yet (no crash).
 */
export async function getPlatformStats(from: Date, to: Date): Promise<PlatformStats> {
	const [
		onlineHistogram,
		deploymentCreated,
		deploymentDeleted,
		artifactUploaded,
		top,
		hours,
		newUserDesignations,
	] = await Promise.all([
		dailyOnlineHistogram(from, to),
		countAction('deployment.created', from, to),
		countAction('deployment.deleted', from, to),
		countAction('artifact.uploaded', from, to),
		topCompanies(from, to),
		updateHourDistribution(from, to),
		countAction('designation.created', from, to),
	]);

	return {
		range: { from, to },
		onlineHistogram,
		deploymentCreated,
		deploymentDeleted,
		artifactUploaded,
		topCompanies: top,
		updateHourDistribution: hours,
		newUserDesignations,
	};
}

/** Distinct devices that were online at least once in range (for the headline). */
export async function distinctOnlineDevices(from: Date, to: Date): Promise<number> {
	const fromIso = from.toISOString();
	const toIso = to.toISOString();
	const rows = await db.execute(sql`
		SELECT COUNT(DISTINCT device_id)::int AS c
		FROM device_connections
		WHERE occurred_at >= ${fromIso} AND occurred_at <= ${toIso} AND event = 'online'
	`);
	return Number((rows as unknown as { c: number }[])[0]?.c ?? 0);
}
