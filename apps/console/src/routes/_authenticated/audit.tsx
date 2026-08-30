import {
  DownloadIcon,
  FileClockIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
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
import { type PlatformAuditEventPageResponse, useApiResource } from "@/lib/api";
import type {
  PlatformAuditEventEntry,
  PlatformCommandOutcome,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

interface AuditFilters {
  readonly actorId: string;
  readonly eventType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly correlationId: string;
  readonly commandName: string;
  readonly outcome: "" | PlatformCommandOutcome;
  readonly from: string;
  readonly to: string;
}

const emptyFilters: AuditFilters = {
  actorId: "",
  eventType: "",
  targetType: "",
  targetId: "",
  correlationId: "",
  commandName: "",
  outcome: "",
  from: "",
  to: "",
};

function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [query, setQuery] = useState("");
  const audit = useApiResource<PlatformAuditEventPageResponse>(
    `/api/platform/audit-events${query}`,
  );
  const page = audit.state.status === "success" ? audit.state.data : null;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(buildQuery(filters));
  }

  function exportAudit() {
    if (filters.from === "" || filters.to === "") return;
    window.location.assign(
      `/api/platform/audit-events/export${buildQuery(filters)}`,
    );
  }

  return (
    <OperatorShell title="Audit">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Command and audit evidence</h1>
            <p>
              Search immutable administrative events and their named, versioned
              command envelopes without exposing request payloads.
            </p>
          </div>
          <Button onClick={audit.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          Command records store secret-safe fingerprints, not raw request
          payloads or idempotency keys. Audit and command history cannot be
          updated or deleted.
        </Alert>

        <Card>
          <form onSubmit={search}>
            <CardHeader>
              <CardTitle>Search audit history</CardTitle>
              <CardDescription>
                Event type is a prefix filter. Export requires a recent sign-in
                and a date range of no more than 31 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <FieldSet>
                  <FieldLegend>Event and command filters</FieldLegend>
                  <div className="audit-filter-grid">
                    <AuditTextField
                      id="audit-event"
                      label="Event type"
                      name="eventType"
                      onChange={setFilters}
                      value={filters.eventType}
                    />
                    <AuditTextField
                      id="audit-command"
                      label="Command name"
                      name="commandName"
                      onChange={setFilters}
                      value={filters.commandName}
                    />
                    <AuditTextField
                      id="audit-target-type"
                      label="Target type"
                      name="targetType"
                      onChange={setFilters}
                      value={filters.targetType}
                    />
                    <AuditTextField
                      id="audit-target-id"
                      label="Target ID"
                      name="targetId"
                      onChange={setFilters}
                      value={filters.targetId}
                    />
                    <AuditTextField
                      id="audit-actor"
                      label="Actor ID"
                      name="actorId"
                      onChange={setFilters}
                      value={filters.actorId}
                    />
                    <AuditTextField
                      id="audit-correlation"
                      label="Correlation ID"
                      name="correlationId"
                      onChange={setFilters}
                      value={filters.correlationId}
                    />
                    <Field>
                      <FieldLabel htmlFor="audit-outcome">Outcome</FieldLabel>
                      <select
                        className="input"
                        id="audit-outcome"
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            outcome: event.target
                              .value as AuditFilters["outcome"],
                          }))
                        }
                        value={filters.outcome}
                      >
                        <option value="">Any outcome</option>
                        <option value="succeeded">Succeeded</option>
                        <option value="rejected">Rejected</option>
                        <option value="failed">Failed</option>
                      </select>
                    </Field>
                  </div>
                </FieldSet>
                <FieldSet>
                  <FieldLegend>Time range</FieldLegend>
                  <div className="audit-filter-grid">
                    <AuditDateField
                      id="audit-from"
                      label="From"
                      name="from"
                      onChange={setFilters}
                      value={filters.from}
                    />
                    <AuditDateField
                      id="audit-to"
                      label="To"
                      name="to"
                      onChange={setFilters}
                      value={filters.to}
                    />
                  </div>
                  <FieldDescription>
                    Dates are interpreted in your browser timezone and sent as
                    absolute timestamps.
                  </FieldDescription>
                </FieldSet>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button type="submit">
                <SearchIcon data-icon="inline-start" /> Search
              </Button>
              <Button
                disabled={filters.from === "" || filters.to === ""}
                onClick={exportAudit}
                type="button"
                variant="outline"
              >
                <DownloadIcon data-icon="inline-start" /> Export NDJSON
              </Button>
            </CardFooter>
          </form>
        </Card>

        {audit.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading audit evidence…
          </Card>
        ) : null}
        {audit.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{audit.state.error.message}</span>
            <Button onClick={audit.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {page !== null ? (
          page.items.length === 0 ? (
            <Card className="empty-card">
              <FileClockIcon aria-hidden="true" />
              <h2>No matching audit events</h2>
              <p>No immutable evidence matches the current filters.</p>
            </Card>
          ) : (
            <div className="audit-list">
              {page.items.map((item) => (
                <AuditEventCard event={item} key={item.id} />
              ))}
              {page.nextCursor === null ? null : (
                <Button
                  onClick={() =>
                    setQuery(
                      appendCursor(buildQuery(filters), page.nextCursor!),
                    )
                  }
                  type="button"
                  variant="outline"
                >
                  Load older events
                </Button>
              )}
            </div>
          )
        ) : null}
      </div>
    </OperatorShell>
  );
}

function AuditEventCard({
  event,
}: Readonly<{ event: PlatformAuditEventEntry }>) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{event.eventType}</CardTitle>
          <CardDescription>
            {new Date(event.occurredAt).toLocaleString()} ·{" "}
            {event.actorEmail ?? event.actorId ?? "system"}
          </CardDescription>
        </div>
        <Badge variant={outcomeVariant(event.command?.outcome ?? null)}>
          {event.command?.outcome ?? "event"}
        </Badge>
      </CardHeader>
      <CardContent>
        <dl className="audit-details">
          <div>
            <dt>Target</dt>
            <dd>
              {event.targetType} / {event.targetId}
            </dd>
          </div>
          <div>
            <dt>Correlation</dt>
            <dd>
              <code>{event.correlationId}</code>
            </dd>
          </div>
          {event.reason === null ? null : (
            <div>
              <dt>Reason</dt>
              <dd>{event.reason}</dd>
            </div>
          )}
          {event.command === null ? null : (
            <>
              <div>
                <dt>Command</dt>
                <dd>
                  {event.command.name} v{event.command.version}
                </dd>
              </div>
              <div>
                <dt>Payload fingerprint</dt>
                <dd>
                  <code>{event.command.payloadFingerprint}</code>
                </dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>{new Date(event.command.requestedAt).toLocaleString()}</dd>
              </div>
            </>
          )}
        </dl>
        <details>
          <summary>Evidence</summary>
          <pre className="audit-evidence">
            {JSON.stringify(event.evidence, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

function AuditTextField({
  id,
  label,
  name,
  onChange,
  value,
}: Readonly<{
  id: string;
  label: string;
  name: keyof AuditFilters;
  onChange: Dispatch<SetStateAction<AuditFilters>>;
  value: string;
}>) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        onChange={(event) =>
          onChange((current) => ({ ...current, [name]: event.target.value }))
        }
        value={value}
      />
    </Field>
  );
}

function AuditDateField(
  props: Readonly<{
    id: string;
    label: string;
    name: "from" | "to";
    onChange: Dispatch<SetStateAction<AuditFilters>>;
    value: string;
  }>,
) {
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <Input
        id={props.id}
        onChange={(event) =>
          props.onChange((current) => ({
            ...current,
            [props.name]: event.target.value,
          }))
        }
        type="datetime-local"
        value={props.value}
      />
    </Field>
  );
}

function buildQuery(filters: AuditFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === "") continue;
    query.set(
      key,
      key === "from" || key === "to" ? new Date(value).toISOString() : value,
    );
  }
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function appendCursor(query: string, cursor: string) {
  const parameters = new URLSearchParams(
    query.startsWith("?") ? query.slice(1) : query,
  );
  parameters.set("cursor", cursor);
  return `?${parameters.toString()}`;
}

function outcomeVariant(outcome: PlatformCommandOutcome | null) {
  if (outcome === "succeeded") return "success" as const;
  if (outcome === "failed") return "critical" as const;
  if (outcome === "rejected") return "warning" as const;
  return "neutral" as const;
}
