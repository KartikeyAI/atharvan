import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { resolveConsoleSession, sanitizeReturnTo } from "@/lib/session";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const session = await resolveConsoleSession();
    if (!session.authenticated) {
      throw redirect({
        to: "/login",
        search: { returnTo: sanitizeReturnTo(location.href) },
      });
    }
    if (session.assurance.mode === "enrollment_required") {
      throw redirect({
        to: "/security/passkeys",
        search: { returnTo: sanitizeReturnTo(location.href) },
      });
    }
    if (session.assurance.mode === "passkey_verification_required") {
      throw redirect({
        to: "/security/verify",
        search: { returnTo: sanitizeReturnTo(location.href) },
      });
    }
  },
  component: Outlet,
});
