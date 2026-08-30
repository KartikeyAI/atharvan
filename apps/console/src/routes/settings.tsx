import {
  Clock3Icon,
  RefreshCwIcon,
  Settings2Icon,
  ShieldAlertIcon,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
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
  type PlatformConfigurationResponse,
  useApiResource,
} from "@/lib/api";
import type {
  PlatformConfigurationEntry,
  PlatformConfigurationScope,
  PlatformConfigurationValue,
} from "@atharvan/domain";

export const Route = createFileRoute("/settings")({
  component: PlatformSettingsPage,
});

function PlatformSettingsPage() {
  const configuration = useApiResource<PlatformConfigurationResponse>(
    "/api/platform/configuration",
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const registry =
    configuration.state.status === "success" ? configuration.state.data : null;
  const groupedItems = useMemo(() => {
    if (registry === null) return [];
    const groups = new Map<string, Array<PlatformConfigurationEntry>>();
    for (const item of registry.items) {
      const group = groups.get(item.category) ?? [];
      group.push(item);
      groups.set(item.category, group);
    }
    return [...groups.entries()];
  }, [registry]);

  return (
    <OperatorShell title="Settings">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Platform configuration</h1>
            <p>
              Versioned, validated operational settings resolved without a
              deployment.
            </p>
          </div>
          <Button
            onClick={configuration.reload}
            type="button"
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          This registry accepts non-secret configuration only. Credentials and
          signing material must use the separate secret-reference system.
        </Alert>

        {configuration.state.status === "loading" ? <LoadingCard /> : null}
        {configuration.state.status === "error" ? (
          <AccessError
            message={configuration.state.error.message}
            reload={configuration.reload}
          />
        ) : null}
        {registry !== null ? (
          <div className="configuration-shell">
            <div className="configuration-summary">
              <Badge>{registry.environment}</Badge>
              <span>
                {registry.items.length} registered setting
                {registry.items.length === 1 ? "" : "s"}
              </span>
              <span>Resolution: environment → platform → declared default</span>
            </div>
            {groupedItems.length === 0 ? (
              <Card className="empty-card">
                <Settings2Icon aria-hidden="true" />
                <h2>No configuration definitions</h2>
                <p>No operational settings are registered in PostgreSQL.</p>
              </Card>
            ) : (
              groupedItems.map(([category, items]) => (
                <section className="configuration-group" key={category}>
                  <div className="configuration-group-heading">
                    <h2>{formatCategory(category)}</h2>
                    <Badge variant="neutral">{items.length}</Badge>
                  </div>
                  <div className="configuration-grid">
                    {items.map((item) => (
                      <ConfigurationCard
                        environment={registry.environment}
                        item={item}
                        key={item.definitionId}
                        onChanged={() => {
                          setEditingKey(null);
                          configuration.reload();
                        }}
                        onEdit={() =>
                          setEditingKey((current) =>
                            current === item.key ? null : item.key,
                          )
                        }
                        open={editingKey === item.key}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        ) : null}
      </div>
    </OperatorShell>
  );
}

function ConfigurationCard({
  item,
  environment,
  open,
  onEdit,
  onChanged,
}: Readonly<{
  item: PlatformConfigurationEntry;
  environment: string;
  open: boolean;
  onEdit: () => void;
  onChanged: () => void;
}>) {
  return (
    <Card className="configuration-card">
      <CardHeader>
        <div className="configuration-card-title">
          <div>
            <h3>{item.name}</h3>
            <code>{item.key}</code>
          </div>
          <Badge
            variant={item.resolvedFrom === "default" ? "neutral" : "success"}
          >
            {item.resolvedFrom}
          </Badge>
        </div>
        <p>{item.description}</p>
      </CardHeader>
      <CardContent>
        <dl className="configuration-values">
          <div>
            <dt>Effective value</dt>
            <dd>{formatValue(item.resolvedValue)}</dd>
          </div>
          <div>
            <dt>Platform override</dt>
            <dd>
              {item.platformOverride
                ? formatValue(item.platformOverride.value)
                : "Not set"}
            </dd>
          </div>
          <div>
            <dt>{formatCategory(environment)} override</dt>
            <dd>
              {item.environmentOverride
                ? formatValue(item.environmentOverride.value)
                : "Not set"}
            </dd>
          </div>
          <div>
            <dt>Declared default</dt>
            <dd>{formatValue(item.defaultValue)}</dd>
          </div>
        </dl>
        <div className="configuration-actions">
          <Button onClick={onEdit} type="button" variant="outline">
            <Settings2Icon data-icon="inline-start" />
            {open ? "Close editor" : "Create revision"}
          </Button>
        </div>
        {open ? (
          <ConfigurationEditor item={item} onChanged={onChanged} />
        ) : null}
        <ConfigurationHistory item={item} />
      </CardContent>
    </Card>
  );
}

function ConfigurationEditor({
  item,
  onChanged,
}: Readonly<{
  item: PlatformConfigurationEntry;
  onChanged: () => void;
}>) {
  const [scope, setScope] = useState<PlatformConfigurationScope>("environment");
  const [rawValue, setRawValue] = useState(() =>
    editableValue(item.resolvedValue),
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(
        `/api/platform/configuration/${encodeURIComponent(item.key)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            scope,
            value: parseEditorValue(item, rawValue),
            reason,
          }),
        },
      );
      onChanged();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The configuration revision was not created.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="configuration-editor" onSubmit={submit}>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="field-stack">
        <Label htmlFor={`scope-${item.definitionId}`}>Override scope</Label>
        <select
          className="input"
          id={`scope-${item.definitionId}`}
          onChange={(event) =>
            setScope(event.target.value as PlatformConfigurationScope)
          }
          value={scope}
        >
          <option value="environment">Current environment</option>
          <option value="platform">Platform default</option>
        </select>
      </div>
      <ConfigurationValueInput
        item={item}
        onChange={setRawValue}
        value={rawValue}
      />
      <div className="field-stack field-span">
        <Label htmlFor={`reason-${item.definitionId}`}>Audit reason</Label>
        <Input
          id={`reason-${item.definitionId}`}
          minLength={8}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this setting changing?"
          required
          value={reason}
        />
      </div>
      <div className="field-span">
        <Button disabled={pending} type="submit">
          {pending ? "Creating revision…" : "Create revision"}
        </Button>
      </div>
    </form>
  );
}

function ConfigurationValueInput({
  item,
  value,
  onChange,
}: Readonly<{
  item: PlatformConfigurationEntry;
  value: string;
  onChange: (value: string) => void;
}>) {
  const id = `value-${item.definitionId}`;
  const allowedValues = item.validation.allowedValues;

  return (
    <div className="field-stack">
      <Label htmlFor={id}>New value</Label>
      {item.valueType === "boolean" ? (
        <select
          className="input"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      ) : allowedValues && allowedValues.length > 0 ? (
        <select
          className="input"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {allowedValues.map((allowedValue) => (
            <option key={allowedValue} value={allowedValue}>
              {formatCategory(allowedValue)}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          max={item.validation.maximum}
          min={item.validation.minimum}
          onChange={(event) => onChange(event.target.value)}
          required
          type={item.valueType === "integer" ? "number" : "text"}
          value={value}
        />
      )}
      {item.valueType === "string_list" ? (
        <span className="field-help">Separate values with commas.</span>
      ) : null}
    </div>
  );
}

function ConfigurationHistory({
  item,
}: Readonly<{ item: PlatformConfigurationEntry }>) {
  return (
    <details className="configuration-history">
      <summary>
        <Clock3Icon aria-hidden="true" />
        {item.recentRevisions.length} recent revision
        {item.recentRevisions.length === 1 ? "" : "s"}
      </summary>
      {item.recentRevisions.length === 0 ? (
        <p>No override revisions have been created.</p>
      ) : (
        <ol>
          {item.recentRevisions.map((revision) => (
            <li key={revision.id}>
              <div>
                <strong>Revision {revision.revisionNumber}</strong>
                <Badge variant="neutral">
                  {revision.environment ?? revision.scope}
                </Badge>
              </div>
              <code>{formatValue(revision.value)}</code>
              <p>{revision.reason}</p>
              <time dateTime={revision.createdAt}>
                {new Date(revision.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function LoadingCard() {
  return (
    <Card className="loading-card">
      <RefreshCwIcon aria-hidden="true" /> Loading canonical configuration…
    </Card>
  );
}

function AccessError({
  message,
  reload,
}: Readonly<{ message: string; reload: () => void }>) {
  return (
    <Alert variant="destructive">
      <span>{message}</span>
      <Button onClick={reload} type="button" variant="outline">
        Retry
      </Button>
    </Alert>
  );
}

function editableValue(value: PlatformConfigurationValue): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function parseEditorValue(
  item: PlatformConfigurationEntry,
  rawValue: string,
): PlatformConfigurationValue {
  if (item.valueType === "boolean") return rawValue === "true";
  if (item.valueType === "integer") return Number(rawValue);
  if (item.valueType === "string_list") {
    return rawValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return rawValue;
}

function formatValue(value: PlatformConfigurationValue): string {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatCategory(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
