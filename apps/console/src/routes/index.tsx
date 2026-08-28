import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  BlocksIcon,
  BotIcon,
  BoxIcon,
  CableIcon,
  ChartNoAxesCombinedIcon,
  CircleHelpIcon,
  CloudCogIcon,
  DatabaseIcon,
  FileClockIcon,
  GaugeIcon,
  GitPullRequestArrowIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SirenIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";

import { unknownPlatformOverview } from "@atharvan/domain";

export const Route = createFileRoute("/")({
  component: PlatformOverview,
});

const navigation: ReadonlyArray<{
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { label: "Overview", icon: GaugeIcon },
  { label: "Users & Workspaces", icon: UsersIcon },
  { label: "Models", icon: BotIcon },
  { label: "Integrations", icon: CableIcon },
  { label: "Runners", icon: BoxIcon },
  { label: "Workflows", icon: GitPullRequestArrowIcon },
  { label: "Deployments", icon: CloudCogIcon },
  { label: "Billing", icon: WalletCardsIcon },
  { label: "Security", icon: ShieldCheckIcon },
  { label: "Incidents", icon: SirenIcon },
  { label: "Audit", icon: FileClockIcon },
  { label: "Settings", icon: SettingsIcon },
];

const metrics: ReadonlyArray<{
  readonly label: string;
  readonly value: string;
  readonly description: string;
  readonly icon: LucideIcon;
}> = [
  {
    label: "Active workspaces",
    value: "Unknown",
    description: "Awaiting the workspace projection.",
    icon: UsersIcon,
  },
  {
    label: "Running executions",
    value: "Unknown",
    description: "Awaiting the workflow projection.",
    icon: ActivityIcon,
  },
  {
    label: "Runner capacity",
    value: "Unknown",
    description: "Awaiting the runner control plane.",
    icon: DatabaseIcon,
  },
  {
    label: "Current spend",
    value: "Unknown",
    description: "Awaiting reconciled cost records.",
    icon: ChartNoAxesCombinedIcon,
  },
];

function PlatformOverview() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BlocksIcon aria-hidden="true" />
          <span>Atharvan</span>
        </div>
        <nav aria-label="Operator navigation" className="navigation">
          {navigation.map((item, index) => {
            const Icon = item.icon;
            return (
              <a
                aria-current={index === 0 ? "page" : undefined}
                className="navigation-item"
                href={index === 0 ? "/" : "#unavailable"}
                key={item.label}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="environment-marker">
          <span className="environment-dot" />
          DEV environment
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <button
            aria-label="Toggle navigation"
            className="icon-button"
            type="button"
          >
            <MenuIcon aria-hidden="true" />
          </button>
          <div className="breadcrumb">
            <span>Atharvan</span>
            <span aria-hidden="true">/</span>
            <strong>Overview</strong>
          </div>
          <button className="search-button" type="button">
            <SearchIcon aria-hidden="true" />
            <span>Search platform operations</span>
            <kbd>⌘K</kbd>
          </button>
          <div
            className="platform-health"
            data-state={unknownPlatformOverview.status}
          >
            <span className="status-dot" />
            Platform health: {unknownPlatformOverview.status}
          </div>
          <button aria-label="Help" className="icon-button" type="button">
            <CircleHelpIcon aria-hidden="true" />
          </button>
          <div aria-label="Current operator" className="avatar">
            OP
          </div>
        </header>

        <div className="page">
          <section className="page-heading">
            <div>
              <h1>Platform overview</h1>
              <p>
                Live platform facts appear only after their canonical sources
                are connected.
              </p>
            </div>
            <span className="data-freshness">Data state: unknown</span>
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
                    <p className="metric-value">{metric.value}</p>
                    <p className="metric-description">{metric.description}</p>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="overview-grid">
            <article className="panel panel-wide">
              <div className="panel-header">
                <div>
                  <h2>Executions over time</h2>
                  <p>No telemetry projection is connected.</p>
                </div>
                <span className="status-badge">Unknown</span>
              </div>
              <div className="empty-state">
                <ChartNoAxesCombinedIcon aria-hidden="true" />
                <strong>Execution data unavailable</strong>
                <p>
                  This chart will render reconciled execution records, not
                  generated sample values.
                </p>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <h2>Provider health</h2>
                  <p>Health checks have not been registered.</p>
                </div>
                <span className="status-badge">Unknown</span>
              </div>
              <div className="empty-state compact">
                <CableIcon aria-hidden="true" />
                <strong>No provider evidence</strong>
                <p>
                  Providers appear here only after deterministic health checks
                  run.
                </p>
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <h2>Workflow queue</h2>
                  <p>Queue projections are not connected.</p>
                </div>
                <span className="status-badge">Unknown</span>
              </div>
              <div className="empty-state compact">
                <GitPullRequestArrowIcon aria-hidden="true" />
                <strong>No workflow evidence</strong>
                <p>
                  Pending, running, failed, and dead-letter counts will be
                  reconciled here.
                </p>
              </div>
            </article>

            <article className="panel panel-wide">
              <div className="panel-header">
                <div>
                  <h2>Recent incidents and audit</h2>
                  <p>
                    Immutable events will appear after audit storage is
                    connected.
                  </p>
                </div>
                <span className="status-badge">Unknown</span>
              </div>
              <div className="empty-state compact">
                <ShieldCheckIcon aria-hidden="true" />
                <strong>No events recorded</strong>
                <p>
                  This is an empty canonical state, not a healthy-state claim.
                </p>
              </div>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}
