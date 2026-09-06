import { useId, useRef, useState, type FormEvent } from "react";
import type {
  EmailDeliveryEntry,
  EmailDeliveryPage,
  EmailRecipientSuppressionEntry,
} from "@atharvan/domain";
import { ApiError, apiRequest, useApiResource } from "@/lib/api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const labels: Record<EmailDeliveryEntry["state"], string> = {
  pending: "Waiting",
  leased: "Sending",
  accepted: "Accepted by email provider",
  delivered: "Delivered to receiving server",
  bounced: "Bounced",
  complained: "Spam complaint received",
  expired: "Expired",
  cancelled: "Cancelled",
  dead_letter: "Needs attention",
};
const reasons: Record<string, string> = {
  queued: "Waiting for delivery.",
  delivery_started: "A delivery worker is processing this message.",
  provider_accepted:
    "The provider accepted this message. Inbox delivery has not been confirmed.",
  provider_sent: "The provider began delivery to the recipient.",
  provider_delivered:
    "The recipient's mail server accepted this message. Inbox placement is not guaranteed.",
  provider_delivery_delayed:
    "The receiving server temporarily delayed this message.",
  provider_bounced:
    "The receiving server permanently rejected this message. Future delivery to this recipient is suppressed.",
  provider_failed:
    "The provider could not send this message. Future delivery to this recipient is suppressed.",
  provider_suppressed:
    "The provider suppressed this recipient. Future delivery remains blocked.",
  provider_complained:
    "The recipient reported this message as spam. Future delivery to this recipient is suppressed.",
  recipient_suppressed:
    "Provider feedback blocks further transactional email to this recipient.",
  challenge_expired: "This code expired. Request a new code from sign-in.",
  challenge_no_longer_eligible:
    "The code was replaced, consumed, or the operator is no longer eligible.",
  sender_changed:
    "Sender configuration changed. Request a new code after reviewing the configuration.",
  payload_unreadable:
    "The encrypted message could not be opened. Review key changes and request a new code.",
  provider_rejected:
    "The provider rejected the message. Review sender configuration and provider credentials.",
  retry_exhausted:
    "The delivery attempt limit was reached. Resolve the provider issue and request a new code.",
  delivery_uncertain:
    "The last attempt could not be confirmed. A retry will reuse the same delivery identity.",
  operator_cancelled: "An operator cancelled this pending message.",
  operator_retry_requested:
    "An operator requested an earlier retry. The original expiry and attempt limit still apply.",
};

export function EmailDeliveriesPanel() {
  const { state, reload } = useApiResource<EmailDeliveryPage>(
    "/api/platform/email-deliveries",
  );
  return (
    <div className="page">
      <section className="page-heading">
        <div>
          <h1>Verification email delivery</h1>
          <p>
            Inspect sign-in email processing without revealing verification
            codes or message content.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={reload}>
          Refresh
        </Button>
      </section>
      {state.status === "loading" ? (
        <p role="status">Loading delivery records…</p>
      ) : state.status === "error" ? (
        <Alert>{state.error.message}</Alert>
      ) : (
        <div className="section-stack">
          {!state.data.providerConfigured ? (
            <Alert>
              Email delivery is not configured. Pending messages retain their
              original expiry; no delivery attempts are made.
            </Alert>
          ) : null}
          {state.data.providerConfigured && !state.data.feedbackConfigured ? (
            <Alert>
              Email feedback is not configured. Provider acceptance can be
              shown, but delivery, bounce, and complaint outcomes remain
              unknown.
            </Alert>
          ) : null}
          <p>
            Snapshot: {new Date(state.data.observedAt).toLocaleString()}.
            Refresh for current progress.
          </p>
          {state.data.truncated ? (
            <Alert>
              Showing the latest 100 records. Older delivery events remain in
              Audit.
            </Alert>
          ) : null}
          <section
            className="section-stack"
            aria-labelledby="active-suppressions"
          >
            <div>
              <h2 id="active-suppressions">Blocked email recipients</h2>
              <p>
                Provider bounce, failure, suppression, and complaint evidence
                blocks future transactional email without exposing addresses.
              </p>
            </div>
            {state.data.suppressionsTruncated ? (
              <Alert>Showing the latest 100 active recipient blocks.</Alert>
            ) : null}
            {state.data.activeSuppressions.length === 0 ? (
              <Card>
                <CardContent>
                  No email recipients are currently blocked.
                </CardContent>
              </Card>
            ) : (
              state.data.activeSuppressions.map((suppression) => (
                <SuppressionCard
                  key={suppression.id}
                  suppression={suppression}
                  canManage={state.data.canManage}
                  reload={reload}
                />
              ))
            )}
          </section>
          {state.data.items.length === 0 ? (
            <Card>
              <CardContent>
                No verification email requests have been queued.
              </CardContent>
            </Card>
          ) : (
            state.data.items.map((entry) => (
              <DeliveryCard
                key={entry.id}
                entry={entry}
                canManage={state.data.canManage}
                configured={state.data.providerConfigured}
                reload={reload}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SuppressionCard({
  suppression,
  canManage,
  reload,
}: {
  suppression: EmailRecipientSuppressionEntry;
  canManage: boolean;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const id = useId();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body = JSON.stringify({ reason: reason.trim() });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      await apiRequest(
        `/api/platform/email-recipient-suppressions/${suppression.id}/restore`,
        {
          method: "POST",
          body,
          headers: { "idempotency-key": attempt.current.key },
          signal: AbortSignal.timeout(15_000),
        },
      );
      setOpen(false);
      reload();
    } catch (caught) {
      const ambiguous =
        !(caught instanceof ApiError) ||
        caught.status >= 500 ||
        caught.code === "command_in_progress";
      setUncertain(ambiguous);
      setError(
        ambiguous
          ? "The result could not be confirmed. Retry the same request or close and refresh the records."
          : caught.message,
      );
    } finally {
      setPending(false);
    }
  }
  const sourceLabel =
    suppression.source.kind === "verification"
      ? "Verification email"
      : "Operational alert";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{sourceLabel} recipient blocked</CardTitle>
        <CardDescription>
          {reasons[`provider_${suppression.reason}`] ??
            "Provider feedback blocks future transactional email."}
        </CardDescription>
        <Badge>{suppression.reason}</Badge>
      </CardHeader>
      <CardContent className="section-stack">
        <dl className="session-details">
          <div>
            <dt>Blocked</dt>
            <dd>{new Date(suppression.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Source delivery</dt>
            <dd>{suppression.source.deliveryId}</dd>
          </div>
          <div>
            <dt>Suppression</dt>
            <dd>{suppression.id}</dd>
          </div>
        </dl>
        {canManage ? (
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              if (!pending) {
                setOpen(next);
                if (next) {
                  setReason("");
                  setUncertain(false);
                  setError(null);
                  attempt.current = null;
                } else if (uncertain) reload();
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline">
                Restore future delivery
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onEscapeKeyDown={(event) => {
                if (pending) event.preventDefault();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>Restore this recipient?</AlertDialogTitle>
                <AlertDialogDescription>
                  Future transactional email may be sent again. Existing
                  messages are not retried, and the original provider evidence
                  remains in Audit. Verify that the mailbox issue or complaint
                  has been resolved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <form onSubmit={(event) => void submit(event)}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={id}>Restoration reason</FieldLabel>
                    <Input
                      id={id}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                      minLength={8}
                      maxLength={500}
                      disabled={pending || uncertain}
                    />
                  </Field>
                  {error ? <Alert>{error}</Alert> : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button" disabled={pending}>
                      Close
                    </AlertDialogCancel>
                    <Button
                      type="submit"
                      disabled={pending || reason.trim().length < 8}
                    >
                      {pending ? "Recording…" : "Restore future delivery"}
                    </Button>
                  </AlertDialogFooter>
                </FieldGroup>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeliveryCard({
  entry,
  canManage,
  configured,
  reload,
}: {
  entry: EmailDeliveryEntry;
  canManage: boolean;
  configured: boolean;
  reload: () => void;
}) {
  const [action, setAction] = useState<"retry" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const id = useId();
  const actionable =
    canManage &&
    entry.state === "pending" &&
    Date.parse(entry.expiresAt) > Date.now() &&
    entry.attempts < 5;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || pending) return;
    const body = JSON.stringify({ action, reason: reason.trim() });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/platform/email-deliveries/${entry.id}`, {
        method: "POST",
        body,
        headers: { "idempotency-key": attempt.current.key },
        signal: AbortSignal.timeout(15_000),
      });
      setAction(null);
      reload();
    } catch (caught) {
      const ambiguous =
        !(caught instanceof ApiError) ||
        caught.status >= 500 ||
        caught.code === "command_in_progress";
      setUncertain(ambiguous);
      setError(
        ambiguous
          ? "The result could not be confirmed. Retry the same request or close and refresh the records."
          : caught.message,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels[entry.state]}</CardTitle>
        <CardDescription>
          {reasons[entry.reason] ??
            "Review the correlated delivery events in Audit."}
        </CardDescription>
        <Badge>{entry.attempts} of 5 attempts</Badge>
      </CardHeader>
      <CardContent className="section-stack">
        <dl className="session-details">
          <div>
            <dt>Delivery</dt>
            <dd>{entry.id}</dd>
          </div>
          <div>
            <dt>Operator</dt>
            <dd>{entry.operatorId}</dd>
          </div>
          <div>
            <dt>Requested</dt>
            <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Code expires</dt>
            <dd>{new Date(entry.expiresAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Template</dt>
            <dd>
              {entry.templateVersion} · {entry.templateLocale.toUpperCase()}
            </dd>
          </div>
          {entry.state === "pending" ? (
            <div>
              <dt>Next attempt after</dt>
              <dd>{new Date(entry.nextAttemptAt).toLocaleString()}</dd>
            </div>
          ) : null}
          <div>
            <dt>Audit correlation</dt>
            <dd>{entry.correlationId}</dd>
          </div>
        </dl>
        <AlertDialog
          open={action !== null}
          onOpenChange={(open) => {
            if (!open && !pending) {
              setAction(null);
              if (uncertain) reload();
            }
          }}
        >
          {actionable ? (
            <div className="session-actions">
              {(["retry", "cancel"] as const).map((choice) => (
                <AlertDialogTrigger key={choice} asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={choice === "retry" && !configured}
                    onClick={() => {
                      setAction(choice);
                      setReason("");
                      setUncertain(false);
                      setError(null);
                      attempt.current = null;
                    }}
                  >
                    {choice === "retry" ? "Retry now" : "Cancel pending email"}
                  </Button>
                </AlertDialogTrigger>
              ))}
            </div>
          ) : null}
          <AlertDialogContent
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {action === "retry"
                  ? "Retry this delivery?"
                  : "Cancel this pending email?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {action === "retry"
                  ? "This brings the next attempt forward. It does not reset the expiry or attempt limit."
                  : "Cancellation is available only before a worker claims the message. It cannot recall email already sent or invalidate a code already issued."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form onSubmit={(event) => void submit(event)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={id}>Reason</FieldLabel>
                  <Input
                    id={id}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                    minLength={8}
                    maxLength={500}
                    disabled={pending || uncertain}
                  />
                </Field>
                {error ? <Alert>{error}</Alert> : null}
                <AlertDialogFooter>
                  <AlertDialogCancel type="button" disabled={pending}>
                    Close
                  </AlertDialogCancel>
                  <Button
                    type="submit"
                    disabled={pending || reason.trim().length < 8}
                  >
                    {pending ? "Recording…" : "Confirm"}
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
