import {
  BadgeCheckIcon,
  FileLock2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, apiRequest } from "@/lib/api";
import type {
  CommercialProductEntry,
  EntitlementOveragePolicy,
  EntitlementValue,
  PlanEntitlementSet,
  WorkspaceEntitlementRegistry,
} from "@atharvan/domain";

interface PlanOption {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
}

interface EntitlementDraft {
  readonly id: number;
  readonly key: string;
  readonly valueType: "boolean" | "quantity";
  readonly enabled: boolean;
  readonly limit: string;
  readonly unit: string;
  readonly overagePolicy: EntitlementOveragePolicy;
}

export function EntitlementOperations({
  products,
}: Readonly<{ products: ReadonlyArray<CommercialProductEntry> }>) {
  const plans = toPlanOptions(products);
  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Entitlements</p>
          <h2>Workspace commercial authority</h2>
          <p>
            Seal plan allowances, assign exact snapshots, and manage expiring
            enterprise overrides.
          </p>
        </div>
      </div>
      <Alert>
        <FileLock2Icon aria-hidden="true" /> Plan templates and workspace
        snapshots are immutable. Each assignment or grant change creates a new
        revision for Arth.
      </Alert>
      <PlanEntitlementEditor plans={plans} />
      <WorkspaceEntitlementOperations plans={plans} />
    </section>
  );
}

function PlanEntitlementEditor({ plans }: Readonly<{ plans: PlanOption[] }>) {
  const nextId = useRef(2);
  const [planVersionId, setPlanVersionId] = useState("");
  const [values, setValues] = useState<EntitlementDraft[]>([emptyDraft(1)]);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function selectPlan(value: string) {
    setPlanVersionId(value);
    setMessage(null);
    if (!value) return;
    setPending(true);
    try {
      const result = await apiRequest<PlanEntitlementSet>(
        `/api/platform/commercial-plan-versions/${encodeURIComponent(value)}/entitlements`,
        { cache: "no-store" },
      );
      setValues(result.values.map((item) => toDraft(item, nextId.current++)));
      setMessage(
        "This plan version already has a sealed entitlement template.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setValues([emptyDraft(nextId.current++)]);
        setMessage("No template is sealed for this plan version yet.");
      } else {
        setMessage(
          error instanceof Error
            ? error.message
            : "The template could not be loaded.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  function updateDraft(id: number, change: Partial<EntitlementDraft>) {
    setValues((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...change,
              ...(change.valueType === "boolean"
                ? { limit: "", unit: "", overagePolicy: "denied" as const }
                : {}),
            }
          : item,
      ),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly id: string;
      }>(
        `/api/platform/commercial-plan-versions/${encodeURIComponent(planVersionId)}/entitlements`,
        {
          method: "PUT",
          body: JSON.stringify({
            values: values.map(toValue),
            reason,
          }),
        },
      );
      setReason("");
      setMessage(`Entitlement template ${result.outcome}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The template was not sealed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <FileLock2Icon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Seal plan entitlement template</CardTitle>
          <CardDescription>
            A plan version accepts one immutable set of capabilities and
            allowances.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="plan-entitlement-template-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <Field className="field-span">
              <FieldLabel htmlFor="entitlement-plan-version">
                Plan version
              </FieldLabel>
              <select
                className="input"
                id="entitlement-plan-version"
                onChange={(event) => void selectPlan(event.target.value)}
                required
                value={planVersionId}
              >
                <option value="">Select a plan version</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field-span model-list">
              {values.map((value, index) => (
                <EntitlementValueEditor
                  canRemove={values.length > 1}
                  index={index}
                  key={value.id}
                  onChange={(change) => updateDraft(value.id, change)}
                  onRemove={() =>
                    setValues((current) =>
                      current.filter((item) => item.id !== value.id),
                    )
                  }
                  value={value}
                />
              ))}
              <Button
                onClick={() =>
                  setValues((current) => [
                    ...current,
                    emptyDraft(nextId.current++),
                  ])
                }
                type="button"
                variant="outline"
              >
                <PlusIcon data-icon="inline-start" /> Add entitlement
              </Button>
            </div>
            <TextField
              className="field-span"
              id="entitlement-template-reason"
              label="Audit reason"
              minLength={8}
              onChange={setReason}
              value={reason}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button
          disabled={pending || plans.length === 0}
          form="plan-entitlement-template-form"
          type="submit"
        >
          {pending ? "Saving…" : "Seal entitlement template"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function EntitlementValueEditor({
  value,
  index,
  canRemove,
  onChange,
  onRemove,
}: Readonly<{
  value: EntitlementDraft;
  index: number;
  canRemove: boolean;
  onChange: (change: Partial<EntitlementDraft>) => void;
  onRemove: () => void;
}>) {
  return (
    <div className="model-row">
      <div className="model-row-heading">
        <strong>Entitlement {index + 1}</strong>
        <Button
          aria-label={`Remove entitlement ${index + 1}`}
          disabled={!canRemove}
          onClick={onRemove}
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
      <FieldGroup className="admin-form">
        <TextField
          id={`entitlement-key-${value.id}`}
          label="Entitlement key"
          onChange={(key) => onChange({ key })}
          value={value.key}
        />
        <Field>
          <FieldLabel htmlFor={`entitlement-type-${value.id}`}>
            Value type
          </FieldLabel>
          <select
            className="input"
            id={`entitlement-type-${value.id}`}
            onChange={(event) =>
              onChange({
                valueType: event.target.value as "boolean" | "quantity",
              })
            }
            value={value.valueType}
          >
            <option value="boolean">Capability</option>
            <option value="quantity">Allowance</option>
          </select>
        </Field>
        {value.valueType === "boolean" ? (
          <Field>
            <FieldLabel htmlFor={`entitlement-enabled-${value.id}`}>
              Availability
            </FieldLabel>
            <select
              className="input"
              id={`entitlement-enabled-${value.id}`}
              onChange={(event) =>
                onChange({ enabled: event.target.value === "true" })
              }
              value={String(value.enabled)}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
        ) : (
          <>
            <TextField
              id={`entitlement-limit-${value.id}`}
              label="Included limit (blank is unlimited)"
              onChange={(limit) => onChange({ limit })}
              required={false}
              type="number"
              value={value.limit}
            />
            <TextField
              id={`entitlement-unit-${value.id}`}
              label="Unit"
              onChange={(unit) => onChange({ unit })}
              value={value.unit}
            />
            <Field>
              <FieldLabel htmlFor={`entitlement-overage-${value.id}`}>
                Overage policy
              </FieldLabel>
              <select
                className="input"
                id={`entitlement-overage-${value.id}`}
                onChange={(event) =>
                  onChange({
                    overagePolicy: event.target
                      .value as EntitlementOveragePolicy,
                  })
                }
                value={value.overagePolicy}
              >
                <option value="denied">Denied at limit</option>
                <option value="metered">Metered overage</option>
                <option value="contract">Contract governed</option>
              </select>
            </Field>
          </>
        )}
      </FieldGroup>
    </div>
  );
}

function WorkspaceEntitlementOperations({
  plans,
}: Readonly<{ plans: PlanOption[] }>) {
  const activePlans = plans.filter((plan) => plan.active);
  const [workspaceId, setWorkspaceId] = useState("");
  const [planVersionId, setPlanVersionId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [grantKey, setGrantKey] = useState("");
  const [grantType, setGrantType] = useState<"boolean" | "quantity">(
    "quantity",
  );
  const [grantEnabled, setGrantEnabled] = useState(true);
  const [grantLimit, setGrantLimit] = useState("");
  const [grantUnit, setGrantUnit] = useState("");
  const [grantOverage, setGrantOverage] =
    useState<EntitlementOveragePolicy>("contract");
  const [grantLifecycle, setGrantLifecycle] = useState<"active" | "revoked">(
    "active",
  );
  const [contractReference, setContractReference] = useState("");
  const [startsAt, setStartsAt] = useState(() => toLocalDateTime(new Date()));
  const [expiresAt, setExpiresAt] = useState(() => {
    const value = new Date();
    value.setFullYear(value.getFullYear() + 1);
    return toLocalDateTime(value);
  });
  const [grantReason, setGrantReason] = useState("");
  const [registry, setRegistry] = useState<WorkspaceEntitlementRegistry | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function inspect(preserveMessage = false) {
    if (!workspaceId.trim()) {
      setMessage("Enter a workspace ID.");
      return;
    }
    setPending(true);
    if (!preserveMessage) setMessage(null);
    try {
      setRegistry(
        await apiRequest<WorkspaceEntitlementRegistry>(
          `/api/platform/workspace-entitlements/${encodeURIComponent(workspaceId.trim())}`,
          { cache: "no-store" },
        ),
      );
    } catch (error) {
      setRegistry(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Workspace entitlements could not be loaded.",
      );
    } finally {
      setPending(false);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(
        `/api/platform/workspace-entitlements/${encodeURIComponent(workspaceId.trim())}/assignment`,
        {
          method: "PUT",
          body: JSON.stringify({ planVersionId, reason: assignmentReason }),
        },
      );
      setAssignmentReason("");
      await inspect(true);
      setMessage(
        `Workspace assignment ${result.outcome}; snapshot ${result.revisionNumber} is current.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The plan was not assigned.",
      );
    } finally {
      setPending(false);
    }
  }

  async function setGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
        readonly snapshotRevisionNumber?: number;
      }>(
        `/api/platform/workspace-entitlements/${encodeURIComponent(workspaceId.trim())}/grants/${encodeURIComponent(grantKey)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            valueType: grantType,
            enabled: grantType === "boolean" ? grantEnabled : null,
            limit:
              grantType === "quantity"
                ? grantLimit === ""
                  ? null
                  : parseExactInteger(grantLimit)
                : null,
            unit: grantType === "quantity" ? grantUnit : null,
            overagePolicy: grantType === "quantity" ? grantOverage : "denied",
            lifecycle: grantLifecycle,
            contractReference,
            startsAt: new Date(startsAt).toISOString(),
            expiresAt: new Date(expiresAt).toISOString(),
            reason: grantReason,
          }),
        },
      );
      setGrantReason("");
      await inspect(true);
      setMessage(
        `Enterprise grant ${result.outcome}; revision ${result.revisionNumber}${result.snapshotRevisionNumber ? ` created snapshot ${result.snapshotRevisionNumber}` : ""}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The grant was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="model-editor-grid">
        <Card>
          <CardHeader>
            <CardTitle>Assign plan snapshot</CardTitle>
            <CardDescription>
              Copies a sealed plan template into immutable workspace authority.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="workspace-entitlement-assignment" onSubmit={assign}>
              <FieldGroup className="admin-form">
                <TextField
                  id="workspace-entitlement-id"
                  label="Workspace ID"
                  onChange={setWorkspaceId}
                  value={workspaceId}
                />
                <Field>
                  <FieldLabel htmlFor="workspace-entitlement-plan">
                    Active plan version
                  </FieldLabel>
                  <select
                    className="input"
                    id="workspace-entitlement-plan"
                    onChange={(event) => setPlanVersionId(event.target.value)}
                    required
                    value={planVersionId}
                  >
                    <option value="">Select an active plan</option>
                    {activePlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <TextField
                  className="field-span"
                  id="workspace-entitlement-assignment-reason"
                  label="Audit reason"
                  minLength={8}
                  onChange={setAssignmentReason}
                  value={assignmentReason}
                />
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending || activePlans.length === 0}
              form="workspace-entitlement-assignment"
              type="submit"
            >
              {pending ? "Assigning…" : "Assign immutable snapshot"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enterprise override</CardTitle>
            <CardDescription>
              Versioned contract terms automatically stop at their expiry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form id="workspace-enterprise-grant" onSubmit={setGrant}>
              <FieldGroup className="admin-form">
                <TextField
                  id="enterprise-grant-workspace"
                  label="Workspace ID"
                  onChange={setWorkspaceId}
                  value={workspaceId}
                />
                <TextField
                  id="enterprise-grant-key"
                  label="Entitlement key"
                  onChange={setGrantKey}
                  value={grantKey}
                />
                <Field>
                  <FieldLabel htmlFor="enterprise-grant-type">
                    Value type
                  </FieldLabel>
                  <select
                    className="input"
                    id="enterprise-grant-type"
                    onChange={(event) =>
                      setGrantType(event.target.value as "boolean" | "quantity")
                    }
                    value={grantType}
                  >
                    <option value="quantity">Allowance</option>
                    <option value="boolean">Capability</option>
                  </select>
                </Field>
                {grantType === "boolean" ? (
                  <Field>
                    <FieldLabel htmlFor="enterprise-grant-enabled">
                      Availability
                    </FieldLabel>
                    <select
                      className="input"
                      id="enterprise-grant-enabled"
                      onChange={(event) =>
                        setGrantEnabled(event.target.value === "true")
                      }
                      value={String(grantEnabled)}
                    >
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </Field>
                ) : (
                  <>
                    <TextField
                      id="enterprise-grant-limit"
                      label="Override limit (blank is unlimited)"
                      onChange={setGrantLimit}
                      required={false}
                      type="number"
                      value={grantLimit}
                    />
                    <TextField
                      id="enterprise-grant-unit"
                      label="Unit"
                      onChange={setGrantUnit}
                      value={grantUnit}
                    />
                    <Field>
                      <FieldLabel htmlFor="enterprise-grant-overage">
                        Overage policy
                      </FieldLabel>
                      <select
                        className="input"
                        id="enterprise-grant-overage"
                        onChange={(event) =>
                          setGrantOverage(
                            event.target.value as EntitlementOveragePolicy,
                          )
                        }
                        value={grantOverage}
                      >
                        <option value="denied">Denied at limit</option>
                        <option value="metered">Metered overage</option>
                        <option value="contract">Contract governed</option>
                      </select>
                    </Field>
                  </>
                )}
                <TextField
                  id="enterprise-grant-contract"
                  label="Contract reference"
                  minLength={3}
                  onChange={setContractReference}
                  value={contractReference}
                />
                <Field>
                  <FieldLabel htmlFor="enterprise-grant-lifecycle">
                    Lifecycle
                  </FieldLabel>
                  <select
                    className="input"
                    id="enterprise-grant-lifecycle"
                    onChange={(event) =>
                      setGrantLifecycle(
                        event.target.value as "active" | "revoked",
                      )
                    }
                    value={grantLifecycle}
                  >
                    <option value="active">Active or scheduled</option>
                    <option value="revoked">Revoke existing grant</option>
                  </select>
                </Field>
                <DateTimeField
                  id="enterprise-grant-start"
                  label="Starts at"
                  onChange={setStartsAt}
                  value={startsAt}
                />
                <DateTimeField
                  id="enterprise-grant-expiry"
                  label="Expires at"
                  onChange={setExpiresAt}
                  value={expiresAt}
                />
                <TextField
                  className="field-span"
                  id="enterprise-grant-reason"
                  label="Audit reason"
                  minLength={8}
                  onChange={setGrantReason}
                  value={grantReason}
                />
              </FieldGroup>
            </form>
          </CardContent>
          <CardFooter>
            <Button
              disabled={pending}
              form="workspace-enterprise-grant"
              type="submit"
            >
              {pending ? "Saving…" : "Create entitlement snapshot"}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader className="table-card-header">
          <div>
            <CardTitle>Workspace entitlement evidence</CardTitle>
            <CardDescription>
              Current resolved authority, overrides, and reconciliation state.
            </CardDescription>
          </div>
          <Button
            disabled={pending}
            onClick={() => void inspect()}
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" /> Inspect
          </Button>
        </CardHeader>
        <CardContent>
          {message ? <Alert>{message}</Alert> : null}
          {registry ? (
            <WorkspaceEntitlementEvidence registry={registry} />
          ) : (
            <div className="inline-empty">
              Enter a workspace ID above, then inspect its entitlement evidence.
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function WorkspaceEntitlementEvidence({
  registry,
}: Readonly<{ registry: WorkspaceEntitlementRegistry }>) {
  return (
    <div className="model-list">
      <div className="model-row">
        <div className="model-row-heading">
          <div>
            <strong>{registry.workspaceName}</strong>
            <code>{registry.workspaceId}</code>
          </div>
          <Badge>{registry.workspaceLifecycle}</Badge>
        </div>
      </div>
      {registry.current === null ? (
        <div className="inline-empty">
          No plan is assigned to this workspace.
        </div>
      ) : (
        <div className="model-row">
          <div className="model-row-heading">
            <div>
              <strong>
                {registry.current.planKey} v{registry.current.planVersionNumber}
              </strong>
              <code>snapshot {registry.current.revisionNumber}</code>
            </div>
            <Badge
              variant={
                registry.current.reconciliationState === "applied"
                  ? "success"
                  : "neutral"
              }
            >
              {registry.current.reconciliationState}
            </Badge>
          </div>
          <div className="capability-list">
            {registry.current.effective.map((value) => (
              <code key={value.key}>
                {value.key}: {formatValue(value)} · {value.sourceKind}
                {value.expiresAt
                  ? ` until ${new Date(value.expiresAt).toLocaleString()}`
                  : ""}
              </code>
            ))}
          </div>
        </div>
      )}
      {registry.grants.map((grant) => (
        <div className="model-row" key={grant.id}>
          <div className="model-row-heading">
            <div>
              <strong>{grant.key}</strong>
              <code>{grant.contractReference}</code>
            </div>
            <Badge variant={grant.status === "active" ? "success" : "neutral"}>
              {grant.status}
            </Badge>
          </div>
          <p>
            {formatValue(grant.value)} · revision {grant.revisionNumber} ·
            expires {new Date(grant.expiresAt).toLocaleString()}
          </p>
        </div>
      ))}
      {registry.historyTruncated ? (
        <Alert>
          Older entitlement snapshots are omitted from this bounded view.
        </Alert>
      ) : null}
      {registry.current?.reconciliationState === "applied" ? (
        <Alert>
          <BadgeCheckIcon aria-hidden="true" /> Arth acknowledged the current
          entitlement revision.
        </Alert>
      ) : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  className,
  minLength = 2,
  required = true,
  type = "text",
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  minLength?: number;
  required?: boolean;
  type?: "text" | "number";
}>) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        min={type === "number" ? 0 : undefined}
        minLength={type === "text" ? minLength : undefined}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        step={type === "number" ? 1 : undefined}
        type={type}
        value={value}
      />
    </Field>
  );
}

function DateTimeField({
  id,
  label,
  value,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        required
        type="datetime-local"
        value={value}
      />
    </Field>
  );
}

function emptyDraft(id: number): EntitlementDraft {
  return {
    id,
    key: "",
    valueType: "boolean",
    enabled: true,
    limit: "",
    unit: "",
    overagePolicy: "denied",
  };
}

function toDraft(value: EntitlementValue, id: number): EntitlementDraft {
  return {
    id,
    key: value.key,
    valueType: value.valueType,
    enabled: value.valueType === "boolean" ? value.enabled : true,
    limit:
      value.valueType === "quantity" && value.limit !== null
        ? String(value.limit)
        : "",
    unit: value.valueType === "quantity" ? value.unit : "",
    overagePolicy:
      value.valueType === "quantity" ? value.overagePolicy : "denied",
  };
}

function toValue(value: EntitlementDraft): EntitlementValue {
  return value.valueType === "boolean"
    ? {
        key: value.key,
        valueType: "boolean",
        enabled: value.enabled,
        limit: null,
        unit: null,
        overagePolicy: "denied",
      }
    : {
        key: value.key,
        valueType: "quantity",
        enabled: null,
        limit: value.limit === "" ? null : parseExactInteger(value.limit),
        unit: value.unit,
        overagePolicy: value.overagePolicy,
      };
}

function parseExactInteger(value: string) {
  if (!/^\d+$/.test(value))
    throw new Error("Allowance limits must be whole numbers.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 9_000_000_000_000)
    throw new Error("The allowance is outside the supported range.");
  return parsed;
}

function toPlanOptions(products: ReadonlyArray<CommercialProductEntry>) {
  return products.flatMap((product) =>
    product.plans.flatMap((plan) =>
      plan.versions.map((version) => ({
        id: version.id,
        label: `${product.displayName} · ${plan.key} v${version.versionNumber} (${version.lifecycle})`,
        active:
          product.lifecycle === "active" && version.lifecycle === "active",
      })),
    ),
  );
}

function toLocalDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatValue(value: EntitlementValue) {
  if (value.valueType === "boolean")
    return value.enabled ? "enabled" : "disabled";
  return `${value.limit === null ? "unlimited" : value.limit.toLocaleString()} ${value.unit} (${value.overagePolicy})`;
}
