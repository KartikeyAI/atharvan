import { useId, useRef, useState, type FormEvent } from "react";
import type {
  OperatorDirectoryEntry,
  OperatorLifecycleAction,
  OperatorLifecycleResult,
} from "@atharvan/domain";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
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

/** Confirmation stays open on failure; retries reuse their original command identity. */
export function OperatorLifecycleControls({
  operator,
  onChanged,
}: {
  readonly operator: OperatorDirectoryEntry;
  readonly onChanged: () => void;
}) {
  const [action, setAction] = useState<OperatorLifecycleAction | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const id = useId();
  if (operator.isSuperAdministrator || operator.status === "deactivated")
    return null;
  const actions: OperatorLifecycleAction[] =
    operator.status === "active"
      ? ["suspend", "deactivate"]
      : operator.status === "suspended"
        ? ["restore", "deactivate"]
        : ["deactivate"];
  const expected = `${action?.toUpperCase()} ${operator.email}`;

  function reset() {
    setReason("");
    setConfirmation("");
    setError(null);
    setUncertain(false);
    attempt.current = null;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || pending || confirmation !== expected) return;
    const body = JSON.stringify({
      action,
      expectedStatus: operator.status,
      reason: reason.trim(),
      confirmation,
    });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      await apiRequest<OperatorLifecycleResult>(
        `/api/platform/operators/${encodeURIComponent(operator.id)}/status`,
        {
          method: "POST",
          headers: { "idempotency-key": attempt.current.key },
          body,
          signal: AbortSignal.timeout(15_000),
        },
      );
      setAction(null);
      reset();
      onChanged();
    } catch (caught) {
      const ambiguous = !(caught instanceof ApiError) || caught.status >= 500;
      setUncertain(ambiguous);
      setError(
        ambiguous
          ? "The result is uncertain. Retry this same command or close and refresh the directory before making another change."
          : caught.message,
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setAction(null);
          reset();
          if (uncertain) onChanged();
        }
      }}
    >
      <div className="session-actions">
        {actions.map((choice) => (
          <AlertDialogTrigger key={choice} asChild>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setAction(choice);
              }}
            >
              {choice === "restore"
                ? "Restore access"
                : choice === "suspend"
                  ? "Suspend"
                  : "Deactivate"}
            </Button>
          </AlertDialogTrigger>
        ))}
      </div>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action === "restore"
              ? "Restore operator access"
              : action === "suspend"
                ? "Suspend operator access"
                : "Deactivate operator"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action === "restore"
              ? "Requires an allowed email domain and an enrolled passkey. The operator must sign in again."
              : action === "suspend"
                ? "Ends this operator's sessions and emergency grants. Access can be restored later."
                : "Permanently closes this operator account and ends its sessions, pending invitations and emergency grants. This action cannot be reversed here."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={(event) => void submit(event)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
              <Input
                id={`${id}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={8}
                maxLength={500}
                required
                disabled={pending || uncertain}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-confirm`}>
                Type {expected} to confirm
              </FieldLabel>
              <Input
                id={`${id}-confirm`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                required
                disabled={pending || uncertain}
              />
            </Field>
            {error ? <Alert role="alert">{error}</Alert> : null}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pending}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="submit"
                variant={action === "restore" ? "default" : "destructive"}
                disabled={
                  pending ||
                  confirmation !== expected ||
                  reason.trim().length < 8
                }
              >
                {pending
                  ? "Applying change…"
                  : uncertain
                    ? "Retry same command"
                    : "Confirm change"}
              </Button>
            </AlertDialogFooter>
          </FieldGroup>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
