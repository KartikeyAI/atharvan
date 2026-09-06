import {
  buildPlatformOverview,
  summarizeHealth,
  type HealthEvidenceDistribution,
  type HealthEvidenceCounts,
  type HealthSource,
  type PlatformConfigurationEnvironment,
  type PlatformHealthHistoryPoint,
  type PlatformHealthHistorySeries,
  type PlatformOverview,
} from "@atharvan/domain";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import type * as schema from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
const historyBucketCount = 24;
const historyBucketMilliseconds = 60 * 60 * 1_000;

interface HealthHistoryRow extends HealthEvidenceDistribution {
  readonly recordedAt: string;
}

function rowsFromResult(
  result: unknown,
): ReadonlyArray<Record<string, unknown>> {
  if (
    typeof result !== "object" ||
    result === null ||
    !("rows" in result) ||
    !Array.isArray(result.rows)
  ) {
    throw new Error("invalid_health_result");
  }
  return result.rows as ReadonlyArray<Record<string, unknown>>;
}

/** Fixed identifiers plus bound environment/time parameters; no operator-supplied SQL. */
export function healthSummaryQuery(
  source: HealthSource,
  environment: PlatformConfigurationEnvironment,
  now: Date,
) {
  const registry =
    source === "models"
      ? sql`public.model_providers`
      : sql`public.platform_integrations`;
  const observations =
    source === "models"
      ? sql`public.model_provider_health_observations`
      : sql`public.platform_integration_health_observations`;
  const foreignKey = sql.identifier(
    source === "models" ? "provider_id" : "integration_id",
  );
  const observedAt = now.toISOString();
  // The existing (entity_id, observed_at) indexes bound each latest-observation lookup.
  // Ties use created_at and id, so counts are deterministic across repeated reads.
  return sql`WITH evidence AS (
    SELECT CASE
      WHEN h.id IS NULL OR h.observed_at > ${observedAt}::timestamptz
        OR h.expires_at <= h.observed_at THEN 'unknown'
      WHEN h.expires_at <= ${observedAt}::timestamptz THEN 'stale'
      ELSE h.status::text END AS state,
      CASE WHEN h.observed_at <= ${observedAt}::timestamptz THEN h.observed_at END AS observed_at,
      CASE WHEN h.observed_at <= ${observedAt}::timestamptz AND h.expires_at > ${observedAt}::timestamptz
        THEN h.expires_at END AS expires_at
    FROM ${registry} r
    LEFT JOIN LATERAL (
      SELECT id, status, observed_at, expires_at
      FROM ${observations} h WHERE h.${foreignKey} = r.id
      ORDER BY observed_at DESC, created_at DESC, id DESC LIMIT 1
    ) h ON true
    WHERE r.environment = ${environment}
  ) SELECT count(*)::integer AS total,
    count(*) FILTER (WHERE state = 'healthy')::integer AS healthy,
    count(*) FILTER (WHERE state = 'degraded')::integer AS degraded,
    count(*) FILTER (WHERE state = 'unavailable')::integer AS unavailable,
    count(*) FILTER (WHERE state = 'stale')::integer AS stale,
    count(*) FILTER (WHERE state = 'unknown')::integer AS unknown,
    max(observed_at)::text AS "latestObservedAt",
    min(expires_at)::text AS "nextExpiryAt"
    FROM evidence`;
}

/** Build a fixed 24-hour series without exposing entity identifiers or probe details. */
export function healthHistoryQuery(
  source: HealthSource,
  environment: PlatformConfigurationEnvironment,
  now: Date,
) {
  const registry =
    source === "models"
      ? sql`public.model_providers`
      : sql`public.platform_integrations`;
  const observations =
    source === "models"
      ? sql`public.model_provider_health_observations`
      : sql`public.platform_integration_health_observations`;
  const foreignKey = sql.identifier(
    source === "models" ? "provider_id" : "integration_id",
  );
  const observedAt = now.toISOString();
  return sql`WITH buckets AS (
    SELECT ${observedAt}::timestamptz - make_interval(hours => bucket_offset) AS bucket_at
    FROM generate_series(${historyBucketCount - 1}, 0, -1) AS series(bucket_offset)
  ), evidence AS (
    SELECT b.bucket_at, CASE
      WHEN h.id IS NULL OR h.expires_at <= h.observed_at THEN 'unknown'
      WHEN h.expires_at <= b.bucket_at THEN 'stale'
      ELSE h.status::text END AS state
    FROM buckets b
    JOIN ${registry} r
      ON r.environment = ${environment} AND r.created_at <= b.bucket_at
    LEFT JOIN LATERAL (
      SELECT id, status, observed_at, expires_at
      FROM ${observations} h
      WHERE h.${foreignKey} = r.id AND h.observed_at <= b.bucket_at
      ORDER BY observed_at DESC, created_at DESC, id DESC LIMIT 1
    ) h ON true
  ) SELECT b.bucket_at::text AS "recordedAt",
    count(e.state)::integer AS total,
    count(*) FILTER (WHERE e.state = 'healthy')::integer AS healthy,
    count(*) FILTER (WHERE e.state = 'degraded')::integer AS degraded,
    count(*) FILTER (WHERE e.state = 'unavailable')::integer AS unavailable,
    count(*) FILTER (WHERE e.state = 'stale')::integer AS stale,
    count(*) FILTER (WHERE e.state = 'unknown')::integer AS unknown
    FROM buckets b LEFT JOIN evidence e ON e.bucket_at = b.bucket_at
    GROUP BY b.bucket_at ORDER BY b.bucket_at`;
}

function parseHistory(
  source: HealthSource,
  rows: ReadonlyArray<Record<string, unknown>>,
  now: Date,
): ReadonlyArray<PlatformHealthHistoryPoint> {
  if (rows.length !== historyBucketCount) {
    throw new Error("invalid_health_history_length");
  }
  let previousTime =
    now.getTime() - historyBucketCount * historyBucketMilliseconds;
  return rows.map((untypedRow, index) => {
    const row = untypedRow as unknown as HealthHistoryRow;
    const recordedAt = new Date(row.recordedAt);
    const recordedTime = recordedAt.getTime();
    const expectedTime =
      now.getTime() -
      (historyBucketCount - index - 1) * historyBucketMilliseconds;
    if (
      !Number.isFinite(recordedTime) ||
      recordedTime !== expectedTime ||
      recordedTime <= previousTime
    ) {
      throw new Error("invalid_health_history_boundary");
    }
    previousTime = recordedTime;
    const counts: HealthEvidenceDistribution = {
      total: row.total,
      healthy: row.healthy,
      degraded: row.degraded,
      unavailable: row.unavailable,
      stale: row.stale,
      unknown: row.unknown,
    };
    const status = summarizeHealth(source, {
      ...counts,
      latestObservedAt: null,
      nextExpiryAt: null,
    }).status;
    return { recordedAt: recordedAt.toISOString(), status, counts };
  });
}

/** Read aggregates only: provider secrets, OAuth metadata and customer records never leave SQL. */
export function createPostgresPlatformOverviewReader(database: Database) {
  return {
    async read(
      environment: PlatformConfigurationEnvironment,
      now = new Date(),
      options: { readonly includeHistory?: boolean } = {},
    ): Promise<PlatformOverview> {
      const sources = ["models", "integrations"] as const;
      const summaryResults = await Promise.allSettled(
        sources.map(async (source) => {
          const result = await database.execute<
            HealthEvidenceCounts & Record<string, unknown>
          >(healthSummaryQuery(source, environment, now));
          const row = rowsFromResult(result)[0] as
            (HealthEvidenceCounts & Record<string, unknown>) | undefined;
          if (!row) throw new Error("missing_health_aggregate");
          const counts: HealthEvidenceCounts = {
            total: row.total,
            healthy: row.healthy,
            degraded: row.degraded,
            unavailable: row.unavailable,
            stale: row.stale,
            unknown: row.unknown,
            latestObservedAt: row.latestObservedAt
              ? new Date(row.latestObservedAt).toISOString()
              : null,
            nextExpiryAt: row.nextExpiryAt
              ? new Date(row.nextExpiryAt).toISOString()
              : null,
          };
          return summarizeHealth(source, counts);
        }),
      );
      const historyResults =
        options.includeHistory === false
          ? []
          : await Promise.allSettled(
              sources.map(async (source) => {
                const result = await database.execute<
                  HealthHistoryRow & Record<string, unknown>
                >(healthHistoryQuery(source, environment, now));
                return parseHistory(source, rowsFromResult(result), now);
              }),
            );
      const history: ReadonlyArray<PlatformHealthHistorySeries> =
        options.includeHistory === false
          ? []
          : historyResults.map((result, index) => ({
              source: sources[index]!,
              points: result?.status === "fulfilled" ? result.value : null,
            }));
      return buildPlatformOverview(
        environment,
        now,
        summaryResults.map((result, index) =>
          result.status === "fulfilled"
            ? result.value
            : summarizeHealth(sources[index]!, null),
        ),
        history,
      );
    },
  };
}
