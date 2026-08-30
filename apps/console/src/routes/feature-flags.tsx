import {
  FlagIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  TestTubeDiagonalIcon,
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
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  apiRequest,
  type OperatorDirectoryResponse,
  type PlatformFeatureFlagRegistryResponse,
  useApiResource,
} from "@/lib/api";
import type {
  PlatformFeatureFlagEntry,
  PlatformFeatureFlagEvaluation,
  PlatformFeatureFlagLifecycle,
  PlatformFeatureFlagRule,
} from "@atharvan/domain";

export const Route = createFileRoute("/feature-flags")({
  component: FeatureFlagsPage,
});

function FeatureFlagsPage() {
  const flags = useApiResource<PlatformFeatureFlagRegistryResponse>(
    "/api/platform/feature-flags",
  );
  const operators = useApiResource<OperatorDirectoryResponse>(
    "/api/platform/operators",
  );
  const registry = flags.state.status === "success" ? flags.state.data : null;
  const operatorItems =
    operators.state.status === "success" ? operators.state.data.items : [];

  return (
    <OperatorShell title="Feature flags">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Feature flag rollouts</h1>
            <p>
              Versioned platform rollout controls with explicit ownership,
              expiry, deterministic targeting, and emergency containment.
            </p>
          </div>
          <Button onClick={flags.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          Flags are temporary rollout controls, not permanent configuration.
          Expired, inactive, or emergency-disabled flags always evaluate to
          disabled before targeting rules are considered.
        </Alert>

        <FeatureFlagEditor onChanged={flags.reload} operators={operatorItems} />
        <EvaluationPreview />

        {flags.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading feature flags…
          </Card>
        ) : null}
        {flags.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{flags.state.error.message}</span>
            <Button onClick={flags.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {registry !== null ? (
          registry.items.length === 0 ? (
            <Card className="empty-card">
              <FlagIcon aria-hidden="true" />
              <h2>No feature flags registered</h2>
              <p>
                Arth receives no rollout decision until an owned flag revision
                is deliberately created and activated here.
              </p>
            </Card>
          ) : (
            <div className="provider-grid">
              {registry.items.map((flag) => (
                <FeatureFlagCard flag={flag} key={flag.id} />
              ))}
            </div>
          )
        ) : null}
      </div>
    </OperatorShell>
  );
}

function FeatureFlagEditor({
  operators,
  onChanged,
}: Readonly<{
  operators: OperatorDirectoryResponse["items"];
  onChanged: () => void;
}>) {
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [ownerOperatorId, setOwnerOperatorId] = useState("");
  const [lifecycle, setLifecycle] =
    useState<PlatformFeatureFlagLifecycle>("draft");
  const [defaultEnabled, setDefaultEnabled] = useState(false);
  const [emergencyDisabled, setEmergencyDisabled] = useState(false);
  const [reviewAt, setReviewAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [rules, setRules] = useState("[]");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const parsedRules = parseRules(rules);
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(`/api/platform/feature-flags/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName,
          purpose,
          ownerOperatorId,
          lifecycle,
          defaultEnabled,
          emergencyDisabled,
          rules: parsedRules,
          reviewAt: toIso(reviewAt, "Review date"),
          expiresAt: expiresAt === "" ? null : toIso(expiresAt, "Expiry date"),
          reason,
        }),
      });
      setReason("");
      setMessage(
        `Feature flag ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The flag was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>Create or revise a flag</CardTitle>
          <CardDescription>
            Reusing a key appends an immutable revision. Rule order is
            significant: the first matching rule decides the result.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Identity and ownership</FieldLegend>
              <div className="feature-flag-editor-grid">
                <TextField
                  id="flag-key"
                  label="Flag key"
                  onChange={setKey}
                  required
                  value={key}
                />
                <TextField
                  id="flag-name"
                  label="Display name"
                  onChange={setDisplayName}
                  required
                  value={displayName}
                />
                <Field>
                  <FieldLabel htmlFor="flag-owner">Owner</FieldLabel>
                  <select
                    className="input"
                    id="flag-owner"
                    onChange={(event) => setOwnerOperatorId(event.target.value)}
                    required
                    value={ownerOperatorId}
                  >
                    <option value="">Select an active operator</option>
                    {operators
                      .filter((operator) => operator.status === "active")
                      .map((operator) => (
                        <option key={operator.id} value={operator.id}>
                          {operator.email}
                        </option>
                      ))}
                  </select>
                  <FieldDescription>
                    Only active Atharvan operators can own a flag.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="flag-lifecycle">Lifecycle</FieldLabel>
                  <select
                    className="input"
                    id="flag-lifecycle"
                    onChange={(event) =>
                      setLifecycle(
                        event.target.value as PlatformFeatureFlagLifecycle,
                      )
                    }
                    value={lifecycle}
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </Field>
                <TextField
                  id="flag-purpose"
                  label="Purpose"
                  onChange={setPurpose}
                  required
                  value={purpose}
                />
                <TextField
                  id="flag-reason"
                  label="Change reason"
                  onChange={setReason}
                  required
                  value={reason}
                />
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Safety and review</FieldLegend>
              <div className="feature-flag-editor-grid">
                <Field>
                  <FieldLabel htmlFor="flag-default">Default result</FieldLabel>
                  <select
                    className="input"
                    id="flag-default"
                    onChange={(event) =>
                      setDefaultEnabled(event.target.value === "enabled")
                    }
                    value={defaultEnabled ? "enabled" : "disabled"}
                  >
                    <option value="disabled">Disabled</option>
                    <option value="enabled">Enabled</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="flag-kill-switch">
                    Emergency kill switch
                  </FieldLabel>
                  <select
                    className="input"
                    id="flag-kill-switch"
                    onChange={(event) =>
                      setEmergencyDisabled(event.target.value === "disabled")
                    }
                    value={emergencyDisabled ? "disabled" : "clear"}
                  >
                    <option value="clear">Clear</option>
                    <option value="disabled">Force disabled</option>
                  </select>
                </Field>
                <TextField
                  id="flag-review-at"
                  label="Review at"
                  onChange={setReviewAt}
                  required
                  type="datetime-local"
                  value={reviewAt}
                />
                <TextField
                  id="flag-expires-at"
                  label="Expires at"
                  onChange={setExpiresAt}
                  type="datetime-local"
                  value={expiresAt}
                />
              </div>
            </FieldSet>

            <Field>
              <FieldLabel htmlFor="flag-rules">Ordered rules (JSON)</FieldLabel>
              <Input
                id="flag-rules"
                onChange={(event) => setRules(event.target.value)}
                required
                value={rules}
              />
              <FieldDescription>
                Each rule declares id, description, enabled, planKeys,
                workspaceIds, userIds, regions, cohorts, internalStaff,
                account-age bounds, and rolloutBasisPoints (0–10000).
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button disabled={pending} type="submit">
            {pending ? "Saving…" : "Save immutable revision"}
          </Button>
          {message === null ? null : <span>{message}</span>}
        </CardFooter>
      </form>
    </Card>
  );
}

function EvaluationPreview() {
  const [key, setKey] = useState("");
  const [stableRoutingKey, setStableRoutingKey] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [region, setRegion] = useState("");
  const [cohorts, setCohorts] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PlatformFeatureFlagEvaluation | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      setResult(
        await apiRequest<PlatformFeatureFlagEvaluation>(
          `/api/platform/feature-flags/${encodeURIComponent(key)}/evaluate`,
          {
            method: "POST",
            body: JSON.stringify({
              stableRoutingKey,
              ...(planKey === "" ? {} : { planKey }),
              ...(region === "" ? {} : { region }),
              cohorts: parseList(cohorts),
            }),
          },
        ),
      );
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Evaluation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>Evaluation preview</CardTitle>
          <CardDescription>
            Preview a deterministic decision without storing the opaque target
            identity or mutating flag state.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="feature-flag-editor-grid">
              <TextField
                id="evaluation-key"
                label="Flag key"
                onChange={setKey}
                required
                value={key}
              />
              <TextField
                id="evaluation-routing-key"
                label="Stable routing key"
                onChange={setStableRoutingKey}
                required
                value={stableRoutingKey}
              />
              <TextField
                id="evaluation-plan"
                label="Plan key"
                onChange={setPlanKey}
                value={planKey}
              />
              <TextField
                id="evaluation-region"
                label="Region"
                onChange={setRegion}
                value={region}
              />
              <TextField
                id="evaluation-cohorts"
                label="Cohorts"
                onChange={setCohorts}
                value={cohorts}
              />
            </div>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button disabled={pending} type="submit" variant="outline">
            <TestTubeDiagonalIcon data-icon="inline-start" />
            {pending ? "Evaluating…" : "Evaluate"}
          </Button>
          {result === null ? null : (
            <span>
              {result.enabled ? "Enabled" : "Disabled"} · {result.reason}
              {result.matchedRuleId === null
                ? ""
                : ` · ${result.matchedRuleId} · bucket ${result.rolloutBucket}`}
            </span>
          )}
          {message === null ? null : <span>{message}</span>}
        </CardFooter>
      </form>
    </Card>
  );
}

function FeatureFlagCard({
  flag,
}: Readonly<{ flag: PlatformFeatureFlagEntry }>) {
  const current = flag.current;
  return (
    <Card>
      <CardHeader>
        <div className="card-title-row">
          <CardTitle>{current.displayName}</CardTitle>
          <Badge variant={current.emergencyDisabled ? "critical" : "neutral"}>
            {current.emergencyDisabled ? "Killed" : current.lifecycle}
          </Badge>
        </div>
        <CardDescription>{flag.key}</CardDescription>
      </CardHeader>
      <CardContent>
        <p>{current.purpose}</p>
        <dl className="adapter-contract-grid">
          <div>
            <dt>Owner</dt>
            <dd>{current.ownerEmail}</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>{formatLabel(flag.freshness)}</dd>
          </div>
          <div>
            <dt>Default</dt>
            <dd>{current.defaultEnabled ? "Enabled" : "Disabled"}</dd>
          </div>
          <div>
            <dt>Rules</dt>
            <dd>{current.rules.length}</dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>{formatDate(current.reviewAt)}</dd>
          </div>
          <div>
            <dt>Expiry</dt>
            <dd>
              {current.expiresAt === null
                ? "None"
                : formatDate(current.expiresAt)}
            </dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{current.revisionNumber}</dd>
          </div>
          <div>
            <dt>History loaded</dt>
            <dd>{flag.recentRevisions.length}</dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter>
        <span>Updated {formatDate(flag.updatedAt)}</span>
      </CardFooter>
    </Card>
  );
}

function TextField({
  id,
  label,
  onChange,
  required = false,
  type = "text",
  value,
}: Readonly<{
  id: string;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
}>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </Field>
  );
}

function parseRules(value: string): ReadonlyArray<PlatformFeatureFlagRule> {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("Rules must be a JSON array.");
  return parsed as ReadonlyArray<PlatformFeatureFlagRule>;
}

function toIso(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function parseList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}
