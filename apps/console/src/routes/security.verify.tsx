import { FingerprintIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { resolveConsoleSession, sanitizeReturnTo } from "@/lib/session";

export const Route = createFileRoute("/security/verify")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: sanitizeReturnTo(search.returnTo),
  }),
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
  },
  component: VerifyPasskey,
});

function VerifyPasskey() {
  const returnTo = sanitizeReturnTo(Route.useSearch().returnTo);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.passkey();
    setPending(false);
    if (result.error) {
      setError(
        result.error.message ?? "Passkey verification was not completed.",
      );
      return;
    }
    window.location.assign(returnTo);
  }

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <ShieldCheckIcon aria-hidden="true" /> Atharvan security
      </div>
      <Card className="auth-card">
        <CardHeader>
          <div className="auth-icon">
            <FingerprintIcon />
          </div>
          <div>
            <h1>Verify your passkey</h1>
            <p>
              Confirm your identity with an enrolled passkey to enter the
              management plane or refresh sensitive-action approval.
            </p>
          </div>
        </CardHeader>
        <CardContent className="form-stack">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Button disabled={pending} onClick={verify}>
            <FingerprintIcon aria-hidden="true" />
            {pending ? "Waiting for passkey…" : "Verify passkey"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
