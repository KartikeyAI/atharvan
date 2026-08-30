import {
  CableIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  WaypointsIcon,
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
  type PlatformIntegrationRegistryResponse,
  type PlatformSecretReferencesResponse,
  useApiResource,
} from "@/lib/api";
import type {
  PlatformIntegrationCapability,
  PlatformIntegrationRegistryEntry,
  PlatformSecretReferenceEntry,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

const capabilityOptions: ReadonlyArray<{
  readonly value: PlatformIntegrationCapability;
  readonly label: string;
}> = [
  { value: "source_control", label: "Source control" },
  { value: "deployment", label: "Deployment" },
  { value: "database", label: "Database" },
  { value: "authentication", label: "Authentication" },
  { value: "observability", label: "Observability" },
  { value: "billing", label: "Billing" },
  { value: "notifications", label: "Notifications" },
  { value: "design", label: "Design" },
];

function IntegrationsPage() {
  const integrations = useApiResource<PlatformIntegrationRegistryResponse>(
    "/api/platform/integrations",
  );
  const secrets = useApiResource<PlatformSecretReferencesResponse>(
    "/api/platform/secret-references",
  );
  const registry =
    integrations.state.status === "success" ? integrations.state.data : null;
  const secretReferences =
    secrets.state.status === "success"
      ? secrets.state.data.items.filter((item) => item.status === "active")
      : [];

  return (
    <OperatorShell title="Integrations">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Platform integrations</h1>
            <p>
              Environment-specific OAuth applications, adapter contracts, and
              expiring health evidence.
            </p>
          </div>
          <Button onClick={integrations.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          This registry contains Arth platform application metadata only. It
          never exposes customer tokens, installations, repositories, code,
          secrets, integrations, or environments.
        </Alert>

        <IntegrationEditor
          onChanged={integrations.reload}
          secretReferences={secretReferences}
          secretSelectionAvailable={secrets.state.status === "success"}
        />

        {integrations.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading integration registry…
          </Card>
        ) : null}
        {integrations.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{integrations.state.error.message}</span>
            <Button
              onClick={integrations.reload}
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </Alert>
        ) : null}
        {registry !== null ? (
          registry.items.length === 0 ? (
            <Card className="empty-card">
              <CableIcon aria-hidden="true" />
              <h2>No platform integrations registered</h2>
              <p>No provider is inferred from code or environment variables.</p>
            </Card>
          ) : (
            <div className="provider-grid">
              {registry.items.map((integration) => (
                <IntegrationCard
                  integration={integration}
                  key={integration.id}
                  onChanged={integrations.reload}
                />
              ))}
            </div>
          )
        ) : null}
      </div>
    </OperatorShell>
  );
}

function IntegrationEditor({
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
  const [protocol, setProtocol] = useState("oauth2");
  const [connectionMode, setConnectionMode] = useState("direct");
  const [capabilities, setCapabilities] = useState<
    ReadonlyArray<PlatformIntegrationCapability>
  >(["source_control"]);
  const [adapterPackage, setAdapterPackage] = useState("@arth/");
  const [adapterVersion, setAdapterVersion] = useState("1.0.0");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecretReferenceId, setClientSecretReferenceId] = useState("");
  const [webhookSecretReferenceId, setWebhookSecretReferenceId] = useState("");
  const [callbackUrls, setCallbackUrls] = useState("");
  const [requiredScopes, setRequiredScopes] = useState("");
  const [optionalScopes, setOptionalScopes] = useState("");
  const [lifecycle, setLifecycle] = useState("draft");
  const [operationalState, setOperationalState] = useState("disabled");
  const [maintenanceExpiresAt, setMaintenanceExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggleCapability(capability: PlatformIntegrationCapability) {
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
    const oauth = protocol === "oauth2";
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(`/api/platform/integrations/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          displayName,
          protocol,
          connectionMode,
          capabilities,
          adapterPackage,
          adapterVersion,
          documentationUrl: emptyToNull(documentationUrl),
          authorizationUrl: oauth ? emptyToNull(authorizationUrl) : null,
          tokenUrl: oauth ? emptyToNull(tokenUrl) : null,
          clientId: oauth ? emptyToNull(clientId) : null,
          ...(secretSelectionAvailable
            ? {
                clientSecretReferenceId: emptyToNull(clientSecretReferenceId),
                webhookSecretReferenceId: emptyToNull(webhookSecretReferenceId),
              }
            : {}),
          callbackUrls: oauth ? parseList(callbackUrls) : [],
          requiredScopes: oauth ? parseList(requiredScopes) : [],
          optionalScopes: oauth ? parseList(optionalScopes) : [],
          lifecycle,
          operationalState,
          maintenanceExpiresAt:
            operationalState === "maintenance"
              ? emptyToNull(maintenanceExpiresAt)
              : null,
          reason,
        }),
      });
      setReason("");
      setMessage(
        `Integration ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The integration revision was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <WaypointsIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Set integration revision</CardTitle>
          <CardDescription>
            Existing keys append immutable revisions. Secret selectors bind
            metadata references; values are never readable here.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="integration-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <Field>
              <FieldLabel htmlFor="integration-key">Integration key</FieldLabel>
              <Input
                id="integration-key"
                onChange={(event) => setKey(event.target.value)}
                pattern="[a-z][a-z0-9_-]{1,63}"
                placeholder="github"
                required
                value={key}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-name">Display name</FieldLabel>
              <Input
                id="integration-name"
                minLength={2}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="GitHub"
                required
                value={displayName}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-protocol">Protocol</FieldLabel>
              <select
                className="input"
                id="integration-protocol"
                onChange={(event) => setProtocol(event.target.value)}
                value={protocol}
              >
                <option value="oauth2">OAuth 2.0</option>
                <option value="api_key">API key</option>
                <option value="service_account">Service account</option>
                <option value="webhook">Webhook</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-mode">
                Connection mode
              </FieldLabel>
              <select
                className="input"
                id="integration-mode"
                onChange={(event) => setConnectionMode(event.target.value)}
                value={connectionMode}
              >
                <option value="direct">Direct</option>
                <option value="managed">Managed</option>
                <option value="claimable">Claimable</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-adapter">
                Adapter package
              </FieldLabel>
              <Input
                id="integration-adapter"
                onChange={(event) => setAdapterPackage(event.target.value)}
                placeholder="@arth/github"
                required
                value={adapterPackage}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-version">
                Adapter version
              </FieldLabel>
              <Input
                id="integration-version"
                onChange={(event) => setAdapterVersion(event.target.value)}
                pattern="[0-9]+\.[0-9]+\.[0-9]+.*"
                required
                value={adapterVersion}
              />
            </Field>
            <FieldSet className="field-span">
              <FieldLegend>Declared capabilities</FieldLegend>
              <div className="capability-choice-grid">
                {capabilityOptions.map((option) => (
                  <Field className="checkbox-row" key={option.value}>
                    <input
                      checked={capabilities.includes(option.value)}
                      id={`integration-capability-${option.value}`}
                      onChange={() => toggleCapability(option.value)}
                      type="checkbox"
                    />
                    <FieldLabel
                      htmlFor={`integration-capability-${option.value}`}
                    >
                      {option.label}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
            <Field className="field-span">
              <FieldLabel htmlFor="integration-docs">
                Documentation URL
              </FieldLabel>
              <Input
                id="integration-docs"
                onChange={(event) => setDocumentationUrl(event.target.value)}
                placeholder="https://docs.example.com/oauth"
                type="url"
                value={documentationUrl}
              />
            </Field>
            {protocol === "oauth2" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="integration-auth-url">
                    Authorization URL
                  </FieldLabel>
                  <Input
                    id="integration-auth-url"
                    onChange={(event) =>
                      setAuthorizationUrl(event.target.value)
                    }
                    required
                    type="url"
                    value={authorizationUrl}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="integration-token-url">
                    Token URL
                  </FieldLabel>
                  <Input
                    id="integration-token-url"
                    onChange={(event) => setTokenUrl(event.target.value)}
                    required
                    type="url"
                    value={tokenUrl}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="integration-client-id">
                    Client ID
                  </FieldLabel>
                  <Input
                    id="integration-client-id"
                    onChange={(event) => setClientId(event.target.value)}
                    required
                    value={clientId}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="integration-client-secret">
                    Client-secret reference
                  </FieldLabel>
                  <SecretSelect
                    disabled={!secretSelectionAvailable}
                    id="integration-client-secret"
                    onChange={setClientSecretReferenceId}
                    references={secretReferences}
                    value={clientSecretReferenceId}
                  />
                  <FieldDescription>
                    {secretSelectionAvailable
                      ? "Only active environment references are listed."
                      : "Reference changes are unavailable; existing bindings are preserved."}
                  </FieldDescription>
                </Field>
                <Field className="field-span">
                  <FieldLabel htmlFor="integration-callbacks">
                    Callback URLs
                  </FieldLabel>
                  <Input
                    id="integration-callbacks"
                    onChange={(event) => setCallbackUrls(event.target.value)}
                    placeholder="https://dev.admin.arth.sh/api/oauth/github/callback"
                    required
                    value={callbackUrls}
                  />
                  <FieldDescription>
                    Comma-separated HTTPS URLs without queries or fragments.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="integration-required-scopes">
                    Required scopes
                  </FieldLabel>
                  <Input
                    id="integration-required-scopes"
                    onChange={(event) => setRequiredScopes(event.target.value)}
                    placeholder="read:user"
                    value={requiredScopes}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="integration-optional-scopes">
                    Optional scopes
                  </FieldLabel>
                  <Input
                    id="integration-optional-scopes"
                    onChange={(event) => setOptionalScopes(event.target.value)}
                    placeholder="repo"
                    value={optionalScopes}
                  />
                </Field>
              </>
            ) : null}
            <Field>
              <FieldLabel htmlFor="integration-webhook-secret">
                Webhook-secret reference
              </FieldLabel>
              <SecretSelect
                disabled={!secretSelectionAvailable}
                id="integration-webhook-secret"
                onChange={setWebhookSecretReferenceId}
                references={secretReferences}
                value={webhookSecretReferenceId}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-lifecycle">Lifecycle</FieldLabel>
              <select
                className="input"
                id="integration-lifecycle"
                onChange={(event) => setLifecycle(event.target.value)}
                value={lifecycle}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="deprecated">Deprecated</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="integration-state">
                Operational state
              </FieldLabel>
              <select
                className="input"
                id="integration-state"
                onChange={(event) => setOperationalState(event.target.value)}
                value={operationalState}
              >
                <option value="disabled">Disabled</option>
                <option value="enabled">Enabled</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </Field>
            {operationalState === "maintenance" ? (
              <Field>
                <FieldLabel htmlFor="integration-maintenance-expiry">
                  Maintenance expiry
                </FieldLabel>
                <Input
                  id="integration-maintenance-expiry"
                  onChange={(event) =>
                    setMaintenanceExpiresAt(event.target.value)
                  }
                  required
                  type="datetime-local"
                  value={maintenanceExpiresAt}
                />
              </Field>
            ) : null}
            <Field className="field-span">
              <FieldLabel htmlFor="integration-reason">Audit reason</FieldLabel>
              <Input
                id="integration-reason"
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
        <Button disabled={pending} form="integration-form" type="submit">
          {pending ? "Saving…" : "Set integration revision"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function SecretSelect({
  id,
  value,
  references,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  value: string;
  references: ReadonlyArray<PlatformSecretReferenceEntry>;
  disabled: boolean;
  onChange: (value: string) => void;
}>) {
  return (
    <select
      className="input"
      disabled={disabled}
      id={id}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      <option value="">No reference</option>
      {references.map((reference) => (
        <option key={reference.id} value={reference.id}>
          {reference.key}
        </option>
      ))}
    </select>
  );
}

function IntegrationCard({
  integration,
  onChanged,
}: Readonly<{
  integration: PlatformIntegrationRegistryEntry;
  onChanged: () => void;
}>) {
  const [status, setStatus] = useState("healthy");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function recordHealth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiRequest(
        `/api/platform/integrations/${encodeURIComponent(integration.id)}/health-observations`,
        {
          method: "POST",
          body: JSON.stringify({
            status,
            latencyMs: null,
            httpStatusCode: null,
            errorCode: status === "healthy" ? null : "operator_observed",
            reason,
          }),
        },
      );
      setReason("");
      setMessage("Health evidence recorded; it expires in five minutes.");
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Health evidence was not recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{integration.displayName}</CardTitle>
          <CardDescription>
            {integration.key} · revision {integration.revisionNumber}
          </CardDescription>
        </div>
        <Badge
          variant={
            integration.effectiveOperationalState === "enabled"
              ? "success"
              : "critical"
          }
        >
          {integration.operationalState}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="detail-list">
          <div>
            <dt>Protocol</dt>
            <dd>{integration.protocol}</dd>
          </div>
          <div>
            <dt>Connection</dt>
            <dd>{integration.connectionMode}</dd>
          </div>
          <div>
            <dt>Adapter</dt>
            <dd>
              {integration.adapterPackage}@{integration.adapterVersion}
            </dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{integration.lifecycle}</dd>
          </div>
          <div>
            <dt>Health</dt>
            <dd>
              <Badge variant={healthVariant(integration.health.state)}>
                {integration.health.state}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>Client secret</dt>
            <dd>{integration.clientSecretReferenceKey ?? "Not bound"}</dd>
          </div>
          <div>
            <dt>Webhook secret</dt>
            <dd>{integration.webhookSecretReferenceKey ?? "Not bound"}</dd>
          </div>
          <div>
            <dt>Capabilities</dt>
            <dd>{integration.capabilities.join(", ")}</dd>
          </div>
          <div>
            <dt>Required scopes</dt>
            <dd>{integration.requiredScopes.join(", ") || "None"}</dd>
          </div>
        </dl>
        {message ? <Alert>{message}</Alert> : null}
        <form className="inline-admin-form" onSubmit={recordHealth}>
          <Field>
            <FieldLabel htmlFor={`integration-health-${integration.id}`}>
              Observed health
            </FieldLabel>
            <select
              className="input"
              id={`integration-health-${integration.id}`}
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="healthy">Healthy</option>
              <option value="degraded">Degraded</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`integration-health-reason-${integration.id}`}>
              Evidence reason
            </FieldLabel>
            <Input
              id={`integration-health-reason-${integration.id}`}
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </Field>
          <Button disabled={pending} type="submit" variant="outline">
            Record evidence
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyToNull(value: string) {
  return value.trim() === "" ? null : value.trim();
}

function healthVariant(
  state: PlatformIntegrationRegistryEntry["health"]["state"],
) {
  if (state === "healthy") return "success" as const;
  if (state === "degraded" || state === "stale") return "warning" as const;
  if (state === "unavailable") return "critical" as const;
  return "neutral" as const;
}
