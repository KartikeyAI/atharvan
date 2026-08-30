import {
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  UserRoundSearchIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { OperatorShell } from "@/components/operator-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  apiRequest,
  type CustomerDirectoryInspectionResponse,
  type CustomerDirectorySearchResponse,
  type CustomerDirectoryStatusResponse,
  useApiResource,
} from "@/lib/api";
import type {
  CustomerDirectoryStatus,
  CustomerUserSummary,
  CustomerWorkspaceMembership,
  CustomerWorkspaceSummary,
} from "@atharvan/domain";

export const Route = createFileRoute("/customers")({
  component: CustomersPage,
});

type SearchScope = "users" | "workspaces" | "all";
type RequestState<Result> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: ApiError }
  | { readonly status: "success"; readonly data: Result };

function CustomersPage() {
  const status = useApiResource<CustomerDirectoryStatusResponse>(
    "/api/platform/customer-directory/status",
  );
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState<
    RequestState<CustomerDirectorySearchResponse>
  >({ status: "idle" });
  const [inspection, setInspection] = useState<
    RequestState<CustomerDirectoryInspectionResponse>
  >({ status: "idle" });

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch({ status: "loading" });
    setInspection({ status: "idle" });
    try {
      const data = await apiRequest<CustomerDirectorySearchResponse>(
        "/api/platform/customer-directory/search",
        {
          method: "POST",
          body: JSON.stringify({ query, scope, limit: 20, reason }),
        },
      );
      setSearch({ status: "success", data });
      status.reload();
    } catch (error) {
      setSearch({ status: "error", error: toApiError(error) });
    }
  }

  async function inspect(entityType: "user" | "workspace", entityId: string) {
    setInspection({ status: "loading" });
    try {
      const data = await apiRequest<CustomerDirectoryInspectionResponse>(
        "/api/platform/customer-directory/inspect",
        {
          method: "POST",
          body: JSON.stringify({ entityType, entityId, reason }),
        },
      );
      setInspection({ status: "success", data });
    } catch (error) {
      setInspection({ status: "error", error: toApiError(error) });
    }
  }

  const directoryStatus =
    status.state.status === "success" ? status.state.data : null;

  return (
    <OperatorShell title="Customers">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Customer directory</h1>
            <p>
              Purpose-bound user and workspace inspection from Arth&apos;s
              disposable control-plane projection.
            </p>
          </div>
          <Button onClick={status.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh status
          </Button>
        </section>

        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          Searches and inspections require a support reason and create immutable
          audit evidence. Search terms are fingerprinted before auditing;
          customer code, conversations, secrets, tokens, and environment values
          are never projected here.
        </Alert>

        {status.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading projection status…
          </Card>
        ) : null}
        {status.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{status.state.error.message}</span>
            <Button onClick={status.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {directoryStatus === null ? null : (
          <DirectoryStatusCard status={directoryStatus} />
        )}

        <Card>
          <form onSubmit={submitSearch}>
            <CardHeader>
              <CardTitle>Search projected identities</CardTitle>
              <CardDescription>
                Search by customer ID, email, display name, organization ID,
                workspace name, or slug. Results reflect the displayed source
                checkpoint only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="customer-search-grid">
                  <Field>
                    <FieldLabel htmlFor="customer-query">Search</FieldLabel>
                    <Input
                      autoComplete="off"
                      id="customer-query"
                      minLength={2}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="User, workspace, email, or ID"
                      required
                      value={query}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="customer-scope">Scope</FieldLabel>
                    <select
                      className="input"
                      id="customer-scope"
                      onChange={(event) =>
                        setScope(event.target.value as SearchScope)
                      }
                      value={scope}
                    >
                      <option value="all">Users and workspaces</option>
                      <option value="users">Users only</option>
                      <option value="workspaces">Workspaces only</option>
                    </select>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="customer-reason">
                    Access reason
                  </FieldLabel>
                  <Input
                    autoComplete="off"
                    id="customer-reason"
                    minLength={8}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Support case or investigation purpose"
                    required
                    value={reason}
                  />
                  <FieldDescription>
                    Stored with the audit event. Do not enter customer secrets
                    or private content.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button disabled={search.status === "loading"} type="submit">
                <SearchIcon data-icon="inline-start" />
                {search.status === "loading" ? "Searching…" : "Search"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {search.status === "error" ? (
          <Alert variant="destructive">{search.error.message}</Alert>
        ) : null}
        {search.status === "success" ? (
          <SearchResults
            inspect={inspect}
            result={search.data}
            searching={inspection.status === "loading"}
          />
        ) : null}
        {inspection.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading audited detail…
          </Card>
        ) : null}
        {inspection.status === "error" ? (
          <Alert variant="destructive">{inspection.error.message}</Alert>
        ) : null}
        {inspection.status === "success" ? (
          <InspectionCard inspection={inspection.data} />
        ) : null}
      </div>
    </OperatorShell>
  );
}

function DirectoryStatusCard({
  status,
}: Readonly<{ status: CustomerDirectoryStatus }>) {
  const message =
    status.freshness === "unknown"
      ? "No Arth snapshot has been received. Search results are intentionally empty."
      : status.freshness === "stale"
        ? "The latest Arth observation is older than 15 minutes. Treat results as stale."
        : "The projection is within its 15-minute freshness window.";
  return (
    <Card className="customer-status-card">
      <CardHeader>
        <div>
          <CardTitle>Arth projection</CardTitle>
          <CardDescription>{message}</CardDescription>
        </div>
        <Badge variant={freshnessVariant(status.freshness)}>
          {status.freshness}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="customer-status-details">
          <div>
            <dt>Source revision</dt>
            <dd>{status.sourceRevision ?? "Not synchronized"}</dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>{formatDate(status.observedAt)}</dd>
          </div>
          <div>
            <dt>Projected</dt>
            <dd>{formatDate(status.synchronizedAt)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function SearchResults({
  result,
  inspect,
  searching,
}: Readonly<{
  result: CustomerDirectorySearchResponse;
  inspect: (entityType: "user" | "workspace", entityId: string) => void;
  searching: boolean;
}>) {
  const empty = result.users.length === 0 && result.workspaces.length === 0;
  return (
    <section aria-labelledby="customer-results-heading">
      <div className="customer-results-heading">
        <div>
          <h2 id="customer-results-heading">Search results</h2>
          <p>
            {result.users.length} users · {result.workspaces.length} workspaces
          </p>
        </div>
        <Badge variant={freshnessVariant(result.status.freshness)}>
          {result.status.freshness}
        </Badge>
      </div>
      {empty ? (
        <Card className="empty-card">
          <UserRoundSearchIcon aria-hidden="true" />
          <h2>No projected customer matches</h2>
          <p>
            Check the query and scope, or wait for a current Arth projection.
          </p>
        </Card>
      ) : (
        <div className="customer-result-grid">
          {result.users.map((user) => (
            <CustomerUserCard
              inspect={inspect}
              key={user.id}
              searching={searching}
              user={user}
            />
          ))}
          {result.workspaces.map((workspace) => (
            <CustomerWorkspaceCard
              inspect={inspect}
              key={workspace.id}
              searching={searching}
              workspace={workspace}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CustomerUserCard({
  user,
  inspect,
  searching,
}: Readonly<{
  user: CustomerUserSummary;
  inspect: (entityType: "user", entityId: string) => void;
  searching: boolean;
}>) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{user.displayName}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </div>
        <Badge variant={lifecycleVariant(user.lifecycle)}>
          {user.lifecycle}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="customer-identifier">{user.id}</p>
        <div className="customer-badge-row">
          <Badge>{user.verificationStatus}</Badge>
          <Badge>user</Badge>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          disabled={searching}
          onClick={() => inspect("user", user.id)}
          type="button"
          variant="outline"
        >
          Inspect memberships
        </Button>
      </CardFooter>
    </Card>
  );
}

function CustomerWorkspaceCard({
  workspace,
  inspect,
  searching,
}: Readonly<{
  workspace: CustomerWorkspaceSummary;
  inspect: (entityType: "workspace", entityId: string) => void;
  searching: boolean;
}>) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{workspace.name}</CardTitle>
          <CardDescription>
            {workspace.slug ?? workspace.organizationId}
          </CardDescription>
        </div>
        <Badge variant={lifecycleVariant(workspace.lifecycle)}>
          {workspace.lifecycle}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="customer-identifier">{workspace.id}</p>
        <div className="customer-badge-row">
          <Badge>workspace</Badge>
          <Badge>{workspace.organizationId}</Badge>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          disabled={searching}
          onClick={() => inspect("workspace", workspace.id)}
          type="button"
          variant="outline"
        >
          Inspect members
        </Button>
      </CardFooter>
    </Card>
  );
}

function InspectionCard({
  inspection,
}: Readonly<{ inspection: CustomerDirectoryInspectionResponse }>) {
  const title =
    inspection.entityType === "user"
      ? inspection.user.displayName
      : inspection.workspace.name;
  return (
    <Card className="customer-inspection">
      <CardHeader>
        <div>
          <CardTitle>Membership detail · {title}</CardTitle>
          <CardDescription>
            Effective permissions are copied exactly from Arth; Atharvan does
            not infer them from the role label.
          </CardDescription>
        </div>
        <Badge variant={freshnessVariant(inspection.status.freshness)}>
          {inspection.status.freshness}
        </Badge>
      </CardHeader>
      <CardContent>
        {inspection.memberships.length === 0 ? (
          <p className="customer-muted">No projected memberships.</p>
        ) : (
          <div className="customer-membership-list">
            {inspection.entityType === "user"
              ? inspection.memberships.map((entry) => (
                  <MembershipDetail
                    key={entry.membership.id}
                    membership={entry.membership}
                    relatedId={entry.workspace.id}
                    relatedLabel={entry.workspace.name}
                  />
                ))
              : inspection.memberships.map((entry) => (
                  <MembershipDetail
                    key={entry.membership.id}
                    membership={entry.membership}
                    relatedId={entry.user.id}
                    relatedLabel={entry.user.displayName}
                  />
                ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MembershipDetail({
  membership,
  relatedId,
  relatedLabel,
}: Readonly<{
  membership: CustomerWorkspaceMembership;
  relatedId: string;
  relatedLabel: string;
}>) {
  return (
    <article className="customer-membership">
      <div className="customer-membership-heading">
        <div>
          <strong>{relatedLabel}</strong>
          <span>{relatedId}</span>
        </div>
        <div className="customer-badge-row">
          <Badge>{membership.role}</Badge>
          <Badge variant={lifecycleVariant(membership.lifecycle)}>
            {membership.lifecycle}
          </Badge>
        </div>
      </div>
      <PermissionGroup
        label="Effective permissions"
        permissions={membership.effectivePermissions}
      />
      <div className="customer-permission-grid">
        <PermissionGroup
          label="Granted"
          permissions={membership.grantedPermissions}
        />
        <PermissionGroup
          label="Denied"
          permissions={membership.deniedPermissions}
          variant="critical"
        />
      </div>
    </article>
  );
}

function PermissionGroup({
  label,
  permissions,
  variant = "neutral",
}: Readonly<{
  label: string;
  permissions: ReadonlyArray<string>;
  variant?: "neutral" | "critical";
}>) {
  return (
    <div className="customer-permission-group">
      <span>{label}</span>
      <div className="customer-badge-row">
        {permissions.length === 0 ? (
          <Badge>none</Badge>
        ) : (
          permissions.map((permission) => (
            <Badge key={permission} variant={variant}>
              {permission}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

function freshnessVariant(value: CustomerDirectoryStatus["freshness"]) {
  return value === "current"
    ? ("success" as const)
    : value === "stale"
      ? ("warning" as const)
      : ("neutral" as const);
}

function lifecycleVariant(value: string) {
  if (value === "active") return "success" as const;
  if (value === "restricted" || value === "suspended")
    return "warning" as const;
  if (value === "deactivated" || value === "archived" || value === "removed")
    return "critical" as const;
  return "neutral" as const;
}

function formatDate(value: string | null) {
  return value === null ? "Not available" : new Date(value).toLocaleString();
}

function toApiError(error: unknown) {
  return error instanceof ApiError
    ? error
    : new ApiError(0, "network_error", "The control plane is unreachable.");
}
