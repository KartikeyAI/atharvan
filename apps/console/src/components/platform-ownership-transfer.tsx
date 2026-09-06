import { useId, useRef, useState, type FormEvent } from "react";
import {
  capabilityGrantMatches,
  type OperatorDirectoryEntry,
} from "@atharvan/domain";
import { apiRequest, ApiError } from "@/lib/api";
import { ApprovalRequest } from "@/components/approval-request";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
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

/** The successor must explicitly accept the bound request through their own strong session. */
export function PlatformOwnershipTransfer({
  ownerId,
  operators,
}: {
  ownerId: string;
  operators: readonly OperatorDirectoryEntry[];
}) {
  const eligible = operators.filter(
    (operator) =>
      !operator.isSuperAdministrator &&
      operator.status === "active" &&
      operator.membershipDomainAllowed !== false &&
      operator.effectiveCapabilities.some((capability) =>
        capabilityGrantMatches(capability, "platform:security:write"),
      ),
  );
  const [successorId, setSuccessorId] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const id = useId();
  const successor = eligible.find((operator) => operator.id === successorId);
  const expected = `TRANSFER PLATFORM TO ${successor?.email ?? ""}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!successor || pending || confirmation !== expected) return;
    const body = JSON.stringify({
      successorOperatorId: successor.id,
      approvalId,
      confirmation,
      reason: reason.trim(),
    });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/operators/ownership-transfer", {
        method: "POST",
        headers: { "idempotency-key": attempt.current.key },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      window.location.assign("/login");
    } catch (caught) {
      setUncertain(
        !(caught instanceof ApiError) ||
          caught.status >= 500 ||
          caught.code === "command_in_progress",
      );
      setError(
        caught instanceof Error
          ? `${caught.message} Refresh the directory before retrying an uncertain transfer.`
          : "The transfer could not be confirmed. Refresh the directory.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer platform ownership</CardTitle>
        <CardDescription>
          The successor must hold a Security Operator role, have an enrolled
          passkey, and accept the request under Approvals. Both operators will
          be signed out after transfer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {uncertain ? (
          <Alert>
            The transfer result needs confirmation. Refresh the directory before
            starting another transfer.
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Refresh directory
            </Button>
          </Alert>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-successor`}>Successor</FieldLabel>
            <select
              id={`${id}-successor`}
              className="input"
              value={successorId}
              disabled={pending || uncertain}
              onChange={(event) => {
                setSuccessorId(event.target.value);
                setApprovalId("");
                setConfirmation("");
              }}
            >
              <option value="">Select an eligible operator</option>
              {eligible.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.email}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
            <Input
              id={`${id}-reason`}
              value={reason}
              disabled={pending || uncertain}
              onChange={(event) => setReason(event.target.value)}
              minLength={8}
              maxLength={500}
            />
          </Field>
          <ApprovalRequest
            disabled={pending || uncertain}
            scope={
              successor
                ? {
                    kind: "platform_ownership_transfer",
                    currentOwnerOperatorId: ownerId,
                    successorOperatorId: successor.id,
                  }
                : null
            }
            reason={reason}
            onRequested={setApprovalId}
          />
          <Field>
            <FieldLabel htmlFor={`${id}-approval`}>
              Accepted approval ID
            </FieldLabel>
            <Input
              id={`${id}-approval`}
              value={approvalId}
              disabled={pending || uncertain}
              onChange={(event) => setApprovalId(event.target.value)}
            />
          </Field>
          <AlertDialog
            open={open}
            onOpenChange={(value) => {
              if (!pending) setOpen(value);
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={!successor || !approvalId || reason.trim().length < 8}
              >
                Review ownership transfer
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              onEscapeKeyDown={(event) => {
                if (pending) event.preventDefault();
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Transfer Super Administrator authority?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  You will lose platform ownership. The successor must accept
                  this transfer in a separate session. Customer-private access
                  remains excluded.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <form onSubmit={(event) => void submit(event)}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`${id}-confirmation`}>
                      Type {expected}
                    </FieldLabel>
                    <Input
                      id={`${id}-confirmation`}
                      autoComplete="off"
                      required
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      disabled={pending || uncertain}
                    />
                  </Field>
                  {error ? <Alert>{error}</Alert> : null}
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button" disabled={pending}>
                      Cancel
                    </AlertDialogCancel>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={pending || confirmation !== expected}
                    >
                      {pending ? "Transferring…" : "Transfer ownership"}
                    </Button>
                  </AlertDialogFooter>
                </FieldGroup>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
