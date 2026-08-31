import {
  KeyRoundIcon,
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
  type OperatorBreakGlassGrantsResponse,
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
  const breakGlassGrants = useApiResource<OperatorBreakGlassGrantsResponse>(
    "/api/platform/operator-break-glass-grants",
  );
  const [showInvite, setShowInvite] = useState(false);
  const activeRoles =
    roles.state.status === "success"
      ? roles.state.data.items.filter((role) => role.isActive)
      : [];

  function reloadAll() {
    operators.reload();
    roles.reload();
    breakGlassGrants.reload();
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
        {breakGlassGrants.state.status === "error" ? (
          <AccessError
            code={breakGlassGrants.state.error.code}
            message={breakGlassGrants.state.error.message}
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
        roles.state.status === "loading" ||
        breakGlassGrants.state.status === "loading" ? (
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
        roles.state.status === "success" &&
        breakGlassGrants.state.status === "success" ? (
          <>
            <div className="operator-layout">
              <OperatorDirectory
                items={operators.state.data.items}
                onChanged={reloadAll}
                roles={activeRoles}
              />
              <RoleCatalog roles={roles.state.data.items} />
            </div>
            <BreakGlassPanel
              grants={breakGlassGrants.state.data.items}
              onChanged={reloadAll}
              operators={operators.state.data.items}
              roles={activeRoles}
            />
          </>
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

function BreakGlassPanel({
  grants,
  operators,
  roles,
  onChanged,
}: Readonly<{
  grants: OperatorBreakGlassGrantsResponse["items"];
  operators: OperatorDirectoryResponse["items"];
  roles: ReadonlyArray<OperatorRoleDefinitionEntry>;
  onChanged: () => void;
}>) {
  const eligibleOperators = operators.filter(
    (operator) =>
      operator.status === "active" && !operator.isSuperAdministrator,
  );
  const capabilities = [
    ...new Set(roles.flatMap((role) => role.capabilities)),
  ].sort();

  return (
    <section className="section-stack">
      <div className="section-heading">
        <div>
          <h2>Break-glass access</h2>
          <p>
            Time-bound elevation requires approval, expires automatically, and
            stays open until a terminal review is recorded.
          </p>
        </div>
        <Badge
          variant={
            grants.some((grant) => grant.status === "active")
              ? "critical"
              : "success"
          }
        >
          {grants.filter((grant) => grant.status === "active").length} active
        </Badge>
      </div>
      {eligibleOperators.length > 0 && capabilities.length > 0 ? (
        <CreateBreakGlassGrant
          capabilities={capabilities}
          onCreated={onChanged}
          operators={eligibleOperators}
        />
      ) : (
        <Alert>
          An active non-super operator and an active role catalogue are required
          before temporary elevation can be issued.
        </Alert>
      )}
      <Card>
        <CardHeader>
          <div className="section-icon">
            <KeyRoundIcon aria-hidden="true" />
          </div>
          <div>
            <h2>Grant ledger</h2>
            <p>
              Immutable issuance evidence with explicit revocation and review.
            </p>
          </div>
        </CardHeader>
        <CardContent className="table-wrap">
          {grants.length === 0 ? (
            <div className="empty-card">
              <p>No break-glass grants have been issued.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Operator and authority</th>
                  <th>Window</th>
                  <th>Evidence</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.id}>
                    <td>
                      <strong>{grant.operatorEmail}</strong>
                      <div className="capability-list">
                        {grant.capabilities.map((capability) => (
                          <code key={capability}>{capability}</code>
                        ))}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={grant.status} />
                      <span>{formatDate(grant.grantedAt)}</span>
                      <span>Expires {formatDate(grant.expiresAt)}</span>
                    </td>
                    <td>
                      <strong>{grant.incidentReference}</strong>
                      <span>Approval: {grant.approvalReference}</span>
                      <span>Issued by {grant.grantedByEmail}</span>
                      <details>
                        <summary>Audit reason</summary>
                        <p>{grant.reason}</p>
                      </details>
                    </td>
                    <td>
                      {grant.review ? (
                        <div>
                          <Badge
                            variant={
                              grant.review.outcome === "approved"
                                ? "success"
                                : "critical"
                            }
                          >
                            {grant.review.outcome}
                          </Badge>
                          <span>{grant.review.summary}</span>
                          <span>By {grant.review.reviewerEmail}</span>
                        </div>
                      ) : (
                        <BreakGlassGrantAction
                          grant={grant}
                          onChanged={onChanged}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function CreateBreakGlassGrant({
  capabilities,
  operators,
  onCreated,
}: Readonly<{
  capabilities: ReadonlyArray<string>;
  operators: OperatorDirectoryResponse["items"];
  onCreated: () => void;
}>) {
  const [targetOperatorId, setTargetOperatorId] = useState(
    operators[0]?.id ?? "",
  );
  const [selectedCapabilities, setSelectedCapabilities] = useState<
    ReadonlyArray<string>
  >([]);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [incidentReference, setIncidentReference] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expectedConfirmation = `GRANT BREAK-GLASS TO ${targetOperatorId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(
        `/api/platform/operators/${targetOperatorId}/break-glass-grants`,
        {
          method: "POST",
          body: JSON.stringify({
            capabilities: selectedCapabilities,
            durationMinutes,
            incidentReference,
            approvalReference,
            reason,
            confirmation,
          }),
        },
      );
      setSelectedCapabilities([]);
      setIncidentReference("");
      setApprovalReference("");
      setReason("");
      setConfirmation("");
      onCreated();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Temporary authority was not issued.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="action-card">
      <CardHeader>
        <div className="section-icon">
          <KeyRoundIcon aria-hidden="true" />
        </div>
        <div>
          <h2>Issue temporary authority</h2>
          <p>Use only for a live operational need with recorded approval.</p>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="admin-form" onSubmit={submit}>
          <div className="field-stack">
            <Label htmlFor="break-glass-operator">Operator</Label>
            <select
              className="input"
              id="break-glass-operator"
              onChange={(event) => {
                setTargetOperatorId(event.target.value);
                setConfirmation("");
              }}
              value={targetOperatorId}
            >
              {operators.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.email}
                </option>
              ))}
            </select>
          </div>
          <div className="field-stack">
            <Label htmlFor="break-glass-duration">Duration</Label>
            <select
              className="input"
              id="break-glass-duration"
              onChange={(event) =>
                setDurationMinutes(Number(event.target.value))
              }
              value={durationMinutes}
            >
              {[5, 15, 30, 60].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </div>
          <fieldset className="capability-fieldset field-span">
            <legend>Temporary capabilities</legend>
            {capabilities.map((capability) => (
              <label className="checkbox-row" key={capability}>
                <input
                  checked={selectedCapabilities.includes(capability)}
                  onChange={(event) =>
                    setSelectedCapabilities((current) =>
                      event.target.checked
                        ? [...current, capability]
                        : current.filter((value) => value !== capability),
                    )
                  }
                  type="checkbox"
                />
                <code>{capability}</code>
              </label>
            ))}
          </fieldset>
          <div className="field-stack">
            <Label htmlFor="break-glass-incident">Incident/reference</Label>
            <Input
              id="break-glass-incident"
              onChange={(event) => setIncidentReference(event.target.value)}
              placeholder="INC-2026-001"
              required
              value={incidentReference}
            />
          </div>
          <div className="field-stack">
            <Label htmlFor="break-glass-approval">Approval reference</Label>
            <Input
              id="break-glass-approval"
              onChange={(event) => setApprovalReference(event.target.value)}
              required
              value={approvalReference}
            />
          </div>
          <div className="field-stack field-span">
            <Label htmlFor="break-glass-reason">Audit reason</Label>
            <Input
              id="break-glass-reason"
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </div>
          <div className="field-stack field-span">
            <Label htmlFor="break-glass-confirmation">
              Type <code>{expectedConfirmation}</code>
            </Label>
            <Input
              autoComplete="off"
              id="break-glass-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              required
              value={confirmation}
            />
          </div>
          <div className="form-actions field-span">
            <Button
              disabled={
                pending ||
                selectedCapabilities.length === 0 ||
                confirmation !== expectedConfirmation
              }
              type="submit"
              variant="destructive"
            >
              {pending ? "Issuing authority…" : "Issue break-glass grant"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function BreakGlassGrantAction({
  grant,
  onChanged,
}: Readonly<{
  grant: OperatorBreakGlassGrantsResponse["items"][number];
  onChanged: () => void;
}>) {
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<"approved" | "concerns">("approved");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (grant.status === "active") {
        await apiRequest(
          `/api/platform/operator-break-glass-grants/${grant.id}/revoke`,
          { method: "POST", body: JSON.stringify({ reason }) },
        );
      } else {
        await apiRequest(
          `/api/platform/operator-break-glass-grants/${grant.id}/reviews`,
          {
            method: "POST",
            body: JSON.stringify({ outcome, summary: reason }),
          },
        );
      }
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The grant lifecycle change was not recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="field-stack" onSubmit={submit}>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {grant.status !== "active" ? (
        <select
          aria-label="Review outcome"
          className="input"
          onChange={(event) =>
            setOutcome(event.target.value as "approved" | "concerns")
          }
          value={outcome}
        >
          <option value="approved">Approved</option>
          <option value="concerns">Concerns found</option>
        </select>
      ) : null}
      <Input
        aria-label={
          grant.status === "active" ? "Revocation reason" : "Review summary"
        }
        minLength={8}
        onChange={(event) => setReason(event.target.value)}
        placeholder={
          grant.status === "active" ? "Revocation reason" : "Review summary"
        }
        required
        value={reason}
      />
      <Button
        disabled={pending}
        type="submit"
        variant={grant.status === "active" ? "destructive" : "outline"}
      >
        {pending
          ? "Recording…"
          : grant.status === "active"
            ? "Revoke now"
            : "Record review"}
      </Button>
    </form>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
