import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  CableIcon,
  ChartNoAxesCombinedIcon,
  DatabaseIcon,
  GitPullRequestArrowIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { OperatorShell } from "@/components/operator-shell";
import { unknownPlatformOverview } from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/")({
  component: PlatformOverview,
});

const metrics: ReadonlyArray<{
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}> = [
  {
    label: "Active workspaces",
    description: "Awaiting the workspace projection.",
    icon: UsersIcon,
  },
  {
    label: "Running executions",
    description: "Awaiting the workflow projection.",
    icon: ActivityIcon,
  },
  {
    label: "Runner capacity",
    description: "Awaiting the runner control plane.",
    icon: DatabaseIcon,
  },
  {
    label: "Current spend",
    description: "Awaiting reconciled cost records.",
    icon: ChartNoAxesCombinedIcon,
  },
];

function PlatformOverview() {
  return (
    <OperatorShell title="Overview">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Platform overview</h1>
            <p>
              Live platform facts appear only after their canonical sources are
              connected.
            </p>
          </div>
          <span className="data-freshness">
            Data state: {unknownPlatformOverview.status}
          </span>
        </section>

        <section aria-label="Platform metrics" className="metric-grid">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article className="metric-card" key={metric.label}>
                <div className="metric-icon">
                  <Icon aria-hidden="true" />
                </div>
                <div>
                  <p className="metric-label">{metric.label}</p>
                  <p className="metric-value">Unknown</p>
                  <p className="metric-description">{metric.description}</p>
                </div>
              </article>
            );
          })}
        </section>

        <section className="overview-grid">
          <UnknownPanel
            description="No telemetry projection is connected."
            icon={ChartNoAxesCombinedIcon}
            title="Executions over time"
          />
          <UnknownPanel
            description="Provider checks have not been registered."
            icon={CableIcon}
            title="Provider health"
          />
          <UnknownPanel
            description="Queue projections are not connected."
            icon={GitPullRequestArrowIcon}
            title="Workflow queue"
          />
          <UnknownPanel
            description="Events appear only after their canonical source is connected."
            icon={ShieldCheckIcon}
            title="Recent incidents and audit"
          />
        </section>
      </div>
    </OperatorShell>
  );
}

function UnknownPanel({
  title,
  description,
  icon: Icon,
}: Readonly<{ title: string; description: string; icon: LucideIcon }>) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="status-badge">Unknown</span>
      </div>
      <div className="empty-state compact">
        <Icon aria-hidden="true" />
        <strong>No verified evidence</strong>
        <p>Atharvan will never substitute generated sample values.</p>
      </div>
    </article>
  );
}
