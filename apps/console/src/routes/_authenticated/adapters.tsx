import { PackageCheckIcon, RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
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
  type PlatformAdapterRegistryResponse,
  useApiResource,
} from "@/lib/api";
import type {
  PlatformAdapterCapabilityMaturity,
  PlatformAdapterCapabilityName,
  PlatformAdapterCategory,
  PlatformAdapterCommandDeclaration,
  PlatformAdapterConfigurationField,
  PlatformAdapterHealthCheckDeclaration,
  PlatformAdapterReleaseEntry,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/adapters")({
  component: AdaptersPage,
});

const capabilityNames = [
  "detect",
  "understand",
  "modify",
  "validate",
  "preview",
  "deploy",
  "operate",
  "migrate",
] as const satisfies ReadonlyArray<PlatformAdapterCapabilityName>;
const maturityOptions = [
  "unsupported",
  "experimental",
  "alpha",
  "beta",
  "stable",
  "deprecated",
] as const satisfies ReadonlyArray<PlatformAdapterCapabilityMaturity>;
const categoryOptions = [
  "language",
  "framework",
  "package_manager",
  "build",
  "test",
  "database",
  "deployment",
  "cloud",
  "source_control",
  "observability",
  "security",
  "model",
  "design_system",
  "private_enterprise",
] as const satisfies ReadonlyArray<PlatformAdapterCategory>;

function AdaptersPage() {
  const adapters = useApiResource<PlatformAdapterRegistryResponse>(
    "/api/platform/adapters",
  );
  const registry =
    adapters.state.status === "success" ? adapters.state.data : null;

  return (
    <OperatorShell title="Adapters">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Adapter registry</h1>
            <p>
              Signed, reviewed releases and explicit capability maturity for
              Arth&apos;s supported technology ecosystem.
            </p>
          </div>
          <Button onClick={adapters.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          Atharvan stores release metadata and evidence, not package archives,
          customer installations, configuration values, credentials, code, or
          environments. Active releases require a verified signature and an
          approved security review.
        </Alert>

        <AdapterEditor onChanged={adapters.reload} />

        {adapters.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading adapter registry…
          </Card>
        ) : null}
        {adapters.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{adapters.state.error.message}</span>
            <Button onClick={adapters.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {registry !== null ? (
          registry.items.length === 0 ? (
            <Card className="empty-card">
              <PackageCheckIcon aria-hidden="true" />
              <h2>No adapter releases registered</h2>
              <p>
                An adapter is unavailable until a release is explicitly
                declared, reviewed, and activated here.
              </p>
            </Card>
          ) : (
            <div className="provider-grid">
              {registry.items.map((adapter) => (
                <AdapterCard adapter={adapter} key={adapter.id} />
              ))}
            </div>
          )
        ) : null}
      </div>
    </OperatorShell>
  );
}

function AdapterEditor({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const [key, setKey] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] =
    useState<PlatformAdapterCategory>("framework");
  const [packageName, setPackageName] = useState("@arth/");
  const [packageDigestSha256, setPackageDigestSha256] = useState("");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [capabilities, setCapabilities] = useState<
    Record<PlatformAdapterCapabilityName, PlatformAdapterCapabilityMaturity>
  >({
    detect: "unsupported",
    understand: "unsupported",
    modify: "unsupported",
    validate: "unsupported",
    preview: "unsupported",
    deploy: "unsupported",
    operate: "unsupported",
    migrate: "unsupported",
  });
  const [declaredPermissions, setDeclaredPermissions] = useState("");
  const [supportedEnvironments, setSupportedEnvironments] =
    useState("development");
  const [compatibilityTags, setCompatibilityTags] = useState("");
  const [requiredSecretPurposes, setRequiredSecretPurposes] = useState("");
  const [configurationFields, setConfigurationFields] = useState("[]");
  const [commands, setCommands] = useState("[]");
  const [healthChecks, setHealthChecks] = useState("[]");
  const [releaseChannel, setReleaseChannel] = useState("internal");
  const [signatureStatus, setSignatureStatus] = useState("unverified");
  const [securityReviewStatus, setSecurityReviewStatus] = useState("pending");
  const [securityReviewReference, setSecurityReviewReference] = useState("");
  const [lifecycle, setLifecycle] = useState("draft");
  const [blockReason, setBlockReason] = useState("");
  const [deprecatedAt, setDeprecatedAt] = useState("");
  const [sunsetAt, setSunsetAt] = useState("");
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
      }>(
        `/api/platform/adapters/${encodeURIComponent(key)}/releases/${encodeURIComponent(version)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            displayName,
            category,
            packageName,
            packageDigestSha256,
            documentationUrl: emptyToNull(documentationUrl),
            capabilities: capabilityNames.map((name) => ({
              name,
              maturity: capabilities[name],
            })),
            declaredPermissions: parseList(declaredPermissions),
            configurationFields:
              parseJsonArray<PlatformAdapterConfigurationField>(
                configurationFields,
                "Configuration fields",
              ),
            commands: parseJsonArray<PlatformAdapterCommandDeclaration>(
              commands,
              "Commands",
            ),
            supportedEnvironments: parseList(supportedEnvironments),
            compatibilityTags: parseList(compatibilityTags),
            requiredSecretPurposes: parseList(requiredSecretPurposes),
            healthChecks: parseJsonArray<PlatformAdapterHealthCheckDeclaration>(
              healthChecks,
              "Health checks",
            ),
            releaseChannel,
            signatureStatus,
            securityReviewStatus,
            securityReviewReference: emptyToNull(securityReviewReference),
            lifecycle,
            blockReason:
              lifecycle === "blocked" ? emptyToNull(blockReason) : null,
            deprecatedAt:
              lifecycle === "deprecated" ? emptyToNull(deprecatedAt) : null,
            sunsetAt: lifecycle === "deprecated" ? emptyToNull(sunsetAt) : null,
            reason,
          }),
        },
      );
      setReason("");
      setMessage(
        `Adapter release ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The adapter release was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>Register or revise a release</CardTitle>
          <CardDescription>
            The package name and SHA-256 digest become immutable for this key
            and semantic version after first publication.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Release identity</FieldLegend>
              <div className="adapter-evidence-grid">
                <TextField
                  id="adapter-key"
                  label="Registry key"
                  onChange={setKey}
                  required
                  value={key}
                />
                <TextField
                  id="adapter-version"
                  label="Version"
                  onChange={setVersion}
                  required
                  value={version}
                />
                <TextField
                  id="adapter-name"
                  label="Display name"
                  onChange={setDisplayName}
                  required
                  value={displayName}
                />
                <Field>
                  <FieldLabel htmlFor="adapter-category">Category</FieldLabel>
                  <select
                    className="input"
                    id="adapter-category"
                    onChange={(event) =>
                      setCategory(event.target.value as PlatformAdapterCategory)
                    }
                    value={category}
                  >
                    {categoryOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatLabel(option)}
                      </option>
                    ))}
                  </select>
                </Field>
                <TextField
                  id="adapter-package"
                  label="Package"
                  onChange={setPackageName}
                  required
                  value={packageName}
                />
                <TextField
                  id="adapter-digest"
                  label="Package SHA-256"
                  maxLength={64}
                  minLength={64}
                  onChange={setPackageDigestSha256}
                  required
                  value={packageDigestSha256}
                />
                <TextField
                  id="adapter-docs"
                  label="Documentation URL"
                  onChange={setDocumentationUrl}
                  type="url"
                  value={documentationUrl}
                />
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Capability maturity</FieldLegend>
              <FieldDescription>
                Every capability is explicit; unsupported is a deliberate state.
              </FieldDescription>
              <div className="adapter-capability-grid">
                {capabilityNames.map((name) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={`adapter-capability-${name}`}>
                      {formatLabel(name)}
                    </FieldLabel>
                    <select
                      className="input"
                      id={`adapter-capability-${name}`}
                      onChange={(event) =>
                        setCapabilities((current) => ({
                          ...current,
                          [name]: event.target
                            .value as PlatformAdapterCapabilityMaturity,
                        }))
                      }
                      value={capabilities[name]}
                    >
                      {maturityOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatLabel(option)}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Declared contract</FieldLegend>
              <div className="adapter-contract-grid">
                <ListField
                  id="adapter-permissions"
                  label="Permissions"
                  onChange={setDeclaredPermissions}
                  value={declaredPermissions}
                />
                <ListField
                  id="adapter-environments"
                  label="Supported environments"
                  onChange={setSupportedEnvironments}
                  required
                  value={supportedEnvironments}
                />
                <ListField
                  id="adapter-compatibility"
                  label="Compatibility tags"
                  onChange={setCompatibilityTags}
                  value={compatibilityTags}
                />
                <ListField
                  id="adapter-secret-purposes"
                  label="Required secret purposes"
                  onChange={setRequiredSecretPurposes}
                  value={requiredSecretPurposes}
                />
                <JsonField
                  id="adapter-config-fields"
                  label="Configuration fields (JSON array)"
                  onChange={setConfigurationFields}
                  value={configurationFields}
                />
                <JsonField
                  id="adapter-commands"
                  label="Commands (JSON array)"
                  onChange={setCommands}
                  value={commands}
                />
                <JsonField
                  id="adapter-health-checks"
                  label="Health checks (JSON array)"
                  onChange={setHealthChecks}
                  value={healthChecks}
                />
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Release evidence and lifecycle</FieldLegend>
              <div className="adapter-evidence-grid">
                <SelectField
                  id="adapter-channel"
                  label="Release channel"
                  onChange={setReleaseChannel}
                  options={["internal", "canary", "beta", "stable"]}
                  value={releaseChannel}
                />
                <SelectField
                  id="adapter-signature"
                  label="Signature"
                  onChange={setSignatureStatus}
                  options={["unverified", "verified", "invalid"]}
                  value={signatureStatus}
                />
                <SelectField
                  id="adapter-review"
                  label="Security review"
                  onChange={setSecurityReviewStatus}
                  options={[
                    "pending",
                    "approved",
                    "changes_required",
                    "rejected",
                  ]}
                  value={securityReviewStatus}
                />
                <TextField
                  id="adapter-review-reference"
                  label="Review reference"
                  onChange={setSecurityReviewReference}
                  value={securityReviewReference}
                />
                <SelectField
                  id="adapter-lifecycle"
                  label="Lifecycle"
                  onChange={setLifecycle}
                  options={["draft", "active", "deprecated", "blocked"]}
                  value={lifecycle}
                />
                {lifecycle === "blocked" ? (
                  <TextField
                    id="adapter-block-reason"
                    label="Block reason"
                    onChange={setBlockReason}
                    required
                    value={blockReason}
                  />
                ) : null}
                {lifecycle === "deprecated" ? (
                  <TextField
                    id="adapter-deprecated-at"
                    label="Deprecated at"
                    onChange={setDeprecatedAt}
                    required
                    type="datetime-local"
                    value={deprecatedAt}
                  />
                ) : null}
                {lifecycle === "deprecated" ? (
                  <TextField
                    id="adapter-sunset-at"
                    label="Sunset at"
                    onChange={setSunsetAt}
                    type="datetime-local"
                    value={sunsetAt}
                  />
                ) : null}
              </div>
            </FieldSet>

            <Field>
              <FieldLabel htmlFor="adapter-reason">Audit reason</FieldLabel>
              <Input
                id="adapter-reason"
                minLength={8}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this release changing?"
                required
                value={reason}
              />
            </Field>
          </FieldGroup>
          {message ? <Alert className="form-error">{message}</Alert> : null}
        </CardContent>
        <CardFooter>
          <Button disabled={pending} type="submit">
            {pending ? "Creating revision…" : "Create release revision"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function AdapterCard({
  adapter,
}: Readonly<{ adapter: PlatformAdapterReleaseEntry }>) {
  return (
    <Card>
      <CardHeader>
        <div className="card-heading-row">
          <div>
            <CardTitle>{adapter.displayName}</CardTitle>
            <CardDescription>
              {adapter.packageName}@{adapter.version}
            </CardDescription>
          </div>
          <Badge
            variant={adapter.lifecycle === "active" ? "success" : "neutral"}
          >
            {formatLabel(adapter.lifecycle)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="adapter-capability-matrix">
          {adapter.capabilities.map((capability) => (
            <div key={capability.name}>
              <span>{formatLabel(capability.name)}</span>
              <strong>{formatLabel(capability.maturity)}</strong>
            </div>
          ))}
        </div>
        <dl className="provider-facts">
          <div>
            <dt>Channel</dt>
            <dd>{formatLabel(adapter.releaseChannel)}</dd>
          </div>
          <div>
            <dt>Signature</dt>
            <dd>{formatLabel(adapter.signatureStatus)}</dd>
          </div>
          <div>
            <dt>Security review</dt>
            <dd>{formatLabel(adapter.securityReviewStatus)}</dd>
          </div>
          <div>
            <dt>Review evidence</dt>
            <dd>{adapter.securityReviewReference ?? "Not supplied"}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{adapter.revisionNumber}</dd>
          </div>
          <div>
            <dt>Digest</dt>
            <dd>
              <code>{adapter.packageDigestSha256.slice(0, 12)}…</code>
            </dd>
          </div>
        </dl>
        {adapter.blockReason ? (
          <Alert variant="destructive">{adapter.blockReason}</Alert>
        ) : null}
        <details className="capability-details">
          <summary>Declared permissions and compatibility</summary>
          <div className="capability-list">
            {[...adapter.declaredPermissions, ...adapter.compatibilityTags].map(
              (item) => (
                <code key={item}>{item}</code>
              ),
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  ...props
}: Readonly<
  {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "id" | "value" | "onChange"
  >
>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...props}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </Field>
  );
}

function ListField(
  props: Readonly<{
    id: string;
    label: string;
    value: string;
    required?: boolean;
    onChange: (value: string) => void;
  }>,
) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        onChange={(event) => props.onChange(event.target.value)}
        required={props.required}
        value={props.value}
      />
      <FieldDescription>Comma-separated identifiers.</FieldDescription>
    </Field>
  );
}

function JsonField(
  props: Readonly<{
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }>,
) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <textarea
        className="input adapter-textarea"
        id={props.id}
        onChange={(event) => props.onChange(event.target.value)}
        spellCheck={false}
        value={props.value}
      />
    </Field>
  );
}

function SelectField(
  props: Readonly<{
    id: string;
    label: string;
    value: string;
    options: ReadonlyArray<string>;
    onChange: (value: string) => void;
  }>,
) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <select
        className="input"
        id={props.id}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {formatLabel(option)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function parseJsonArray<T>(value: string, label: string): ReadonlyArray<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed as ReadonlyArray<T>;
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyToNull(value: string) {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}
