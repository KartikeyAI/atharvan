import type { ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
} from "@tanstack/react-router";

import { resolveConsoleSession, sanitizeReturnTo } from "../lib/session";
import styles from "../styles.css?url";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    // Internal server-function requests must bypass page authentication. The
    // function resolves the session itself; guarding its transport route would
    // recursively invoke the same function and deadlock SSR.
    if (
      location.pathname.startsWith("/api/") ||
      location.pathname.startsWith("/_serverFn/")
    )
      return;
    const session = await resolveConsoleSession();
    if (location.pathname === "/login") {
      if (session.authenticated) {
        const returnTo = new URLSearchParams(location.searchStr).get(
          "returnTo",
        );
        throw redirect({ href: sanitizeReturnTo(returnTo) });
      }
      return;
    }
    if (!session.authenticated) {
      throw redirect({
        to: "/login",
        search: {
          returnTo: sanitizeReturnTo(location.href),
        },
      });
    }
  },
  head: () => ({
    links: [{ rel: "stylesheet", href: styles }],
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Atharvan — Arth Platform Operations",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
