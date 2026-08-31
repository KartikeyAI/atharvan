import { FingerprintIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { resolveConsoleSession, sanitizeReturnTo } from "@/lib/session";

export const Route = createFileRoute("/security/passkeys")({
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
  },
  component: PasskeyEnrollment,
});

type PasskeyEntry = {
  readonly id: string;
  readonly name?: string | null;
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly createdAt?: string | Date | null;
};

function PasskeyEnrollment() {
  const returnTo = sanitizeReturnTo(Route.useSearch().returnTo);
  const [name, setName] = useState("Primary passkey");
  const [attachment, setAttachment] = useState<"platform" | "cross-platform">(
    "platform",
  );
  const [passkeys, setPasskeys] = useState<ReadonlyArray<PasskeyEntry>>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadPasskeys = useCallback(async () => {
    setLoading(true);
    const result = await authClient.passkey.listUserPasskeys();
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Passkeys could not be loaded.");
      return;
    }
    setPasskeys((result.data ?? []) as ReadonlyArray<PasskeyEntry>);
  }, []);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  async function registerPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);

    if (!("PublicKeyCredential" in window)) {
      setPending(false);
      setError("This browser does not support passkeys.");
      return;
    }

    const registration = await authClient.passkey.addPasskey({
      name: name.trim(),
      authenticatorAttachment: attachment,
    });
    if (registration.error) {
      setPending(false);
      setError(
        registration.error.message ?? "Passkey registration was not completed.",
      );
      return;
    }

    setMessage("Passkey registered. Verify it once to enter Atharvan.");
    await loadPasskeys();
    const verification = await authClient.signIn.passkey();
    setPending(false);
    if (verification.error) {
      setError(
        "The passkey was saved, but verification was not completed. Use Verify passkey to continue.",
      );
      return;
    }
    window.location.assign(returnTo);
  }

  async function verifyPasskey() {
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

  async function deletePasskey(id: string) {
    setPending(true);
    setError(null);
    const result = await authClient.passkey.deletePasskey({ id });
    setPending(false);
    if (result.error) {
      setError(
        result.error.message ??
          "The passkey could not be removed. Keep at least one enrolled passkey.",
      );
      return;
    }
    setMessage("Passkey removed.");
    await loadPasskeys();
  }

  return (
    <main className="auth-page security-page">
      <div className="auth-brand">
        <ShieldCheckIcon aria-hidden="true" /> Atharvan security
      </div>
      <Card className="auth-card security-card">
        <CardHeader>
          <div className="auth-icon">
            <FingerprintIcon />
          </div>
          <div>
            <h1>Passkey protection required</h1>
            <p>
              Platform operators must use a phishing-resistant passkey with
              device PIN or biometric verification.
            </p>
          </div>
        </CardHeader>
        <CardContent className="form-stack">
          {message ? <Alert variant="success">{message}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <form className="form-stack" onSubmit={registerPasskey}>
            <div className="field-stack">
              <Label htmlFor="passkey-name">Passkey name</Label>
              <Input
                id="passkey-name"
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <fieldset className="passkey-choice">
              <legend>Authenticator</legend>
              <label>
                <input
                  checked={attachment === "platform"}
                  name="attachment"
                  onChange={() => setAttachment("platform")}
                  type="radio"
                />
                This device
              </label>
              <label>
                <input
                  checked={attachment === "cross-platform"}
                  name="attachment"
                  onChange={() => setAttachment("cross-platform")}
                  type="radio"
                />
                Security key or another device
              </label>
            </fieldset>
            <Button
              disabled={pending || name.trim().length === 0}
              type="submit"
            >
              {pending ? "Waiting for passkey…" : "Register passkey"}
            </Button>
          </form>

          <section
            className="passkey-list"
            aria-labelledby="passkey-list-title"
          >
            <div className="section-heading-row">
              <div>
                <h2 id="passkey-list-title">Enrolled passkeys</h2>
                <p>
                  Add a second passkey before removing or replacing the first.
                </p>
              </div>
              <Button
                disabled={pending}
                onClick={verifyPasskey}
                variant="outline"
              >
                <KeyRoundIcon aria-hidden="true" /> Verify passkey
              </Button>
            </div>
            {loading ? <p>Loading passkeys…</p> : null}
            {!loading && passkeys.length === 0 ? (
              <Alert>No passkey is enrolled yet.</Alert>
            ) : null}
            {passkeys.map((entry) => (
              <article className="passkey-entry" key={entry.id}>
                <div>
                  <strong>{entry.name || "Passkey"}</strong>
                  <p>
                    {entry.deviceType === "multiDevice"
                      ? "Synced passkey"
                      : "Device-bound passkey"}
                    {entry.backedUp ? " · Backed up" : ""}
                  </p>
                </div>
                <Button
                  disabled={pending || passkeys.length < 2}
                  onClick={() => void deletePasskey(entry.id)}
                  variant="ghost"
                >
                  Remove
                </Button>
              </article>
            ))}
          </section>
        </CardContent>
      </Card>
      <p className="auth-footnote">
        Email codes bootstrap enrollment only. Once enrolled, sign-in requires a
        passkey.
      </p>
    </main>
  );
}
