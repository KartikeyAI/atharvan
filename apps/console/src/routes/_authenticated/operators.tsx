import {
  PlusIcon,
  RefreshCwIcon,
  ShieldIcon,
  UserCogIcon,
  UserRoundPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
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
  type OperatorRolesResponse,
  useApiResource,
} from "@/lib/api";
import type { OperatorRoleDefinitionEntry } from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/operators")({
  component: OperatorsPage,
});

function OperatorsPage() {
  const operators = useApiResource<OperatorDirectoryResponse>(
    "/api/platform/operators",
  );
  const roles = useApiResource<OperatorRolesResponse>(
    "/api/platform/operator-roles",
  );
  const [showInvite, setShowInvite] = useState(false);
  const activeRoles =
    roles.state.status === "success"
      ? roles.state.data.items.filter((role) => role.isActive)
      : [];

  function reloadAll() {
    operators.reload();
    roles.reload();
  }

  return (
    <OperatorShell title="Operators">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Operator access</h1>
            <p>
              Assign versioned role bundles instead of maintaining raw
              capability lists.
            </p>
          </div>
          <Button
            disabled={activeRoles.length === 0}
            onClick={() => setShowInvite((visible) => !visible)}
            type="button"
          >
            <PlusIcon data-icon="inline-start" /> Invite operator
          </Button>
        </section>

        {roles.state.status === "error" ? (
          <AccessError
            code={roles.state.error.code}
            message={roles.state.error.message}
            reload={reloadAll}
          />
        ) : null}
        {showInvite && activeRoles.length > 0 ? (
          <InviteOperator
            onCreated={() => {
              setShowInvite(false);
              reloadAll();
            }}
            roles={activeRoles}
          />
        ) : null}
        {operators.state.status === "loading" ||
        roles.state.status === "loading" ? (
          <LoadingCard />
        ) : null}
        {operators.state.status === "error" ? (
          <AccessError
            code={operators.state.error.code}
            message={operators.state.error.message}
            reload={reloadAll}
          />
        ) : null}
        {operators.state.status === "success" &&
        roles.state.status === "success" ? (
          <div className="operator-layout">
            <OperatorDirectory
              items={operators.state.data.items}
              onChanged={reloadAll}
              roles={activeRoles}
            />
            <RoleCatalog roles={roles.state.data.items} />
          </div>
        ) : null}
      </div>
    </OperatorShell>
  );
}

function OperatorDirectory({
  items,
  roles,
  onChanged,
}: Readonly<{
  items: OperatorDirectoryResponse["items"];
  roles: ReadonlyArray<OperatorRoleDefinitionEntry>;
  onChanged: () => void;
}>) {
  const [editingOperatorId, setEditingOperatorId] = useState<string | null>(
    null,
  );

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
              <th>Assigned roles</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
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
                    {operator.assignedRoles.map((role) => (
                      <Badge key={role.definitionId}>
                        {role.name} v{role.version}
                      </Badge>
                    ))}
                    {!operator.isSuperAdministrator &&
                    operator.assignedRoles.length === 0 ? (
                      <Badge variant="warning">
                        Legacy capability snapshot
                      </Badge>
                    ) : null}
                  </div>
                  <details className="capability-details">
                    <summary>
                      {operator.effectiveCapabilities.length} effective
                      capabilities
                    </summary>
                    <div className="capability-list">
                      {operator.effectiveCapabilities.map((capability) => (
                        <code key={capability}>{capability}</code>
                      ))}
                    </div>
                  </details>
                </td>
                <td>
                  {operator.status === "active" &&
                  !operator.isSuperAdministrator ? (
                    <Button
                      onClick={() =>
                        setEditingOperatorId((current) =>
                          current === operator.id ? null : operator.id,
                        )
                      }
                      type="button"
                      variant="outline"
                    >
                      <UserCogIcon data-icon="inline-start" /> Manage roles
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editingOperatorId ? (
          <RoleAssignmentEditor
            onCancel={() => setEditingOperatorId(null)}
            onSaved={() => {
              setEditingOperatorId(null);
              onChanged();
            }}
            operator={items.find((item) => item.id === editingOperatorId)!}
            roles={roles}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function InviteOperator({
  roles,
  onCreated,
}: Readonly<{
  roles: ReadonlyArray<OperatorRoleDefinitionEntry>;
  onCreated: () => void;
}>) {
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState("arth");
  const [roleKey, setRoleKey] = useState(roles[0]?.key ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roles.some((role) => role.key === roleKey))
      setRoleKey(roles[0]?.key ?? "");
  }, [roleKey, roles]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/operators/invitations", {
        method: "POST",
        body: JSON.stringify({ email, organizationId, roleKey, reason }),
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

  const selectedRole = roles.find((role) => role.key === roleKey);

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
          <div className="field-stack field-span">
            <Label htmlFor="invite-role">Initial role</Label>
            <select
              className="input"
              id="invite-role"
              onChange={(event) => setRoleKey(event.target.value)}
              required
              value={roleKey}
            >
              {roles.map((role) => (
                <option key={role.definitionId} value={role.key}>
                  {role.name} · version {role.version}
                </option>
              ))}
            </select>
            {selectedRole ? (
              <small className="field-help">{selectedRole.description}</small>
            ) : null}
          </div>
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
            <Button disabled={pending || roleKey.length === 0} type="submit">
              {pending ? "Creating invitation…" : "Create invitation"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RoleAssignmentEditor({
  operator,
  roles,
  onSaved,
  onCancel,
}: Readonly<{
  operator: OperatorDirectoryResponse["items"][number];
  roles: ReadonlyArray<OperatorRoleDefinitionEntry>;
  onSaved: () => void;
  onCancel: () => void;
}>) {
  const [roleKeys, setRoleKeys] = useState<ReadonlyArray<string>>(() =>
    operator.assignedRoles.map((role) => role.key),
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/platform/operators/${operator.id}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roleKeys, reason }),
      });
      onSaved();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The roles were not updated.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="role-editor" onSubmit={submit}>
      <div>
        <h3>Manage roles for {operator.email}</h3>
        <p>
          This replaces the complete active role set in one audited transaction.
        </p>
      </div>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <fieldset className="capability-fieldset">
        <legend>Active role bundles</legend>
        {roles.map((role) => (
          <label className="checkbox-row" key={role.definitionId}>
            <input
              checked={roleKeys.includes(role.key)}
              onChange={(event) =>
                setRoleKeys((current) =>
                  event.target.checked
                    ? [...current, role.key]
                    : current.filter((key) => key !== role.key),
                )
              }
              type="checkbox"
            />
            <span>
              <strong>
                {role.name} · v{role.version}
              </strong>
              <small>{role.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field-stack">
        <Label htmlFor={`role-reason-${operator.id}`}>Audit reason</Label>
        <Input
          id={`role-reason-${operator.id}`}
          minLength={8}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </div>
      <div className="form-actions">
        <Button disabled={pending || roleKeys.length === 0} type="submit">
          {pending ? "Saving roles…" : "Replace roles"}
        </Button>
        <Button
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RoleCatalog({
  roles,
}: Readonly<{ roles: ReadonlyArray<OperatorRoleDefinitionEntry> }>) {
  return (
    <Card>
      <CardHeader>
        <div>
          <h2>Role catalogue</h2>
          <p>
            Definitions are immutable; future changes publish a new version.
          </p>
        </div>
      </CardHeader>
      <CardContent className="role-catalog">
        {roles.map((role) => (
          <article key={role.definitionId}>
            <div>
              <strong>{role.name}</strong>
              <Badge variant={role.isActive ? "success" : "critical"}>
                v{role.version} · {role.isActive ? "active" : "retired"}
              </Badge>
            </div>
            <p>{role.description}</p>
            <details>
              <summary>{role.capabilities.length} capabilities</summary>
              <div className="capability-list">
                {role.capabilities.map((capability) => (
                  <code key={capability}>{capability}</code>
                ))}
              </div>
            </details>
          </article>
        ))}
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
      <span className="spinner" /> Loading canonical access records…
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
          : "Operator access data unavailable"}
      </strong>
      <span>{message}</span>
      {code === "authentication_required" ? (
        <Link
          className="button button-outline"
          search={{ returnTo: undefined }}
          to="/login"
        >
          Go to sign in
        </Link>
      ) : (
        <Button onClick={reload} type="button" variant="outline">
          <RefreshCwIcon data-icon="inline-start" /> Retry
        </Button>
      )}
    </Alert>
  );
}
