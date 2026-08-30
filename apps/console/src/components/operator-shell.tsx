import type { LucideIcon } from "lucide-react";
import {
  BlocksIcon,
  BotIcon,
  BoxIcon,
  CableIcon,
  CircleHelpIcon,
  CloudCogIcon,
  FileClockIcon,
  GaugeIcon,
  GitPullRequestArrowIcon,
  MenuIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SirenIcon,
  UsersIcon,
  WalletCardsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

const navigation: ReadonlyArray<{
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly available: boolean;
}> = [
  { label: "Overview", href: "/", icon: GaugeIcon, available: true },
  { label: "Operators", href: "/operators", icon: UsersIcon, available: true },
  {
    label: "Email domains",
    href: "/membership-domains",
    icon: ShieldCheckIcon,
    available: true,
  },
  { label: "Models", href: "/models", icon: BotIcon, available: false },
  {
    label: "Integrations",
    href: "/integrations",
    icon: CableIcon,
    available: false,
  },
  { label: "Runners", href: "/runners", icon: BoxIcon, available: false },
  {
    label: "Workflows",
    href: "/workflows",
    icon: GitPullRequestArrowIcon,
    available: false,
  },
  {
    label: "Deployments",
    href: "/deployments",
    icon: CloudCogIcon,
    available: false,
  },
  {
    label: "Billing",
    href: "/billing",
    icon: WalletCardsIcon,
    available: false,
  },
  {
    label: "Security",
    href: "/security",
    icon: ShieldCheckIcon,
    available: false,
  },
  { label: "Incidents", href: "/incidents", icon: SirenIcon, available: false },
  { label: "Audit", href: "/audit", icon: FileClockIcon, available: false },
  {
    label: "Settings",
    href: "/settings",
    icon: SettingsIcon,
    available: false,
  },
];

export function OperatorShell({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/">
          <BlocksIcon aria-hidden="true" />
          <span>Atharvan</span>
        </Link>
        <nav aria-label="Operator navigation" className="navigation">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return item.available ? (
              <Link
                aria-current={active ? "page" : undefined}
                className="navigation-item"
                key={item.label}
                to={item.href}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="navigation-item navigation-disabled"
                key={item.label}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </span>
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
            <strong>{title}</strong>
          </div>
          <div className="topbar-spacer" />
          <Link className="quiet-link" to="/login">
            Sign in
          </Link>
          <button aria-label="Help" className="icon-button" type="button">
            <CircleHelpIcon aria-hidden="true" />
          </button>
          <div aria-label="Current operator" className="avatar">
            OP
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
