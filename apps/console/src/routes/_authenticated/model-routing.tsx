import {
  FlaskConicalIcon,
  PlusIcon,
  RefreshCwIcon,
  RouteIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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
  type ModelProviderCatalogueResponse,
  type ModelRoutingOperationsResponse,
  useApiResource,
} from "@/lib/api";
import type {
  ModelCapability,
  ModelRoutingControlState,
  ModelRoutingDecision,
  ModelRoutingOperationalControl,
  ModelRoutingPolicyEntry,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/model-routing")({
  component: ModelRoutingPage,
});

const capabilityOptions: ReadonlyArray<{
  readonly value: ModelCapability;
  readonly label: string;
}> = [
  { value: "text_generation", label: "Text generation" },
  { value: "code_generation", label: "Code generation" },
  { value: "reasoning", label: "Reasoning" },
  { value: "vision", label: "Vision" },
  { value: "tool_use", label: "Tool use" },
  { value: "structured_output", label: "Structured output" },
  { value: "embeddings", label: "Embeddings" },
];

interface ModelOption {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly providerId: string;
  readonly providerKey: string;
  readonly providerDisplayName: string;
}

interface ControlTarget {
  readonly kind: "provider" | "model";
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly providerKey: string;
}

function ModelRoutingPage() {
  const catalogue = useApiResource<ModelProviderCatalogueResponse>(
    "/api/platform/model-catalogue",
  );
  const routing = useApiResource<ModelRoutingOperationsResponse>(
    "/api/platform/model-routing",
  );
  const providers =
    catalogue.state.status === "success" ? catalogue.state.data.items : [];
  const operations =
    routing.state.status === "success" ? routing.state.data : null;
  const modelOptions = useMemo<ModelOption[]>(
    () =>
      providers.flatMap((provider) =>
        provider.models.map((model) => ({
          id: model.id,
          key: model.key,
          displayName: model.displayName,
          providerId: provider.id,
          providerKey: provider.key,
          providerDisplayName: provider.displayName,
        })),
      ),
    [providers],
  );
  const controlTargets = useMemo<ControlTarget[]>(
    () =>
      providers.flatMap((provider) => [
        {
          kind: "provider" as const,
          id: provider.id,
          key: provider.key,
          displayName: provider.displayName,
          providerKey: provider.key,
        },
        ...provider.models.map((model) => ({
          kind: "model" as const,
          id: model.id,
          key: model.key,
          displayName: model.displayName,
          providerKey: provider.key,
        })),
      ]),
    [providers],
  );

  function reload() {
    catalogue.reload();
    routing.reload();
  }

  return (
    <OperatorShell title="Model routing">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Routing and containment</h1>
            <p>
              Versioned task policies, deterministic rollouts, ordered
              fallbacks, maintenance windows, and immediate kill switches.
            </p>
          </div>
          <Button onClick={reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />A route is eligible only when
          both provider and model are explicitly enabled, catalogue metadata is
          active, credentials are available, health evidence is fresh, and the
          request matches the policy.
        </Alert>

        {catalogue.state.status === "error" ? (
          <Alert variant="destructive">{catalogue.state.error.message}</Alert>
        ) : null}
        {routing.state.status === "error" ? (
          <Alert variant="destructive">{routing.state.error.message}</Alert>
        ) : null}

        <div className="routing-editor-grid">
          <PolicyEditor models={modelOptions} onChanged={routing.reload} />
          <RoutePreview policies={operations?.policies ?? []} />
        </div>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Operational controls</CardTitle>
              <CardDescription>
                Unconfigured targets are ineligible. Maintenance expires to
                enabled; disabled targets require an explicit audited re-enable.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {catalogue.state.status === "loading" ||
            routing.state.status === "loading" ? (
              <p className="muted-copy">Loading operational controls…</p>
            ) : controlTargets.length === 0 ? (
              <p className="muted-copy">
                Register real providers and models before configuring routes.
              </p>
            ) : (
              <div className="routing-control-list">
                {controlTargets.map((target) => {
                  const control = operations?.controls.find(
                    (entry) =>
                      entry.targetKind === target.kind &&
                      entry.targetId === target.id,
                  );
                  return (
                    <ControlEditor
                      {...(control === undefined ? {} : { control })}
                      key={`${target.kind}:${target.id}`}
                      onChanged={routing.reload}
                      target={target}
                    />
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Current routing policies</CardTitle>
              <CardDescription>
                Candidate order is fallback order. Percentage gates are stable
                for the supplied routing key.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {routing.state.status === "loading" ? (
              <p className="muted-copy">Loading routing policies…</p>
            ) : operations === null || operations.policies.length === 0 ? (
              <p className="muted-copy">
                No routing policy has been published for this environment.
              </p>
            ) : (
              <div className="routing-policy-list">
                {operations.policies.map((policy) => (
                  <PolicyCard key={policy.id} policy={policy} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </OperatorShell>
  );
}

function PolicyEditor({
  models,
  onChanged,
}: Readonly<{ models: ReadonlyArray<ModelOption>; onChanged: () => void }>) {
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requiredCapabilities, setRequiredCapabilities] = useState<
    ReadonlyArray<ModelCapability>
  >(["code_generation"]);
  const [maximumDataClassification, setMaximumDataClassification] =
    useState("internal");
  const [allowedRegions, setAllowedRegions] = useState("global");
  const [targets, setTargets] = useState([
    { modelId: "", rolloutPercentage: "100", allowDegraded: false },
  ]);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggleCapability(capability: ModelCapability) {
    setRequiredCapabilities((current) =>
      current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability],
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(`/api/platform/model-routing/policies/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName,
          requiredCapabilities,
          maximumDataClassification,
          allowedRegions: parseList(allowedRegions),
          targets: targets.map((target) => ({
            modelId: target.modelId,
            rolloutBasisPoints: Math.round(
              Number(target.rolloutPercentage) * 100,
            ),
            allowDegraded: target.allowDegraded,
          })),
          reason,
        }),
      });
      setReason("");
      setMessage(
        `Policy ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The routing policy was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <RouteIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Set routing policy</CardTitle>
          <CardDescription>
            Reuse a policy key to append a revision. Candidate order defines
            primary and fallback priority.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="routing-policy-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <Field>
              <FieldLabel htmlFor="routing-policy-key">Policy key</FieldLabel>
              <Input
                id="routing-policy-key"
                onChange={(event) => setKey(event.target.value)}
                pattern="[a-z][a-z0-9_]{2,63}"
                placeholder="code_generation"
                required
                value={key}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="routing-policy-name">Name</FieldLabel>
              <Input
                id="routing-policy-name"
                maxLength={120}
                minLength={2}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Code generation"
                required
                value={displayName}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="routing-policy-classification">
                Maximum request classification
              </FieldLabel>
              <select
                className="input"
                id="routing-policy-classification"
                onChange={(event) =>
                  setMaximumDataClassification(event.target.value)
                }
                value={maximumDataClassification}
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="routing-policy-regions">
                Allowed regions
              </FieldLabel>
              <Input
                id="routing-policy-regions"
                onChange={(event) => setAllowedRegions(event.target.value)}
                required
                value={allowedRegions}
              />
            </Field>
            <FieldSet className="field-span">
              <FieldLegend>Required capabilities</FieldLegend>
              <div className="capability-options">
                {capabilityOptions.map((option) => (
                  <label className="check-option" key={option.value}>
                    <input
                      checked={requiredCapabilities.includes(option.value)}
                      onChange={() => toggleCapability(option.value)}
                      type="checkbox"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </FieldSet>
            <FieldSet className="field-span">
              <FieldLegend>Ordered candidate chain</FieldLegend>
              <FieldDescription>
                Rollout accepts 0.01–100%. At least one fallback should normally
                cover 100%.
              </FieldDescription>
              <div className="routing-target-list">
                {targets.map((target, index) => (
                  <div className="routing-target-row" key={index}>
                    <span className="routing-priority">{index + 1}</span>
                    <select
                      aria-label={`Candidate ${index + 1} model`}
                      className="input"
                      onChange={(event) =>
                        setTargets((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, modelId: event.target.value }
                              : item,
                          ),
                        )
                      }
                      required
                      value={target.modelId}
                    >
                      <option value="">Select model</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.providerDisplayName} / {model.displayName}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`Candidate ${index + 1} rollout percentage`}
                      max="100"
                      min="0.01"
                      onChange={(event) =>
                        setTargets((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  rolloutPercentage: event.target.value,
                                }
                              : item,
                          ),
                        )
                      }
                      required
                      step="0.01"
                      type="number"
                      value={target.rolloutPercentage}
                    />
                    <label className="check-option compact-check">
                      <input
                        checked={target.allowDegraded}
                        onChange={(event) =>
                          setTargets((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    allowDegraded: event.target.checked,
                                  }
                                : item,
                            ),
                          )
                        }
                        type="checkbox"
                      />
                      <span>Allow degraded</span>
                    </label>
                    <Button
                      aria-label={`Remove candidate ${index + 1}`}
                      disabled={targets.length === 1}
                      onClick={() =>
                        setTargets((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      type="button"
                      variant="outline"
                    >
                      <Trash2Icon data-icon="inline-start" /> Remove
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                disabled={targets.length >= 16}
                onClick={() =>
                  setTargets((current) => [
                    ...current,
                    {
                      modelId: "",
                      rolloutPercentage: "100",
                      allowDegraded: false,
                    },
                  ])
                }
                type="button"
                variant="outline"
              >
                <PlusIcon data-icon="inline-start" /> Add fallback
              </Button>
            </FieldSet>
            <Field className="field-span">
              <FieldLabel htmlFor="routing-policy-reason">
                Audit reason
              </FieldLabel>
              <Input
                id="routing-policy-reason"
                minLength={8}
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button
          disabled={pending || models.length === 0}
          form="routing-policy-form"
          type="submit"
        >
          {pending ? "Saving…" : "Set policy revision"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ControlEditor({
  target,
  control,
  onChanged,
}: Readonly<{
  target: ControlTarget;
  control?: ModelRoutingOperationalControl;
  onChanged: () => void;
}>) {
  const [state, setState] = useState<ModelRoutingControlState>(
    control?.configuredState ?? "enabled",
  );
  const [maintenanceExpiresAt, setMaintenanceExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiRequest(
        `/api/platform/model-routing/controls/${target.kind}/${encodeURIComponent(target.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            state,
            maintenanceExpiresAt:
              state === "maintenance"
                ? new Date(maintenanceExpiresAt).toISOString()
                : null,
            reason,
          }),
        },
      );
      setReason("");
      setMessage("Control revision saved.");
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The control was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="routing-control-row" onSubmit={submit}>
      <div className="routing-control-target">
        <div className="routing-control-title">
          <strong>{target.displayName}</strong>
          <Badge variant={target.kind === "provider" ? "warning" : "neutral"}>
            {target.kind}
          </Badge>
          <Badge variant={controlVariant(control?.effectiveState)}>
            {control?.effectiveState ?? "unconfigured"}
          </Badge>
        </div>
        <span>
          {target.providerKey} / {target.key}
        </span>
      </div>
      <select
        aria-label={`${target.displayName} operational state`}
        className="input"
        onChange={(event) =>
          setState(event.target.value as ModelRoutingControlState)
        }
        value={state}
      >
        <option value="enabled">Enabled</option>
        <option value="maintenance">Maintenance</option>
        <option value="disabled">Disabled</option>
      </select>
      <Input
        aria-label={`${target.displayName} maintenance expiry`}
        disabled={state !== "maintenance"}
        onChange={(event) => setMaintenanceExpiresAt(event.target.value)}
        required={state === "maintenance"}
        type="datetime-local"
        value={maintenanceExpiresAt}
      />
      <Input
        aria-label={`${target.displayName} audit reason`}
        minLength={8}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Audit reason"
        required
        value={reason}
      />
      <Button disabled={pending} type="submit" variant="outline">
        {pending ? "Saving…" : "Apply"}
      </Button>
      {message ? (
        <span className="routing-control-message">{message}</span>
      ) : null}
    </form>
  );
}

function RoutePreview({
  policies,
}: Readonly<{ policies: ReadonlyArray<ModelRoutingPolicyEntry> }>) {
  const [policyKey, setPolicyKey] = useState("");
  const [stableRoutingKey, setStableRoutingKey] = useState("");
  const [requiredCapabilities, setRequiredCapabilities] = useState("");
  const [dataClassification, setDataClassification] = useState("internal");
  const [region, setRegion] = useState("global");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ModelRoutingDecision | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      setResult(
        await apiRequest<ModelRoutingDecision>(
          "/api/platform/model-routing/preview",
          {
            method: "POST",
            body: JSON.stringify({
              policyKey,
              stableRoutingKey,
              requiredCapabilities: parseList(requiredCapabilities),
              dataClassification,
              region,
            }),
          },
        ),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The route was not evaluated.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <FlaskConicalIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Preview a route</CardTitle>
          <CardDescription>
            Read-only evaluation against current policy, controls, credentials,
            and provider-health evidence.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert variant="destructive">{message}</Alert> : null}
        <form id="route-preview-form" onSubmit={submit}>
          <FieldGroup className="admin-form single-column-form">
            <Field>
              <FieldLabel htmlFor="preview-policy">Policy</FieldLabel>
              <select
                className="input"
                id="preview-policy"
                onChange={(event) => setPolicyKey(event.target.value)}
                required
                value={policyKey}
              >
                <option value="">Select policy</option>
                {policies.map((policy) => (
                  <option key={policy.id} value={policy.key}>
                    {policy.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-routing-key">
                Stable routing key
              </FieldLabel>
              <Input
                id="preview-routing-key"
                onChange={(event) => setStableRoutingKey(event.target.value)}
                placeholder="request or trace identifier"
                required
                value={stableRoutingKey}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-capabilities">
                Additional capabilities
              </FieldLabel>
              <Input
                id="preview-capabilities"
                onChange={(event) =>
                  setRequiredCapabilities(event.target.value)
                }
                placeholder="reasoning, tool_use"
                value={requiredCapabilities}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-classification">
                Data classification
              </FieldLabel>
              <select
                className="input"
                id="preview-classification"
                onChange={(event) => setDataClassification(event.target.value)}
                value={dataClassification}
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="preview-region">Region</FieldLabel>
              <Input
                id="preview-region"
                onChange={(event) => setRegion(event.target.value)}
                required
                value={region}
              />
            </Field>
          </FieldGroup>
        </form>
        {result ? <RoutingDecisionView result={result} /> : null}
      </CardContent>
      <CardFooter>
        <Button
          disabled={pending || policies.length === 0}
          form="route-preview-form"
          type="submit"
        >
          {pending ? "Evaluating…" : "Evaluate route"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function RoutingDecisionView({
  result,
}: Readonly<{ result: ModelRoutingDecision }>) {
  return (
    <div className="routing-decision">
      <div className="routing-control-title">
        <strong>
          {result.outcome === "selected"
            ? `${result.providerKey} / ${result.modelKey}`
            : "No eligible route"}
        </strong>
        <Badge variant={result.outcome === "selected" ? "success" : "critical"}>
          {result.outcome}
        </Badge>
      </div>
      {result.outcome === "unavailable" ? <p>{result.reason}</p> : null}
      <ol className="routing-evaluations">
        {result.evaluations.map((evaluation) => (
          <li key={evaluation.targetId}>
            Priority {evaluation.priority}:{" "}
            {evaluation.accepted ? "selected" : evaluation.reason}
            {` · bucket ${evaluation.rolloutBucket}`}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PolicyCard({ policy }: Readonly<{ policy: ModelRoutingPolicyEntry }>) {
  return (
    <article className="routing-policy-card">
      <div className="routing-control-title">
        <strong>{policy.displayName}</strong>
        <Badge variant="neutral">{policy.key}</Badge>
        <Badge variant="neutral">rev {policy.revisionNumber}</Badge>
      </div>
      <p>
        {policy.requiredCapabilities.join(", ")} · up to{" "}
        {policy.maximumDataClassification}
        {` · ${policy.allowedRegions.join(", ")}`}
      </p>
      <ol className="routing-policy-targets">
        {policy.targets.map((target) => (
          <li key={target.id}>
            <strong>
              {target.providerDisplayName} / {target.modelDisplayName}
            </strong>
            <span>
              {(target.rolloutBasisPoints / 100).toFixed(2)}%
              {target.allowDegraded ? " · degraded allowed" : ""}
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function controlVariant(state: string | undefined) {
  if (state === "enabled") return "success" as const;
  if (state === "maintenance") return "warning" as const;
  if (state === "disabled") return "critical" as const;
  return "neutral" as const;
}
