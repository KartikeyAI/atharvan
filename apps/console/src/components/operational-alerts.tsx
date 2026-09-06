import type { OperationalAlert } from "@atharvan/domain";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";

export type AlertFilter = "all" | "critical";

/** Current signal list backed by durable firing and recovery transition delivery. */
export function OperationalAlerts({
  alerts,
  filter,
  onFilterChange,
}: {
  alerts: ReadonlyArray<OperationalAlert>;
  filter: AlertFilter;
  onFilterChange: (filter: AlertFilter) => void;
}) {
  const criticalCount = alerts.filter(
    (alert) => alert.severity === "critical",
  ).length;
  const visible =
    filter === "critical"
      ? alerts.filter((alert) => alert.severity === "critical")
      : alerts;
  return (
    <section aria-label="Operational alerts">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Operational alerts</CardTitle>
            <CardDescription>
              Current evidence and configuration checks. Alert firing and
              recovery transitions are routed through the durable delivery
              channel when configured.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="operational-alert-filters"
            role="group"
            aria-label="Filter alerts"
          >
            <Button
              variant={filter === "all" ? "default" : "outline"}
              aria-pressed={filter === "all"}
              onClick={() => onFilterChange("all")}
            >
              All alerts ({alerts.length})
            </Button>
            <Button
              variant={filter === "critical" ? "default" : "outline"}
              aria-pressed={filter === "critical"}
              onClick={() => onFilterChange("critical")}
            >
              Critical ({criticalCount})
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="operational-alert-empty">
              {filter === "critical" && alerts.length > 0
                ? "No critical alerts in this snapshot. Other alerts may still need review."
                : "No alerts from the available checks. Unconnected sources and untested services remain unknown."}
            </p>
          ) : (
            <ul className="operational-alert-list">
              {visible.map((alert) => (
                <li key={alert.id}>
                  <div className="operational-alert-heading">
                    <h3>{alert.title}</h3>
                    <Badge
                      variant={
                        alert.severity === "critical" ? "critical" : "warning"
                      }
                    >
                      {alert.severity === "critical" ? "Critical" : "Warning"}
                    </Badge>
                  </div>
                  <p>{alert.description}</p>
                  {alert.affectedCount !== null && (
                    <p className="operational-alert-count">
                      Affected entries: {alert.affectedCount}
                    </p>
                  )}
                  <details>
                    <summary>Recovery steps</summary>
                    <p>{alert.nextStep}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
