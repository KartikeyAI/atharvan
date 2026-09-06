import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { OperatorSessionInventory } from "@atharvan/domain";
import { apiRequest, ApiError } from "../lib/api";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";

/** Self-service session controls never receive or submit bearer tokens. */
export function OperatorSessionsPanel() {
  const [data, setData] = useState<OperatorSessionInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const request = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    setData(null);
    setSelected(null);
    try {
      const inventory = await apiRequest<OperatorSessionInventory>(
        "/api/platform/authentication/sessions",
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
          cache: "no-store",
        },
      );
      if (!controller.signal.aborted) setData(inventory);
    } catch {
      if (!controller.signal.aborted)
        setError(
          "Sessions could not be loaded. Refresh to try again, or sign in again if your session has ended.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);

  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected === null || pending) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<{ outcome: "updated" | "unchanged" }>(
        `/api/platform/authentication/sessions/${encodeURIComponent(selected)}/revoke`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        },
      );
      if (controller.signal.aborted) return;
      setNotice(
        result.outcome === "updated"
          ? "Session revoked. Requests already in progress may still finish."
          : "No active session was changed. The session may have expired or already been revoked.",
      );
      setPending(false);
      await reload();
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Revocation could not be confirmed. Refresh the inventory before trying again.",
        );
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <div className="page session-page">
      <section className="page-heading">
        <div>
          <h1>Your sessions</h1>
          <p>Review active sign-ins and revoke sessions you no longer use.</p>
        </div>
        <Button
          variant="outline"
          disabled={loading || pending}
          onClick={() => {
            setNotice(null);
            void reload();
          }}
        >
          Refresh sessions
        </Button>
      </section>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Session security</CardTitle>
            <CardDescription>
              Only your sessions are shown. Revoking another session requires
              passkey verification within the last five minutes. Use Sign out to
              end this session.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <a href="/security/passkeys">Manage passkeys</a>
        </CardContent>
      </Card>
      {error && <Alert variant="destructive">{error}</Alert>}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p role="status">Loading your sessions…</p>
      ) : (
        data && (
          <>
            <p className="muted-copy">
              Snapshot:{" "}
              <time dateTime={data.observedAt}>
                {new Date(data.observedAt).toUTCString()}
              </time>
              . Refresh to check for changes.
            </p>
            {data.truncated && (
              <Alert>
                Showing your current session and up to 99 recent sessions.
                Revoke unused sessions and refresh to review older ones.
              </Alert>
            )}
            {data.items.length === 0 ? (
              <p>
                No active sessions are available in this snapshot.{" "}
                <a href="/login">Sign in again</a>.
              </p>
            ) : (
              <section aria-label="Active sessions" className="session-list">
                {data.items.map((entry) => (
                  <Card key={entry.id}>
                    <CardHeader>
                      <div>
                        <CardTitle>
                          {entry.current ? "Current session" : "Other session"}
                        </CardTitle>
                        <CardDescription>
                          {entry.authenticationMethod === "passkey"
                            ? "Passkey sign-in"
                            : "Email verification session"}
                        </CardDescription>
                      </div>
                      <Badge variant={entry.current ? "success" : "neutral"}>
                        {entry.current ? "This session" : "Active at snapshot"}
                      </Badge>
                    </CardHeader>
                    <CardContent>
                      <dl className="session-details">
                        <div>
                          <dt>Browser information (reported by device)</dt>
                          <dd>{entry.userAgent || "Not available"}</dd>
                        </div>
                        <div>
                          <dt>IP address</dt>
                          <dd>{entry.ipAddress || "Not available"}</dd>
                        </div>
                        <div>
                          <dt>Started</dt>
                          <dd>
                            <time dateTime={entry.createdAt}>
                              {new Date(entry.createdAt).toUTCString()}
                            </time>
                          </dd>
                        </div>
                        <div>
                          <dt>Expires</dt>
                          <dd>
                            <time dateTime={entry.expiresAt}>
                              {new Date(entry.expiresAt).toUTCString()}
                            </time>
                          </dd>
                        </div>
                      </dl>
                      {!entry.current &&
                        (selected === entry.id ? (
                          <form
                            className="session-revoke-form"
                            onSubmit={revoke}
                          >
                            <label htmlFor="session-revoke-reason">
                              Reason for revocation
                            </label>
                            <Input
                              id="session-revoke-reason"
                              required
                              minLength={8}
                              maxLength={500}
                              value={reason}
                              onChange={(event) =>
                                setReason(event.target.value)
                              }
                              disabled={pending}
                              autoFocus
                            />
                            <p>
                              This ends the selected session. Reopening it
                              requires signing in again.
                            </p>
                            <div className="session-actions">
                              <Button
                                variant="destructive"
                                type="submit"
                                disabled={pending}
                              >
                                {pending ? "Revoking…" : "Confirm revocation"}
                              </Button>
                              <Button
                                variant="outline"
                                type="button"
                                disabled={pending}
                                onClick={() => setSelected(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              setSelected(entry.id);
                              setReason("");
                              setNotice(null);
                              setError(null);
                            }}
                          >
                            Revoke session
                          </Button>
                        ))}
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}
