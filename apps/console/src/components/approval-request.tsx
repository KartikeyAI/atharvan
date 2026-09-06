import { useRef, useState } from "react";
import type { PlatformApprovalScope } from "@atharvan/domain";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/** Requests approval only; it never executes the protected action. */
export function ApprovalRequest({
  scope,
  reason,
  onRequested,
  disabled = false,
}: {
  readonly scope: PlatformApprovalScope | null;
  readonly reason: string;
  readonly onRequested: (id: string) => void;
  readonly disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  async function request() {
    if (!scope || pending || disabled) return;
    const body = JSON.stringify({ scope, reason });
    if (attempt.current?.body !== body)
      attempt.current = { body, key: crypto.randomUUID() };
    setPending(true);
    setMessage(null);
    try {
      const response = await apiRequest<{ id: string }>(
        "/api/platform/approvals",
        {
          method: "POST",
          body,
          headers: { "idempotency-key": attempt.current.key },
          signal: AbortSignal.timeout(15_000),
        },
      );
      onRequested(response.id);
      setMessage(
        scope.kind === "platform_ownership_transfer"
          ? "Approval requested. The selected successor must accept it under Approvals before you transfer ownership. Requests expire after 30 minutes."
          : "Approval requested. An independent Security Operator must review it under Approvals before you execute this action. Requests expire after 30 minutes.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The approval request could not be confirmed. Retry with the same details.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="section-stack">
      <Button
        type="button"
        variant="outline"
        disabled={
          pending ||
          disabled ||
          !scope ||
          reason.trim().length < 8 ||
          reason.trim().length > 500
        }
        onClick={() => void request()}
      >
        {pending ? "Requesting approval…" : "Request independent approval"}
      </Button>
      {message ? <Alert>{message}</Alert> : null}
    </div>
  );
}
