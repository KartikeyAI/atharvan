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
  type CustomerRestrictionRegistryResponse,
  useApiResource,
} from "@/lib/api";
import type {
  CustomerDirectoryStatus,
  CustomerInternalNoteCategory,
  CustomerRiskCategory,
  CustomerRiskMarker,
  CustomerRiskSeverity,
  CustomerRestrictionCapability,
  CustomerRestrictionDesiredState,
  CustomerUserSummary,
  CustomerWorkspaceMembership,
  CustomerWorkspaceSummary,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/customers")({
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
  const [restrictions, setRestrictions] = useState<
    RequestState<CustomerRestrictionRegistryResponse>
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
    setRestrictions({ status: "loading" });
    try {
      const data = await apiRequest<CustomerDirectoryInspectionResponse>(
        "/api/platform/customer-directory/inspect",
        {
          method: "POST",
          body: JSON.stringify({ entityType, entityId, reason }),
        },
      );
      setInspection({ status: "success", data });
      await loadRestrictions(entityType, entityId);
    } catch (error) {
      setInspection({ status: "error", error: toApiError(error) });
      setRestrictions({ status: "idle" });
    }
  }

  async function loadRestrictions(
    entityType: "user" | "workspace",
    entityId: string,
  ) {
    try {
      const data = await apiRequest<CustomerRestrictionRegistryResponse>(
        `/api/platform/customer-restrictions/${entityType}/${encodeURIComponent(entityId)}`,
      );
      setRestrictions({ status: "success", data });
    } catch (error) {
      setRestrictions({ status: "error", error: toApiError(error) });
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
          <>
            <InspectionCard inspection={inspection.data} />
            <RestrictionControl
              inspection={inspection.data}
              reload={loadRestrictions}
              restrictions={restrictions}
            />
            <CustomerOperationsControl
              inspection={inspection.data}
              reload={() =>
                inspect(
                  inspection.data.entityType,
                  inspection.data.entityType === "user"
                    ? inspection.data.user.id
                    : inspection.data.workspace.id,
                )
              }
            />
          </>
        ) : null}
      </div>
    </OperatorShell>
  );
}

const restrictionCapabilities: ReadonlyArray<{
  readonly value: CustomerRestrictionCapability;
  readonly label: string;
}> = [
  { value: "login", label: "Login" },
  { value: "new_executions", label: "New executions" },
  { value: "provider_mutations", label: "Provider mutations" },
  { value: "production_deployments", label: "Production deployments" },
  { value: "integrations", label: "Integrations" },
  { value: "runner_access", label: "Runner access" },
  { value: "all_access", label: "All access" },
];

function RestrictionControl({
  inspection,
  restrictions,
  reload,
}: Readonly<{
  inspection: CustomerDirectoryInspectionResponse;
  restrictions: RequestState<CustomerRestrictionRegistryResponse>;
  reload: (entityType: "user" | "workspace", entityId: string) => Promise<void>;
}>) {
  const targetType = inspection.entityType;
  const targetId =
    inspection.entityType === "user"
      ? inspection.user.id
      : inspection.workspace.id;
  const [capability, setCapability] = useState<CustomerRestrictionCapability>(
    targetType === "user" ? "login" : "new_executions",
  );
  const [desiredState, setDesiredState] =
    useState<CustomerRestrictionDesiredState>("restricted");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expectedConfirmation = `${
    desiredState === "restricted" ? "RESTRICT" : "RESTORE"
  } ${targetId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      await apiRequest("/api/platform/customer-restrictions", {
        method: "POST",
        body: JSON.stringify({
          targetType,
          targetId,
          capability,
          desiredState,
          confirmation,
          reason,
        }),
      });
      setConfirmation("");
      setReason("");
      setMessage(
        `The ${desiredState} request is recorded and awaiting Arth reconciliation.`,
      );
      await reload(targetType, targetId);
    } catch (requestError) {
      setError(toApiError(requestError).message);
    } finally {
      setPending(false);
    }
  }

  const availableCapabilities = restrictionCapabilities.filter(
    (item) => targetType === "user" || item.value !== "login",
  );
  return (
    <Card className="customer-restrictions">
      <CardHeader>
        <div>
          <CardTitle>Access restrictions</CardTitle>
          <CardDescription>
            Request a granular deny or restoration. Atharvan records intent;
            status remains pending until Arth reports the enforced state.
          </CardDescription>
        </div>
        <Badge variant="warning">Step-up required</Badge>
      </CardHeader>
      <CardContent>
        {restrictions.status === "loading" ? (
          <p className="customer-muted">Loading restriction state…</p>
        ) : null}
        {restrictions.status === "error" ? (
          <Alert variant="destructive">{restrictions.error.message}</Alert>
        ) : null}
        {restrictions.status === "success" ? (
          restrictions.data.items.length === 0 ? (
            <p className="customer-muted">No restriction history.</p>
          ) : (
            <div className="customer-restriction-list">
              {restrictions.data.items.map((item) => (
                <article className="customer-restriction-item" key={item.id}>
                  <div>
                    <strong>{restrictionLabel(item.capability)}</strong>
                    <span>
                      Revision {item.revisionNumber} · requested{" "}
                      {formatDate(item.requestedAt)}
                    </span>
                  </div>
                  <div className="customer-badge-row">
                    <Badge
                      variant={
                        item.desiredState === "restricted"
                          ? "critical"
                          : "success"
                      }
                    >
                      {item.desiredState}
                    </Badge>
                    <Badge
                      variant={reconciliationVariant(item.reconciliationState)}
                    >
                      {item.reconciliationState}
                    </Badge>
                  </div>
                </article>
              ))}
            </div>
          )
        ) : null}
        {message ? <Alert variant="success">{message}</Alert> : null}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="form-stack" onSubmit={submit}>
          <div className="customer-search-grid">
            <Field>
              <FieldLabel htmlFor="restriction-capability">
                Capability
              </FieldLabel>
              <select
                className="input"
                id="restriction-capability"
                onChange={(event) =>
                  setCapability(
                    event.target.value as CustomerRestrictionCapability,
                  )
                }
                value={capability}
              >
                {availableCapabilities.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="restriction-action">Action</FieldLabel>
              <select
                className="input"
                id="restriction-action"
                onChange={(event) => {
                  setDesiredState(
                    event.target.value as CustomerRestrictionDesiredState,
                  );
                  setConfirmation("");
                }}
                value={desiredState}
              >
                <option value="restricted">Restrict</option>
                <option value="restored">Restore</option>
              </select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="restriction-reason">Reason</FieldLabel>
            <Input
              autoComplete="off"
              id="restriction-reason"
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Incident, risk, or restoration rationale"
              required
              value={reason}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="restriction-confirmation">
              Type {expectedConfirmation}
            </FieldLabel>
            <Input
              autoComplete="off"
              id="restriction-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              required
              value={confirmation}
            />
            <FieldDescription>
              The command will not claim enforcement until Arth reconciles it.
            </FieldDescription>
          </Field>
          <Button
            disabled={pending || confirmation !== expectedConfirmation}
            type="submit"
            variant={desiredState === "restricted" ? "destructive" : "default"}
          >
            {pending ? "Submitting…" : `Request ${desiredState}`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CustomerOperationsControl({
  inspection,
  reload,
}: Readonly<{
  inspection: CustomerDirectoryInspectionResponse;
  reload: () => Promise<void>;
}>) {
  const targetId =
    inspection.entityType === "user"
      ? inspection.user.id
      : inspection.workspace.id;
  return (
    <div className="customer-result-grid">
      <InternalNotesControl
        inspection={inspection}
        reload={reload}
        targetId={targetId}
      />
      <RiskMarkersControl
        inspection={inspection}
        reload={reload}
        targetId={targetId}
      />
      {inspection.entityType === "workspace" ? (
        <OwnershipTransferControl inspection={inspection} reload={reload} />
      ) : null}
    </div>
  );
}

function InternalNotesControl({
  inspection,
  targetId,
  reload,
}: Readonly<{
  inspection: CustomerDirectoryInspectionResponse;
  targetId: string;
  reload: () => Promise<void>;
}>) {
  const [category, setCategory] =
    useState<CustomerInternalNoteCategory>("support");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/customer-operations/notes", {
        method: "POST",
        body: JSON.stringify({
          targetType: inspection.entityType,
          targetId,
          category,
          body,
          reason,
        }),
      });
      setBody("");
      setReason("");
      await reload();
    } catch (requestError) {
      setError(toApiError(requestError).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
        <CardDescription>
          Append-only operational context. Never enter customer code, prompts,
          tokens, secrets, or environment contents.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {inspection.operations.notes.length === 0 ? (
          <p className="customer-muted">No internal notes.</p>
        ) : (
          <div className="customer-membership-list">
            {inspection.operations.notes.map((note) => (
              <article className="customer-membership" key={note.id}>
                <div className="customer-membership-heading">
                  <strong>{note.body}</strong>
                  <Badge>{note.category}</Badge>
                </div>
                <span className="customer-muted">
                  {formatDate(note.createdAt)} · {note.reason}
                </span>
              </article>
            ))}
          </div>
        )}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="form-stack" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor={`note-category-${targetId}`}>
              Category
            </FieldLabel>
            <select
              className="input"
              id={`note-category-${targetId}`}
              onChange={(event) =>
                setCategory(event.target.value as CustomerInternalNoteCategory)
              }
              value={category}
            >
              <option value="support">Support</option>
              <option value="operations">Operations</option>
              <option value="billing">Billing</option>
              <option value="security">Security</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`note-body-${targetId}`}>Note</FieldLabel>
            <Input
              id={`note-body-${targetId}`}
              maxLength={2000}
              minLength={4}
              onChange={(event) => setBody(event.target.value)}
              required
              value={body}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`note-reason-${targetId}`}>
              Audit reason
            </FieldLabel>
            <Input
              id={`note-reason-${targetId}`}
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </Field>
          <Button disabled={pending} type="submit">
            {pending ? "Recording…" : "Record note"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RiskMarkersControl({
  inspection,
  targetId,
  reload,
}: Readonly<{
  inspection: CustomerDirectoryInspectionResponse;
  targetId: string;
  reload: () => Promise<void>;
}>) {
  const [category, setCategory] = useState<CustomerRiskCategory>("security");
  const [severity, setSeverity] = useState<CustomerRiskSeverity>("medium");
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/customer-operations/risk-markers", {
        method: "POST",
        body: JSON.stringify({
          targetType: inspection.entityType,
          targetId,
          markerId: null,
          category,
          severity,
          state: "active",
          summary,
          reason,
        }),
      });
      setSummary("");
      setReason("");
      await reload();
    } catch (requestError) {
      setError(toApiError(requestError).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Risk markers</CardTitle>
          <CardDescription>
            Immutable risk history with explicit resolution evidence.
          </CardDescription>
        </div>
        <Badge variant="warning">Step-up required</Badge>
      </CardHeader>
      <CardContent>
        {inspection.operations.riskMarkers.length === 0 ? (
          <p className="customer-muted">No risk markers.</p>
        ) : (
          <div className="customer-membership-list">
            {inspection.operations.riskMarkers.map((marker) => (
              <RiskMarkerItem key={marker.id} marker={marker} reload={reload} />
            ))}
          </div>
        )}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="form-stack" onSubmit={submit}>
          <div className="customer-search-grid">
            <Field>
              <FieldLabel htmlFor={`risk-category-${targetId}`}>
                Category
              </FieldLabel>
              <select
                className="input"
                id={`risk-category-${targetId}`}
                onChange={(event) =>
                  setCategory(event.target.value as CustomerRiskCategory)
                }
                value={category}
              >
                <option value="security">Security</option>
                <option value="abuse">Abuse</option>
                <option value="billing">Billing</option>
                <option value="identity">Identity</option>
                <option value="support">Support</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`risk-severity-${targetId}`}>
                Severity
              </FieldLabel>
              <select
                className="input"
                id={`risk-severity-${targetId}`}
                onChange={(event) =>
                  setSeverity(event.target.value as CustomerRiskSeverity)
                }
                value={severity}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`risk-summary-${targetId}`}>
              Summary
            </FieldLabel>
            <Input
              id={`risk-summary-${targetId}`}
              minLength={4}
              onChange={(event) => setSummary(event.target.value)}
              required
              value={summary}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`risk-reason-${targetId}`}>
              Audit reason
            </FieldLabel>
            <Input
              id={`risk-reason-${targetId}`}
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </Field>
          <Button disabled={pending} type="submit" variant="destructive">
            {pending ? "Recording…" : "Add risk marker"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RiskMarkerItem({
  marker,
  reload,
}: Readonly<{
  marker: CustomerRiskMarker;
  reload: () => Promise<void>;
}>) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/customer-operations/risk-markers", {
        method: "POST",
        body: JSON.stringify({
          targetType: marker.targetType,
          targetId: marker.targetId,
          markerId: marker.id,
          category: marker.category,
          severity: marker.severity,
          state: "resolved",
          summary: marker.summary,
          reason,
        }),
      });
      await reload();
    } catch (requestError) {
      setError(toApiError(requestError).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="customer-membership">
      <div className="customer-membership-heading">
        <div>
          <strong>{marker.summary}</strong>
          <span>
            Revision {marker.revisionNumber} · {formatDate(marker.changedAt)}
          </span>
        </div>
        <div className="customer-badge-row">
          <Badge variant={marker.state === "active" ? "critical" : "success"}>
            {marker.state}
          </Badge>
          <Badge>{marker.severity}</Badge>
          <Badge>{marker.category}</Badge>
        </div>
      </div>
      {marker.state === "active" ? (
        <form className="inline-confirmation" onSubmit={resolve}>
          <FieldLabel htmlFor={`resolve-risk-${marker.id}`}>
            Resolution reason
          </FieldLabel>
          <Input
            id={`resolve-risk-${marker.id}`}
            minLength={8}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
          {error ? <span className="form-error">{error}</span> : null}
          <Button disabled={pending} type="submit" variant="outline">
            {pending ? "Resolving…" : "Resolve marker"}
          </Button>
        </form>
      ) : null}
    </article>
  );
}

function OwnershipTransferControl({
  inspection,
  reload,
}: Readonly<{
  inspection: Extract<
    CustomerDirectoryInspectionResponse,
    { entityType: "workspace" }
  >;
  reload: () => Promise<void>;
}>) {
  const [successorUserId, setSuccessorUserId] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = `TRANSFER ${inspection.workspace.id} TO ${successorUserId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/customer-ownership-transfers", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: inspection.workspace.id,
          successorUserId,
          approvalReference,
          confirmation,
          reason,
        }),
      });
      setSuccessorUserId("");
      setApprovalReference("");
      setConfirmation("");
      setReason("");
      await reload();
    } catch (requestError) {
      setError(toApiError(requestError).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Ownership recovery and transfer</CardTitle>
          <CardDescription>
            Current owner comes directly from Arth. A request remains pending
            until Arth reports the observed owner.
          </CardDescription>
        </div>
        <Badge variant="warning">Approval + step-up</Badge>
      </CardHeader>
      <CardContent>
        <p className="customer-identifier">
          Current owner: {inspection.workspace.ownerUserId ?? "Unknown"}
        </p>
        {inspection.operations.ownershipTransfers.length === 0 ? (
          <p className="customer-muted">No ownership transfer history.</p>
        ) : (
          <div className="customer-membership-list">
            {inspection.operations.ownershipTransfers.map((transfer) => (
              <article className="customer-membership" key={transfer.id}>
                <div className="customer-membership-heading">
                  <div>
                    <strong>{transfer.successorUserId}</strong>
                    <span>
                      Revision {transfer.revisionNumber} · approval{" "}
                      {transfer.approvalReference}
                    </span>
                  </div>
                  <Badge
                    variant={reconciliationVariant(
                      transfer.reconciliationState,
                    )}
                  >
                    {transfer.reconciliationState}
                  </Badge>
                </div>
              </article>
            ))}
          </div>
        )}
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="form-stack" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor={`successor-${inspection.workspace.id}`}>
              Successor user ID
            </FieldLabel>
            <Input
              id={`successor-${inspection.workspace.id}`}
              onChange={(event) => {
                setSuccessorUserId(event.target.value);
                setConfirmation("");
              }}
              required
              value={successorUserId}
            />
            <FieldDescription>
              Must be an active, verified member of this workspace.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`approval-${inspection.workspace.id}`}>
              Approval reference
            </FieldLabel>
            <Input
              id={`approval-${inspection.workspace.id}`}
              minLength={3}
              onChange={(event) => setApprovalReference(event.target.value)}
              required
              value={approvalReference}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`transfer-reason-${inspection.workspace.id}`}>
              Reason
            </FieldLabel>
            <Input
              id={`transfer-reason-${inspection.workspace.id}`}
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`transfer-confirm-${inspection.workspace.id}`}>
              Type {expected}
            </FieldLabel>
            <Input
              id={`transfer-confirm-${inspection.workspace.id}`}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              value={confirmation}
            />
          </Field>
          <Button
            disabled={pending || confirmation !== expected}
            type="submit"
            variant="destructive"
          >
            {pending ? "Requesting…" : "Request ownership transfer"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function restrictionLabel(value: CustomerRestrictionCapability) {
  return (
    restrictionCapabilities.find((item) => item.value === value)?.label ?? value
  );
}

function reconciliationVariant(value: string) {
  if (value === "applied") return "success" as const;
  if (value === "pending") return "warning" as const;
  return "critical" as const;
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
