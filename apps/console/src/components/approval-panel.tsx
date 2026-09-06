import { useId, useRef, useState, type FormEvent } from "react";
import type {
  PlatformApprovalEntry,
  PlatformApprovalPage,
} from "@atharvan/domain";
import { apiRequest, useApiResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function ApprovalPanel() {
  const { state, reload } = useApiResource<PlatformApprovalPage>(
    "/api/platform/approvals",
  );
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <h1>Administrative approvals</h1>
          <p>
            Review exact scopes before authorising sensitive changes. Approval
            does not execute the action.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={reload}>
          Refresh
        </Button>
      </section>
      {state.status === "loading" ? (
        <p role="status">Loading approvals…</p>
      ) : state.status === "error" ? (
        <Alert>{state.error.message}</Alert>
      ) : (
        <div className="section-stack">
          {state.data.truncated ? (
            <Alert>
              Showing the latest 100 requests. Older records remain in Audit.
            </Alert>
          ) : null}
          {state.data.items.length === 0 ? (
            <Card>
              <CardContent>
                No requests are available. Request an approval from the
                ownership-transfer or emergency-access form.
              </CardContent>
            </Card>
          ) : (
            state.data.items.map((entry) => (
              <ApprovalCard key={entry.id} entry={entry} reload={reload} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  entry,
  reload,
}: {
  entry: PlatformApprovalEntry;
  reload: () => void;
}) {
  const [decision, setDecision] = useState<
    "approved" | "rejected" | "revoked" | null
  >(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const id = useId();
  const expired = Date.parse(entry.expiresAt) <= Date.now();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision || pending) return;
    const body = JSON.stringify({ decision, reason });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/platform/approvals/${entry.id}/decision`, {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
        signal: AbortSignal.timeout(15_000),
      });
      setDecision(null);
      reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Decision could not be confirmed. Refresh before retrying.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {entry.scope.kind === "operator_break_glass"
            ? "Emergency access"
            : entry.scope.kind === "platform_ownership_transfer"
              ? "Platform ownership transfer"
              : "Workspace ownership transfer"}
        </CardTitle>
        <CardDescription>
          Requested by {entry.requesterEmail} · expires{" "}
          {new Date(entry.expiresAt).toLocaleString()}
        </CardDescription>
        <Badge>
          {expired && ["pending", "approved"].includes(entry.status)
            ? "expired"
            : entry.status}
        </Badge>
      </CardHeader>
      <CardContent className="section-stack">
        <p>{entry.reason}</p>
        <p>
          Approval ID: <code>{entry.id}</code>
        </p>
        <dl className="session-details">
          {entry.scope.kind === "workspace_ownership_transfer" ? (
            <>
              <div>
                <dt>Workspace</dt>
                <dd>{entry.scope.workspaceId}</dd>
              </div>
              <div>
                <dt>Current owner</dt>
                <dd>{entry.scope.expectedOwnerUserId}</dd>
              </div>
              <div>
                <dt>Successor</dt>
                <dd>{entry.scope.successorUserId}</dd>
              </div>
              <div>
                <dt>Arth revision</dt>
                <dd>{entry.scope.sourceRevision}</dd>
              </div>
            </>
          ) : entry.scope.kind === "platform_ownership_transfer" ? (
            <>
              <div>
                <dt>Current platform owner</dt>
                <dd>{entry.scope.currentOwnerOperatorId}</dd>
              </div>
              <div>
                <dt>Proposed successor</dt>
                <dd>{entry.scope.successorOperatorId}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Operator</dt>
                <dd>{entry.scope.targetOperatorId}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{entry.scope.durationMinutes} minutes</dd>
              </div>
              <div>
                <dt>Incident</dt>
                <dd>{entry.scope.incidentReference}</dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>{entry.scope.capabilities.join(", ")}</dd>
              </div>
            </>
          )}
        </dl>
        {entry.decisionReason ? <p>Decision: {entry.decisionReason}</p> : null}
        <AlertDialog
          open={decision !== null}
          onOpenChange={(open) => {
            if (!open && !pending) setDecision(null);
          }}
        >
          <div className="session-actions">
            {!expired
              ? entry.allowedDecisions.map((choice) => (
                  <AlertDialogTrigger key={choice} asChild>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setDecision(choice);
                        setReason("");
                        setError(null);
                      }}
                    >
                      {choice === "approved"
                        ? "Approve"
                        : choice === "rejected"
                          ? "Reject"
                          : "Revoke"}
                    </Button>
                  </AlertDialogTrigger>
                ))
              : null}
          </div>
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {decision === "approved"
                  ? "Approve this exact scope?"
                  : decision === "rejected"
                    ? "Reject this request?"
                    : "Revoke this approval?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {decision === "approved"
                  ? "The requester may execute this scope once before expiry. Changed ownership, revision, target, capabilities or duration require a new approval."
                  : "This request will no longer authorise the action. A new request will be needed."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form onSubmit={(event) => void submit(event)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={id}>Decision reason</FieldLabel>
                  <Input
                    id={id}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                    minLength={8}
                    maxLength={500}
                    disabled={pending}
                  />
                </Field>
                {error ? <Alert>{error}</Alert> : null}
                <AlertDialogFooter>
                  <AlertDialogCancel type="button" disabled={pending}>
                    Cancel
                  </AlertDialogCancel>
                  <Button
                    type="submit"
                    disabled={pending || reason.trim().length < 8}
                  >
                    {pending ? "Recording…" : "Confirm decision"}
                  </Button>
                </AlertDialogFooter>
              </FieldGroup>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
