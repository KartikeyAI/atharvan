import {
  BotIcon,
  CircleGaugeIcon,
  DatabaseZapIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
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
  type ModelProviderCatalogueResponse,
  type PlatformSecretReferencesResponse,
  useApiResource,
} from "@/lib/api";
import type {
  ModelCapability,
  ModelCatalogueEntry,
  ModelProviderCatalogueEntry,
  PlatformSecretReferenceEntry,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/models")({
  component: ModelsPage,
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
const priceFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

function ModelsPage() {
  const catalogue = useApiResource<ModelProviderCatalogueResponse>(
    "/api/platform/model-catalogue",
  );
  const secrets = useApiResource<PlatformSecretReferencesResponse>(
    "/api/platform/secret-references",
  );
  const registry =
    catalogue.state.status === "success" ? catalogue.state.data : null;
  const secretReferences =
    secrets.state.status === "success"
      ? secrets.state.data.items.filter((item) => item.status === "active")
      : [];

  return (
    <OperatorShell title="Models">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Model catalogue</h1>
            <p>
              Versioned provider and model metadata with expiring operational
              health evidence.
            </p>
          </div>
          <Button onClick={catalogue.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          Provider health remains unknown without an observation and becomes
          stale five minutes after the latest evidence. Routing and kill
          switches are intentionally not part of this catalogue.
        </Alert>

        <div className="model-editor-grid">
          <ProviderEditor
            onChanged={catalogue.reload}
            secretReferences={secretReferences}
            secretSelectionAvailable={secrets.state.status === "success"}
          />
          <ModelEditor
            onChanged={catalogue.reload}
            providers={registry?.items ?? []}
          />
        </div>

        {catalogue.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading model catalogue…
          </Card>
        ) : null}
        {catalogue.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{catalogue.state.error.message}</span>
            <Button onClick={catalogue.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {registry !== null ? (
          registry.items.length === 0 ? (
            <Card className="empty-card">
              <BotIcon aria-hidden="true" />
              <h2>No providers registered</h2>
              <p>The development model catalogue has no real entries yet.</p>
            </Card>
          ) : (
            <div className="provider-grid">
              {registry.items.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}
            </div>
          )
        ) : null}
      </div>
    </OperatorShell>
  );
}

function ProviderEditor({
  secretReferences,
  secretSelectionAvailable,
  onChanged,
}: Readonly<{
  secretReferences: ReadonlyArray<PlatformSecretReferenceEntry>;
  secretSelectionAvailable: boolean;
  onChanged: () => void;
}>) {
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [adapterKind, setAdapterKind] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [credentialReferenceId, setCredentialReferenceId] = useState("");
  const [regions, setRegions] = useState("global");
  const [maximumDataClassification, setMaximumDataClassification] =
    useState("internal");
  const [lifecycle, setLifecycle] = useState("draft");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(`/api/platform/model-providers/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName,
          adapterKind,
          baseUrl: baseUrl.trim() === "" ? null : baseUrl,
          ...(secretSelectionAvailable
            ? {
                credentialReferenceId:
                  credentialReferenceId === "" ? null : credentialReferenceId,
              }
            : {}),
          regions: parseList(regions),
          maximumDataClassification,
          lifecycle,
          reason,
        }),
      });
      setReason("");
      setMessage(
        `Provider ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The provider was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <DatabaseZapIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Set provider revision</CardTitle>
          <CardDescription>
            Reusing a provider key creates a new immutable revision only when
            metadata changed.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="provider-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <Field>
              <FieldLabel htmlFor="provider-key">Provider key</FieldLabel>
              <Input
                id="provider-key"
                onChange={(event) => setKey(event.target.value)}
                pattern="[a-z][a-z0-9_-]{1,63}"
                placeholder="openai"
                required
                value={key}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-name">Display name</FieldLabel>
              <Input
                id="provider-name"
                maxLength={120}
                minLength={2}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="OpenAI"
                required
                value={displayName}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-adapter">Adapter</FieldLabel>
              <select
                className="input"
                id="provider-adapter"
                onChange={(event) => setAdapterKind(event.target.value)}
                value={adapterKind}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
                <option value="azure_openai">Azure OpenAI</option>
                <option value="openai_compatible">OpenAI compatible</option>
                <option value="self_hosted">Self-hosted</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-base-url">
                HTTPS base URL
              </FieldLabel>
              <Input
                id="provider-base-url"
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://api.example.com/v1"
                type="url"
                value={baseUrl}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-secret">
                Credential reference
              </FieldLabel>
              <select
                className="input"
                disabled={!secretSelectionAvailable}
                id="provider-secret"
                onChange={(event) =>
                  setCredentialReferenceId(event.target.value)
                }
                value={credentialReferenceId}
              >
                <option value="">No credential</option>
                {secretReferences.map((reference) => (
                  <option key={reference.id} value={reference.id}>
                    {reference.key}
                  </option>
                ))}
              </select>
              <FieldDescription>
                {secretSelectionAvailable
                  ? "Only active development references are selectable."
                  : "Credential changes are unavailable; an existing binding is preserved."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-regions">Regions</FieldLabel>
              <Input
                id="provider-regions"
                onChange={(event) => setRegions(event.target.value)}
                placeholder="global, us, eu"
                required
                value={regions}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="provider-classification">
                Maximum data classification
              </FieldLabel>
              <select
                className="input"
                id="provider-classification"
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
              <FieldLabel htmlFor="provider-lifecycle">Lifecycle</FieldLabel>
              <select
                className="input"
                id="provider-lifecycle"
                onChange={(event) => setLifecycle(event.target.value)}
                value={lifecycle}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="deprecated">Deprecated</option>
              </select>
            </Field>
            <Field className="field-span">
              <FieldLabel htmlFor="provider-reason">Audit reason</FieldLabel>
              <Input
                id="provider-reason"
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
        <Button disabled={pending} form="provider-form" type="submit">
          {pending ? "Saving…" : "Set provider revision"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ModelEditor({
  providers,
  onChanged,
}: Readonly<{
  providers: ReadonlyArray<ModelProviderCatalogueEntry>;
  onChanged: () => void;
}>) {
  const [providerId, setProviderId] = useState("");
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [kind, setKind] = useState<"generation" | "embedding">("generation");
  const [capabilities, setCapabilities] = useState<
    ReadonlyArray<ModelCapability>
  >(["text_generation"]);
  const [contextWindowTokens, setContextWindowTokens] = useState("128000");
  const [maximumOutputTokens, setMaximumOutputTokens] = useState("8192");
  const [inputPrice, setInputPrice] = useState("0");
  const [outputPrice, setOutputPrice] = useState("0");
  const [regions, setRegions] = useState("global");
  const [maximumDataClassification, setMaximumDataClassification] =
    useState("internal");
  const [lifecycle, setLifecycle] = useState("draft");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeKind(nextKind: "generation" | "embedding") {
    setKind(nextKind);
    if (nextKind === "embedding") {
      setCapabilities(["embeddings"]);
      setMaximumOutputTokens("");
    } else {
      setCapabilities(["text_generation"]);
      setMaximumOutputTokens("8192");
    }
  }

  function toggleCapability(capability: ModelCapability) {
    setCapabilities((current) =>
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
      }>(
        `/api/platform/model-providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            displayName,
            kind,
            capabilities,
            contextWindowTokens: Number(contextWindowTokens),
            maximumOutputTokens:
              kind === "embedding" ? null : Number(maximumOutputTokens),
            inputPriceMicrounitsPerMillion: dollarsToMicrounits(inputPrice),
            outputPriceMicrounitsPerMillion: dollarsToMicrounits(outputPrice),
            regions: parseList(regions),
            maximumDataClassification,
            lifecycle,
            reason,
          }),
        },
      );
      setReason("");
      setMessage(
        `Model ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The model was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <BotIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Set model revision</CardTitle>
          <CardDescription>
            Prices are entered as USD per one million tokens and stored as
            integer microunits.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="model-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <Field>
              <FieldLabel htmlFor="model-provider">Provider</FieldLabel>
              <select
                className="input"
                id="model-provider"
                onChange={(event) => setProviderId(event.target.value)}
                required
                value={providerId}
              >
                <option value="">Select a provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="model-key">Provider model ID</FieldLabel>
              <Input
                id="model-key"
                onChange={(event) => setKey(event.target.value)}
                placeholder="gpt-5.6"
                required
                value={key}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-name">Display name</FieldLabel>
              <Input
                id="model-name"
                minLength={2}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-kind">Kind</FieldLabel>
              <select
                className="input"
                id="model-kind"
                onChange={(event) =>
                  changeKind(event.target.value as "generation" | "embedding")
                }
                value={kind}
              >
                <option value="generation">Generation</option>
                <option value="embedding">Embedding</option>
              </select>
            </Field>
            <FieldSet className="field-span">
              <FieldLegend>Capabilities</FieldLegend>
              <div className="capability-choice-grid">
                {capabilityOptions.map((option) => {
                  const disabled =
                    kind === "embedding" && option.value !== "embeddings";
                  return (
                    <Field className="checkbox-row" key={option.value}>
                      <input
                        checked={capabilities.includes(option.value)}
                        disabled={disabled}
                        id={`model-capability-${option.value}`}
                        onChange={() => toggleCapability(option.value)}
                        type="checkbox"
                      />
                      <FieldLabel htmlFor={`model-capability-${option.value}`}>
                        {option.label}
                      </FieldLabel>
                    </Field>
                  );
                })}
              </div>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="model-context">Context tokens</FieldLabel>
              <Input
                id="model-context"
                min={1}
                onChange={(event) => setContextWindowTokens(event.target.value)}
                required
                type="number"
                value={contextWindowTokens}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-output">
                Maximum output tokens
              </FieldLabel>
              <Input
                disabled={kind === "embedding"}
                id="model-output"
                min={1}
                onChange={(event) => setMaximumOutputTokens(event.target.value)}
                required={kind === "generation"}
                type="number"
                value={maximumOutputTokens}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-input-price">
                Input USD / 1M
              </FieldLabel>
              <Input
                id="model-input-price"
                min={0}
                onChange={(event) => setInputPrice(event.target.value)}
                required
                step="0.000001"
                type="number"
                value={inputPrice}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-output-price">
                Output USD / 1M
              </FieldLabel>
              <Input
                id="model-output-price"
                min={0}
                onChange={(event) => setOutputPrice(event.target.value)}
                required
                step="0.000001"
                type="number"
                value={outputPrice}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-regions">Regions</FieldLabel>
              <Input
                id="model-regions"
                onChange={(event) => setRegions(event.target.value)}
                required
                value={regions}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="model-classification">
                Maximum data classification
              </FieldLabel>
              <select
                className="input"
                id="model-classification"
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
              <FieldLabel htmlFor="model-lifecycle">Lifecycle</FieldLabel>
              <select
                className="input"
                id="model-lifecycle"
                onChange={(event) => setLifecycle(event.target.value)}
                value={lifecycle}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="deprecated">Deprecated</option>
              </select>
            </Field>
            <Field className="field-span">
              <FieldLabel htmlFor="model-reason">Audit reason</FieldLabel>
              <Input
                id="model-reason"
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
          disabled={pending || providers.length === 0}
          form="model-form"
          type="submit"
        >
          {pending ? "Saving…" : "Set model revision"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProviderCard({
  provider,
}: Readonly<{ provider: ModelProviderCatalogueEntry }>) {
  return (
    <Card className="provider-card">
      <CardHeader className="table-card-header">
        <div>
          <CardTitle>{provider.displayName}</CardTitle>
          <CardDescription>
            {provider.key} · {formatAdapter(provider.adapterKind)}
          </CardDescription>
        </div>
        <Badge variant={healthVariant(provider.health.state)}>
          <CircleGaugeIcon aria-hidden="true" /> {provider.health.state}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="configuration-values">
          <div>
            <dt>Lifecycle</dt>
            <dd>{provider.lifecycle}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{provider.revisionNumber}</dd>
          </div>
          <div>
            <dt>Credential</dt>
            <dd>{provider.credentialReferenceKey ?? "None"}</dd>
          </div>
          <div>
            <dt>Maximum data</dt>
            <dd>{provider.maximumDataClassification}</dd>
          </div>
          <div>
            <dt>Regions</dt>
            <dd>{provider.regions.join(", ")}</dd>
          </div>
          <div>
            <dt>Health evidence</dt>
            <dd>
              {provider.health.observedAt
                ? new Date(provider.health.observedAt).toLocaleString()
                : "Never observed"}
            </dd>
          </div>
        </dl>
        {provider.models.length === 0 ? (
          <div className="inline-empty">No models registered.</div>
        ) : (
          <div className="model-list">
            {provider.models.map((model) => (
              <ModelRow key={model.id} model={model} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModelRow({ model }: Readonly<{ model: ModelCatalogueEntry }>) {
  return (
    <article className="model-row">
      <div className="model-row-heading">
        <div>
          <strong>{model.displayName}</strong>
          <code>{model.key}</code>
        </div>
        <div className="model-badges">
          <Badge>{model.kind}</Badge>
          <Badge variant={model.lifecycle === "active" ? "success" : "neutral"}>
            {model.lifecycle}
          </Badge>
        </div>
      </div>
      <div className="capability-list">
        {model.capabilities.map((capability) => (
          <code key={capability}>{capability}</code>
        ))}
      </div>
      <dl className="model-metrics">
        <div>
          <dt>Context</dt>
          <dd>{model.contextWindowTokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Input / 1M</dt>
          <dd>{formatPrice(model.inputPriceMicrounitsPerMillion)}</dd>
        </div>
        <div>
          <dt>Output / 1M</dt>
          <dd>{formatPrice(model.outputPriceMicrounitsPerMillion)}</dd>
        </div>
      </dl>
    </article>
  );
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dollarsToMicrounits(value: string) {
  return Math.round(Number(value) * 1_000_000);
}

function formatPrice(microunits: number) {
  return priceFormatter.format(microunits / 1_000_000);
}

function formatAdapter(value: string) {
  return value.replaceAll("_", " ");
}

function healthVariant(status: string) {
  if (status === "healthy") return "success" as const;
  if (status === "degraded" || status === "stale") return "warning" as const;
  if (status === "unavailable") return "critical" as const;
  return "neutral" as const;
}
