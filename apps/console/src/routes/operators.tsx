import {
  PlusIcon,
  RefreshCwIcon,
  ShieldIcon,
  UserRoundPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { OperatorShell } from "@/components/operator-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  apiRequest,
  type OperatorDirectoryResponse,
  useApiResource,
} from "@/lib/api";
import { delegablePlatformCapabilities } from "@atharvan/domain";

export const Route = createFileRoute("/operators")({
  component: OperatorsPage,
});

const capabilityLabels: Record<
  (typeof delegablePlatformCapabilities)[number],
  string
> = {
  "platform:overview:read": "View platform overview",
  "platform:operators:read": "View operators",
  "platform:operators:invite": "Invite operators",
  "platform:membership-domains:read": "View email domains",
};

function OperatorsPage() {
  const { state, reload } = useApiResource<OperatorDirectoryResponse>(
    "/api/platform/operators",
  );
  const [showInvite, setShowInvite] = useState(false);

  return (
    <OperatorShell title="Operators">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Operator access</h1>
            <p>
              Invite internal staff and inspect their effective platform
              authority.
            </p>
          </div>
          <Button
            onClick={() => setShowInvite((visible) => !visible)}
            type="button"
          >
            <PlusIcon aria-hidden="true" /> Invite operator
          </Button>
        </section>

        {showInvite ? (
          <InviteOperator
            onCreated={() => {
              setShowInvite(false);
              reload();
            }}
          />
        ) : null}

        {state.status === "loading" ? <LoadingCard /> : null}
        {state.status === "error" ? (
          <AccessError
            code={state.error.code}
            message={state.error.message}
            reload={reload}
          />
        ) : null}
        {state.status === "success" ? (
          <OperatorDirectory items={state.data.items} />
        ) : null}
      </div>
    </OperatorShell>
  );
}

function OperatorDirectory({
  items,
}: Readonly<{ items: OperatorDirectoryResponse["items"] }>) {
  if (items.length === 0) {
    return (
      <Card className="empty-card">
        <UsersIcon aria-hidden="true" />
        <h2>No operators found</h2>
        <p>The directory is empty in the canonical database.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="table-card-header">
        <div>
          <h2>Operator directory</h2>
          <p>
            {items.length} canonical account{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <Badge>
          {items.filter((item) => item.status === "active").length} active
        </Badge>
      </CardHeader>
      <CardContent className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Operator</th>
              <th>Status</th>
              <th>Authority</th>
              <th>Activated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((operator) => (
              <tr key={operator.id}>
                <td>
                  <strong>{operator.email}</strong>
                  <span>{operator.emailDomain}</span>
                </td>
                <td>
                  <StatusBadge status={operator.status} />
                </td>
                <td>
                  <div className="capability-list">
                    {operator.isSuperAdministrator ? (
                      <Badge variant="warning">
                        <ShieldIcon aria-hidden="true" /> Super Administrator
                      </Badge>
                    ) : null}
                    {operator.effectiveCapabilities.map((capability) => (
                      <code key={capability}>{capability}</code>
                    ))}
                  </div>
                </td>
                <td>
                  {operator.activatedAt
                    ? new Date(operator.activatedAt).toLocaleDateString()
                    : "Not active"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function InviteOperator({ onCreated }: Readonly<{ onCreated: () => void }>) {
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState("arth");
  const [reason, setReason] = useState("");
  const [capabilities, setCapabilities] = useState<ReadonlyArray<string>>([
    "platform:overview:read",
    "platform:operators:read",
    "platform:membership-domains:read",
  ]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/platform/operators/invitations", {
        method: "POST",
        body: JSON.stringify({
          email,
          organizationId,
          intendedCapabilities: capabilities,
          reason,
        }),
      });
      onCreated();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The invitation was not created.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="action-card">
      <CardHeader>
        <div className="section-icon">
          <UserRoundPlusIcon aria-hidden="true" />
        </div>
        <div>
          <h2>Invite an operator</h2>
          <p>The address must match an active organization-domain rule.</p>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="admin-form" onSubmit={submit}>
          <div className="field-stack">
            <Label htmlFor="invite-email">Work email</Label>
            <Input
              id="invite-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="field-stack">
            <Label htmlFor="organization-id">Organization ID</Label>
            <Input
              id="organization-id"
              onChange={(event) => setOrganizationId(event.target.value)}
              required
              value={organizationId}
            />
          </div>
          <fieldset className="capability-fieldset">
            <legend>Platform capabilities</legend>
            {delegablePlatformCapabilities.map((capability) => (
              <label className="checkbox-row" key={capability}>
                <input
                  checked={capabilities.includes(capability)}
                  onChange={(event) =>
                    setCapabilities((current) =>
                      event.target.checked
                        ? [...current, capability]
                        : current.filter((entry) => entry !== capability),
                    )
                  }
                  type="checkbox"
                />
                <span>
                  <strong>{capabilityLabels[capability]}</strong>
                  <code>{capability}</code>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field-stack field-span">
            <Label htmlFor="invite-reason">Audit reason</Label>
            <Input
              id="invite-reason"
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why this operator needs access"
              required
              value={reason}
            />
          </div>
          <div className="form-actions field-span">
            <Button
              disabled={pending || capabilities.length === 0}
              type="submit"
            >
              {pending ? "Creating invitation…" : "Create invitation"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: Readonly<{ status: string }>) {
  const variant =
    status === "active"
      ? "success"
      : status === "suspended" || status === "deactivated"
        ? "critical"
        : "warning";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

function LoadingCard() {
  return (
    <Card className="loading-card">
      <span className="spinner" /> Loading canonical operator records…
    </Card>
  );
}

function AccessError({
  code,
  message,
  reload,
}: Readonly<{ code: string; message: string; reload: () => void }>) {
  return (
    <Alert variant="destructive">
      <strong>
        {code === "authentication_required"
          ? "Sign in required"
          : "Operator data unavailable"}
      </strong>
      <span>{message}</span>
      {code === "authentication_required" ? (
        <Link className="button button-outline" to="/login">
          Go to sign in
        </Link>
      ) : (
        <Button onClick={reload} type="button" variant="outline">
          <RefreshCwIcon /> Retry
        </Button>
      )}
    </Alert>
  );
}
