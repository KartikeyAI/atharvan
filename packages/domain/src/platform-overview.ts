import type { PlatformConfigurationEnvironment } from "./platform-configuration";
import {
  buildOperationalAlerts,
  type OperationalAlert,
} from "./operational-alerts";
import type { OperationalRetentionHealth } from "./operational-retention";

export type HealthSource = "models" | "integrations";
export type PlatformHealthStatus =
  "healthy" | "partial" | "degraded" | "action-required" | "unknown" | "error";

/** Mutually exclusive health states for registered entries. */
export interface HealthEvidenceDistribution {
  readonly total: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly unavailable: number;
  readonly stale: number;
  readonly unknown: number;
}

/** Mutually exclusive counts of latest observations for registered entries. */
export interface HealthEvidenceCounts extends HealthEvidenceDistribution {
  readonly latestObservedAt: string | null;
  readonly nextExpiryAt: string | null;
}

export interface PlatformHealthSummary {
  readonly source: HealthSource;
  readonly status: PlatformHealthStatus;
  /** Null on read failure: unavailable data must never become zero counts. */
  readonly counts: HealthEvidenceCounts | null;
}

export interface PlatformHealthHistoryPoint {
  /** Rolling hourly boundary evaluated against evidence available at that time. */
  readonly recordedAt: string;
  readonly status: PlatformHealthStatus;
  readonly counts: HealthEvidenceDistribution;
}

export interface PlatformHealthHistorySeries {
  readonly source: HealthSource;
  /** Null preserves a source read failure; an empty array is valid empty history. */
  readonly points: ReadonlyArray<PlatformHealthHistoryPoint> | null;
}

export interface ArthCommandDeliveryHealth {
  readonly observedAt: string;
  readonly pending: number;
  readonly leased: number;
  readonly rejected: number;
  readonly deadLetters: number;
  readonly oldestOutstandingAt: string | null;
}

export interface PlatformOverview {
  readonly environment: PlatformConfigurationEnvironment;
  readonly status: PlatformHealthStatus;
  readonly generatedAt: string;
  readonly validUntil: string;
  readonly evidence: ReadonlyArray<PlatformHealthSummary>;
  /** Twenty-four rolling hourly evidence snapshots, oldest first. */
  readonly history: ReadonlyArray<PlatformHealthHistorySeries>;
  readonly alerts: ReadonlyArray<OperationalAlert>;
  readonly operationalRetention: OperationalRetentionHealth | null;
  readonly unconnectedSources: ReadonlyArray<
    "workspaces" | "runners" | "workflows" | "costs" | "incidents"
  >;
}

/** Reject malformed aggregate results rather than publishing misleading health. */
export function summarizeHealth(
  source: HealthSource,
  counts: HealthEvidenceCounts | null,
): PlatformHealthSummary {
  if (counts === null) return { source, status: "error", counts: null };
  const { total, healthy, degraded, unavailable, stale, unknown } = counts;
  if (
    ![total, healthy, degraded, unavailable, stale, unknown].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    total !== healthy + degraded + unavailable + stale + unknown
  ) {
    throw new Error("invalid_health_counts");
  }
  const status: PlatformHealthStatus =
    unavailable > 0
      ? "action-required"
      : degraded > 0
        ? "degraded"
        : healthy === 0
          ? "unknown"
          : stale + unknown > 0
            ? "partial"
            : "healthy";
  return { source, status, counts };
}

/** Overall coverage remains partial until all platform telemetry sources exist. */
export function buildPlatformOverview(
  environment: PlatformConfigurationEnvironment,
  now: Date,
  evidence: ReadonlyArray<PlatformHealthSummary>,
  history: ReadonlyArray<PlatformHealthHistorySeries> = [],
): PlatformOverview {
  const fresh = evidence.reduce(
    (sum, entry) =>
      sum +
      (entry.counts === null
        ? 0
        : entry.counts.healthy +
          entry.counts.degraded +
          entry.counts.unavailable),
    0,
  );
  const status: PlatformHealthStatus = evidence.some(
    (entry) => entry.status === "action-required",
  )
    ? "action-required"
    : evidence.length > 0 && evidence.every((entry) => entry.status === "error")
      ? "error"
      : evidence.some(
            (entry) => entry.status === "degraded" || entry.status === "error",
          )
        ? "degraded"
        : fresh > 0
          ? "partial"
          : "unknown";
  let validUntil = now.getTime() + 30_000;
  for (const entry of evidence) {
    if (entry.counts?.nextExpiryAt) {
      const expiry = Date.parse(entry.counts.nextExpiryAt);
      if (!Number.isFinite(expiry) || expiry <= now.getTime())
        throw new Error("invalid_health_expiry");
      validUntil = Math.min(validUntil, expiry);
    }
  }
  return {
    environment,
    status,
    generatedAt: now.toISOString(),
    validUntil: new Date(validUntil).toISOString(),
    evidence,
    history,
    alerts: buildOperationalAlerts(environment, evidence),
    operationalRetention: null,
    unconnectedSources: [
      "workspaces",
      "runners",
      "workflows",
      "costs",
      "incidents",
    ],
  };
}
