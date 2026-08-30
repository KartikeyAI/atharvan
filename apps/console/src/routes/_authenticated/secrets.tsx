import {
  Clock3Icon,
  KeyRoundIcon,
  RefreshCwIcon,
  RotateCwIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { OperatorShell } from "@/components/operator-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  apiRequest,
  type PlatformSecretReferencesResponse,
  useApiResource,
} from "@/lib/api";
import type { PlatformSecretReferenceEntry } from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/secrets")({
  component: PlatformSecretsPage,
});

function PlatformSecretsPage() {
  const references = useApiResource<PlatformSecretReferencesResponse>(
    "/api/platform/secret-references",
  );
  const registry =
    references.state.status === "success" ? references.state.data : null;

  return (
    <OperatorShell title="Secrets">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Secret references</h1>
            <p>
              Provision and rotate platform credentials without storing or
              reading their values in Atharvan.
            </p>
          </div>
          <Button onClick={references.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          Values are sent once to the external secret provider. They cannot be
          viewed, copied, exported, or recovered through this control plane.
        </Alert>

        {registry && !registry.providerConfigured ? (
          <Alert variant="destructive">
            Secret metadata is readable, but lifecycle changes are disabled
            until the environment-specific provider credentials are configured.
          </Alert>
        ) : null}

        <CreateSecretCard
          disabled={registry?.providerConfigured !== true}
          onCreated={references.reload}
        />

        {references.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading secret metadata…
          </Card>
        ) : null}
        {references.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{references.state.error.message}</span>
            <Button onClick={references.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {registry ? (
          registry.items.length === 0 ? (
            <Card className="empty-card">
              <KeyRoundIcon aria-hidden="true" />
              <h2>No secret references</h2>
              <p>No platform credential metadata has been registered.</p>
            </Card>
          ) : (
            <div className="secret-grid">
              {registry.items.map((reference) => (
                <SecretReferenceCard
                  disabled={!registry.providerConfigured}
                  key={reference.id}
                  onChanged={references.reload}
                  reference={reference}
                />
              ))}
            </div>
          )
        ) : null}
      </div>
    </OperatorShell>
  );
}

function CreateSecretCard({
  disabled,
  onCreated,
}: Readonly<{ disabled: boolean; onCreated: () => void }>) {
  const [key, setKey] = useState("");
  const [purpose, setPurpose] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiRequest("/api/platform/secret-references", {
        method: "POST",
        body: JSON.stringify({ key, purpose, value, reason }),
      });
      setKey("");
      setPurpose("");
      setReason("");
      setMessage(
        "Secret reference created. The submitted value is no longer available.",
      );
      onCreated();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The secret was not created.",
      );
    } finally {
      setValue("");
      setPending(false);
    }
  }

  return (
    <Card className="action-card">
      <CardHeader>
        <span className="section-icon">
          <KeyRoundIcon aria-hidden="true" />
        </span>
        <div>
          <h2>Create secret reference</h2>
          <p>The value field is cleared after every submission attempt.</p>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form autoComplete="off" className="admin-form" onSubmit={submit}>
          <div className="field-stack">
            <Label htmlFor="secret-key">Logical key</Label>
            <Input
              disabled={disabled}
              id="secret-key"
              maxLength={96}
              onChange={(event) => setKey(event.target.value)}
              pattern="[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+"
              placeholder="models.openai"
              required
              value={key}
            />
          </div>
          <div className="field-stack">
            <Label htmlFor="secret-purpose">Purpose</Label>
            <Input
              disabled={disabled}
              id="secret-purpose"
              minLength={8}
              onChange={(event) => setPurpose(event.target.value)}
              placeholder="Platform model routing"
              required
              value={purpose}
            />
          </div>
          <div className="field-stack field-span">
            <Label htmlFor="secret-value">Secret value</Label>
            <Input
              autoCapitalize="none"
              autoComplete="new-password"
              disabled={disabled}
              id="secret-value"
              onChange={(event) => setValue(event.target.value)}
              required
              spellCheck={false}
              type="password"
              value={value}
            />
            <span className="field-help">
              Maximum 1,024 UTF-8 bytes. No preview is retained.
            </span>
          </div>
          <div className="field-stack field-span">
            <Label htmlFor="secret-reason">Audit reason</Label>
            <Input
              disabled={disabled}
              id="secret-reason"
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this credential being provisioned?"
              required
              value={reason}
            />
          </div>
          <div className="field-span form-actions">
            <Button disabled={disabled || pending} type="submit">
              {pending ? "Provisioning…" : "Create reference"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SecretReferenceCard({
  reference,
  disabled,
  onChanged,
}: Readonly<{
  reference: PlatformSecretReferenceEntry;
  disabled: boolean;
  onChanged: () => void;
}>) {
  const [mode, setMode] = useState<"rotate" | "revoke" | null>(null);
  return (
    <Card className="secret-card">
      <CardHeader className="table-card-header">
        <div>
          <h2>{reference.key}</h2>
          <p>{reference.purpose}</p>
        </div>
        <Badge variant={statusVariant(reference.status)}>
          {reference.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="configuration-values">
          <div>
            <dt>Environment</dt>
            <dd>{reference.environment}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>Cloudflare Secrets Store</dd>
          </div>
          <div>
            <dt>Active version</dt>
            <dd>{reference.currentVersionNumber ?? "None"}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{new Date(reference.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <div className="configuration-actions">
          <Button
            disabled={disabled || reference.status !== "active"}
            onClick={() => setMode(mode === "rotate" ? null : "rotate")}
            type="button"
            variant="outline"
          >
            <RotateCwIcon data-icon="inline-start" /> Rotate
          </Button>
          <Button
            disabled={disabled || reference.status !== "active"}
            onClick={() => setMode(mode === "revoke" ? null : "revoke")}
            type="button"
            variant="destructive"
          >
            <Trash2Icon data-icon="inline-start" /> Revoke
          </Button>
        </div>
        {mode === "rotate" ? (
          <SecretMutationForm
            action="rotate"
            onChanged={onChanged}
            reference={reference}
          />
        ) : null}
        {mode === "revoke" ? (
          <SecretMutationForm
            action="revoke"
            onChanged={onChanged}
            reference={reference}
          />
        ) : null}
        <details className="configuration-history">
          <summary>
            <Clock3Icon aria-hidden="true" />
            {reference.recentVersions.length} recent version
            {reference.recentVersions.length === 1 ? "" : "s"}
          </summary>
          <ol>
            {reference.recentVersions.map((version) => (
              <li key={version.id}>
                <div>
                  <strong>Version {version.versionNumber}</strong>
                  <Badge>{version.status}</Badge>
                </div>
                <p>{version.reason}</p>
                <time dateTime={version.createdAt}>
                  {new Date(version.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}

function SecretMutationForm({
  action,
  reference,
  onChanged,
}: Readonly<{
  action: "rotate" | "revoke";
  reference: PlatformSecretReferenceEntry;
  onChanged: () => void;
}>) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(
        `/api/platform/secret-references/${encodeURIComponent(reference.id)}/${action}`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "rotate" ? { value, reason } : { reason, confirmation },
          ),
        },
      );
      setReason("");
      setConfirmation("");
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `The secret was not ${action}d.`,
      );
    } finally {
      setValue("");
      setPending(false);
    }
  }

  return (
    <form autoComplete="off" className="configuration-editor" onSubmit={submit}>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {action === "rotate" ? (
        <div className="field-stack field-span">
          <Label htmlFor={`rotate-value-${reference.id}`}>
            Replacement value
          </Label>
          <Input
            autoComplete="new-password"
            id={`rotate-value-${reference.id}`}
            onChange={(event) => setValue(event.target.value)}
            required
            spellCheck={false}
            type="password"
            value={value}
          />
        </div>
      ) : (
        <div className="field-stack field-span">
          <Label htmlFor={`revoke-confirm-${reference.id}`}>
            Type REVOKE to confirm
          </Label>
          <Input
            id={`revoke-confirm-${reference.id}`}
            onChange={(event) => setConfirmation(event.target.value)}
            pattern="REVOKE"
            required
            value={confirmation}
          />
        </div>
      )}
      <div className="field-stack field-span">
        <Label htmlFor={`${action}-reason-${reference.id}`}>Audit reason</Label>
        <Input
          id={`${action}-reason-${reference.id}`}
          minLength={8}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </div>
      <div className="field-span form-actions">
        <Button
          disabled={pending}
          type="submit"
          variant={action === "revoke" ? "destructive" : "default"}
        >
          {pending
            ? "Submitting…"
            : action === "rotate"
              ? "Rotate credential"
              : "Revoke permanently"}
        </Button>
      </div>
    </form>
  );
}

function statusVariant(status: PlatformSecretReferenceEntry["status"]) {
  if (status === "active") return "success" as const;
  if (status === "revoked" || status.endsWith("failed"))
    return "critical" as const;
  return "warning" as const;
}
