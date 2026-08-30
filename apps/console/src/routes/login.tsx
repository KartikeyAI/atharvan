import { BlocksIcon, KeyRoundIcon, MailIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/api";
import { resolveConsoleSession, sanitizeReturnTo } from "@/lib/session";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo:
      search.returnTo === undefined
        ? undefined
        : sanitizeReturnTo(search.returnTo),
  }),
  beforeLoad: async ({ search }) => {
    const session = await resolveConsoleSession();
    if (session.authenticated) {
      throw redirect({ href: sanitizeReturnTo(search.returnTo) });
    }
  },
  component: OperatorLogin,
});

function OperatorLogin() {
  const returnTo = sanitizeReturnTo(Route.useSearch().returnTo);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        body: JSON.stringify({ email, type: "sign-in" }),
      });
      setStep("otp");
      setMessage(
        "If this address is eligible, a six-digit code has been sent.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Verification is unavailable.",
      );
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/auth/sign-in/email-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp }),
      });
      window.location.assign(returnTo);
    } catch {
      setError(
        "The code is invalid or expired. Request a new code and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <BlocksIcon aria-hidden="true" /> Atharvan
      </div>
      <Card className="auth-card">
        <CardHeader>
          <div className="auth-icon">
            {step === "email" ? <MailIcon /> : <KeyRoundIcon />}
          </div>
          <div>
            <h1>
              {step === "email"
                ? "Operator sign in"
                : "Enter verification code"}
            </h1>
            <p>
              {step === "email"
                ? "Access is invitation-only and restricted to approved organization domains."
                : `Use the code sent to ${email}.`}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {message ? <Alert variant="success">{message}</Alert> : null}
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {step === "email" ? (
            <form className="form-stack" onSubmit={requestCode}>
              <div className="field-stack">
                <Label htmlFor="operator-email">Work email</Label>
                <Input
                  autoComplete="email"
                  id="operator-email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@organization.com"
                  required
                  type="email"
                  value={email}
                />
              </div>
              <Button disabled={pending} type="submit">
                {pending ? "Requesting code…" : "Continue with email"}
              </Button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={verifyCode}>
              <div className="field-stack">
                <Label htmlFor="operator-code">Six-digit code</Label>
                <Input
                  autoComplete="one-time-code"
                  id="operator-code"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, ""))
                  }
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                  value={otp}
                />
              </div>
              <Button disabled={pending || otp.length !== 6} type="submit">
                {pending ? "Verifying…" : "Verify and sign in"}
              </Button>
              <Button
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setMessage(null);
                }}
                type="button"
                variant="ghost"
              >
                Use a different email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <p className="auth-footnote">
        Operator actions are authorization-checked and immutably audited.
      </p>
    </main>
  );
}
