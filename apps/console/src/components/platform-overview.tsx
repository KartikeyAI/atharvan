import type {
  OperationalRetentionHealth,
  PlatformHealthHistorySeries,
  PlatformHealthStatus,
  PlatformHealthSummary,
} from "@atharvan/domain";
import { useState } from "react";
import { OperationalAlerts, type AlertFilter } from "./operational-alerts";
import type { OverviewState } from "../lib/overview-polling";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

const healthLabels: Record<PlatformHealthStatus, string> = {
  healthy: "Healthy",
  partial: "Partial coverage",
  degraded: "Degraded",
  "action-required": "Action required",
  unknown: "Unknown",
  error: "Unavailable",
};

function HealthBadge({ status }: { status: PlatformHealthStatus }) {
  const variant =
    status === "healthy"
      ? "success"
      : status === "action-required" || status === "error"
        ? "critical"
        : status === "degraded" || status === "partial"
          ? "warning"
          : "neutral";
  return <Badge variant={variant}>{healthLabels[status]}</Badge>;
}

function RetentionCard({
  retention,
}: {
  retention: OperationalRetentionHealth | null;
}) {
  const removed = retention?.counts
    ? Object.values(retention.counts).reduce((sum, count) => sum + count, 0)
    : null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Operational evidence retention</CardTitle>
          <CardDescription>
            Hourly bounded cleanup with durable lease and audit evidence.
          </CardDescription>
        </div>
        <Badge
          variant={
            retention?.state === "completed"
              ? retention.batchLimitReached
                ? "warning"
                : "success"
              : retention?.state === "failed" || retention === null
                ? "critical"
                : "warning"
          }
        >
          {retention === null
            ? "Unavailable"
            : retention.state === "unknown"
              ? "Awaiting first run"
              : retention.state}
        </Badge>
      </CardHeader>
      <CardContent>
        {retention === null ? (
          <p>Retention evidence could not be read.</p>
        ) : (
          <>
            <p>
              {retention.completedAt ? (
                <>
                  Last successful run:{" "}
                  <time dateTime={retention.completedAt}>
                    {retention.completedAt
                      .replace("T", " ")
                      .replace(/\.\d{3}Z$/, " UTC")}
                  </time>
                  {removed === null ? "" : ` · ${removed} records removed`}
                </>
              ) : (
                "No successful retention run has been recorded."
              )}
            </p>
            <dl className="settings-grid">
              {retention.policies.map((policy) => (
                <div key={policy.category}>
                  <dt>{policy.category}</dt>
                  <dd>
                    {policy.disposition === "preserve"
                      ? "Preserved"
                      : `${policy.retentionDays} days`}
                    {" · "}
                    {policy.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HealthCard({ summary }: { summary: PlatformHealthSummary }) {
  const counts = summary.counts;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>
            {summary.source === "models" ? "Model providers" : "Integrations"}
          </CardTitle>
          <CardDescription>
            Latest recorded probe for every registered entry.
          </CardDescription>
        </div>
        <div>
          <HealthBadge status={summary.status} />
        </div>
      </CardHeader>
      <CardContent>
        {counts === null ? (
          <p>Health evidence could not be read. Refresh to try again.</p>
        ) : counts.total === 0 ? (
          <p>
            No registered{" "}
            {summary.source === "models" ? "model providers" : "integrations"}{" "}
            in this environment.
          </p>
        ) : (
          <dl className="model-metrics">
            {(
              [
                ["Registered", counts.total],
                ["Healthy", counts.healthy],
                ["Degraded", counts.degraded],
                ["Unavailable", counts.unavailable],
                ["Expired evidence", counts.stale],
                ["Unknown", counts.unknown],
              ] as const
            ).map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
      <CardFooter>
        <p className="card-description">
          {counts?.latestObservedAt ? (
            <>
              Latest recorded observation:{" "}
              <time dateTime={counts.latestObservedAt}>
                {counts.latestObservedAt
                  .replace("T", " ")
                  .replace(/\.\d{3}Z$/, " UTC")}
              </time>
            </>
          ) : (
            "No observation time available."
          )}
        </p>
      </CardFooter>
    </Card>
  );
}

function formatUtc(value: string) {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function HealthHistorySeriesRow({
  series,
}: {
  series: PlatformHealthHistorySeries;
}) {
  const label = series.source === "models" ? "Model providers" : "Integrations";
  if (series.points === null) {
    return (
      <div className="health-history-series">
        <div className="health-history-heading">
          <strong>{label}</strong>
          <Badge variant="critical">Unavailable</Badge>
        </div>
        <p>
          Historical evidence could not be read. Current health remains
          separate.
        </p>
      </div>
    );
  }
  if (series.points.length === 0) {
    return (
      <div className="health-history-series">
        <strong>{label}</strong>
        <p>No historical series was requested for this snapshot.</p>
      </div>
    );
  }
  const first = series.points[0]!;
  const last = series.points.at(-1)!;
  return (
    <div className="health-history-series">
      <div className="health-history-heading">
        <strong>{label}</strong>
        <span>{series.points.length} hourly boundaries</span>
      </div>
      <ol
        className="health-history-timeline"
        aria-label={`${label} health history`}
      >
        {series.points.map((point) => {
          const counts = point.counts;
          const detail = `${formatUtc(point.recordedAt)}: ${healthLabels[point.status]}. ${counts.healthy} healthy, ${counts.degraded} degraded, ${counts.unavailable} unavailable, ${counts.stale} expired, ${counts.unknown} unknown of ${counts.total}.`;
          return (
            <li
              key={point.recordedAt}
              className={`health-history-point is-${point.status}`}
              title={detail}
            >
              <span className="sr-only">{detail}</span>
            </li>
          );
        })}
      </ol>
      <div className="health-history-range" aria-hidden="true">
        <time dateTime={first.recordedAt}>{formatUtc(first.recordedAt)}</time>
        <time dateTime={last.recordedAt}>{formatUtc(last.recordedAt)}</time>
      </div>
    </div>
  );
}

function HealthHistoryCard({
  history,
}: {
  history: ReadonlyArray<PlatformHealthHistorySeries>;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>24-hour evidence history</CardTitle>
          <CardDescription>
            Rolling hourly snapshots reconstructed from recorded probe evidence.
            These boundaries do not claim continuous uptime.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="health-history-content">
        {history.map((series) => (
          <HealthHistorySeriesRow key={series.source} series={series} />
        ))}
      </CardContent>
      <CardFooter className="health-history-legend" aria-label="History legend">
        {(
          [
            ["healthy", "Healthy"],
            ["partial", "Partial"],
            ["degraded", "Degraded"],
            ["action-required", "Action required"],
            ["unknown", "Unknown"],
          ] as const
        ).map(([status, label]) => (
          <span key={status}>
            <i
              className={`health-history-key is-${status}`}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </CardFooter>
    </Card>
  );
}

/** Only the polling controller's unexpired snapshot can render health counts. */
export function PlatformOverviewPanel({
  state,
  refresh,
}: {
  state: OverviewState;
  refresh: () => void;
}) {
  const [alertFilter, setAlertFilter] = useState<AlertFilter>("all");
  return (
    <div className="page health-overview-page">
      <section className="page-heading">
        <div>
          <h1>Platform overview</h1>
          <p>Provider and integration health from stored probe observations.</p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={state.status === "loading"}
        >
          Refresh health
        </Button>
      </section>
      {state.status === "loading" ? (
        <p role="status">Checking health evidence…</p>
      ) : state.status === "error" ? (
        <Alert variant="destructive">
          <h2>Health overview unavailable</h2>
          <p>
            Current evidence could not be loaded. Refresh to try again;
            automatic retries continue.
          </p>
        </Alert>
      ) : (
        <>
          <div className="overview-snapshot">
            <span>
              Recorded health: <HealthBadge status={state.data.status} />
            </span>
            <span>
              {state.data.environment} · Snapshot{" "}
              <time dateTime={state.data.generatedAt}>
                {state.data.generatedAt
                  .replace("T", " ")
                  .replace(/\.\d{3}Z$/, " UTC")}
              </time>{" "}
              · Refreshes within 30 seconds
            </span>
          </div>
          <OperationalAlerts
            alerts={state.data.alerts}
            filter={alertFilter}
            onFilterChange={setAlertFilter}
          />
          <section
            aria-label="Recorded health"
            className="health-overview-grid"
          >
            {state.data.evidence.map((summary) => (
              <HealthCard key={summary.source} summary={summary} />
            ))}
          </section>
          <HealthHistoryCard history={state.data.history} />
          <RetentionCard retention={state.data.operationalRetention} />
        </>
      )}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sources not connected</CardTitle>
            <CardDescription>
              Workspaces, runner capacity, workflow executions, costs, and
              incidents remain unknown. Recorded probe health does not confirm
              routing readiness or trigger a new probe.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
