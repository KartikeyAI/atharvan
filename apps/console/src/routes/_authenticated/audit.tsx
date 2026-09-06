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
import {
  apiResponse,
  type PlatformAuditEventPageResponse,
  useApiResource,
} from "@/lib/api";
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

type AuditExportState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "success";
      readonly contentSha256: string;
      readonly itemCount: number;
      readonly truncated: boolean;
      readonly filename: string;
    };

function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [query, setQuery] = useState("");
  const [exportState, setExportState] = useState<AuditExportState>({
    status: "idle",
  });
  const audit = useApiResource<PlatformAuditEventPageResponse>(
    `/api/platform/audit-events${query}`,
  );
  const page = audit.state.status === "success" ? audit.state.data : null;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuery(buildQuery(filters));
  }

  async function exportAudit() {
    if (filters.from === "" || filters.to === "") return;
    setExportState({ status: "loading" });
    try {
      const expectedRangeStart = new Date(filters.from).toISOString();
      const expectedRangeEnd = new Date(filters.to).toISOString();
      const response = await apiResponse(
        `/api/platform/audit-events/export${buildQuery(filters)}`,
        {
          cache: "no-store",
          headers: { accept: "application/x-ndjson" },
          signal: AbortSignal.timeout(30_000),
        },
      );
      const metadata = readAuditExportMetadata(
        response,
        expectedRangeStart,
        expectedRangeEnd,
      );
      const content = await response.blob();
      if (content.size !== metadata.contentLengthBytes) {
        throw new Error("The downloaded audit evidence has an invalid length.");
      }
      const actualDigest = await sha256Hex(await content.arrayBuffer());
      if (actualDigest !== metadata.contentSha256) {
        throw new Error("The downloaded audit evidence failed verification.");
      }
      const filename = `atharvan-audit-${metadata.generatedAt.slice(0, 10)}-${actualDigest.slice(0, 12)}.ndjson`;
      saveBlob(content, filename);
      setExportState({
        status: "success",
        contentSha256: actualDigest,
        itemCount: metadata.itemCount,
        truncated: metadata.truncated,
        filename,
      });
    } catch (error) {
      setExportState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "The audit export could not be downloaded.",
      });
    }
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
                disabled={
                  filters.from === "" ||
                  filters.to === "" ||
                  exportState.status === "loading"
                }
                onClick={exportAudit}
                type="button"
                variant="outline"
              >
                <DownloadIcon data-icon="inline-start" />
                {exportState.status === "loading"
                  ? "Verifying export…"
                  : "Export NDJSON"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {exportState.status === "error" ? (
          <Alert variant="destructive">{exportState.message}</Alert>
        ) : null}
        {exportState.status === "success" ? (
          <Alert>
            <ShieldCheckIcon aria-hidden="true" />
            <span>
              Saved {exportState.filename} with {exportState.itemCount} verified
              records{exportState.truncated ? " (export limit reached)" : ""}.
              SHA-256:{" "}
              <code className="audit-export-digest">
                {exportState.contentSha256}
              </code>
            </span>
          </Alert>
        ) : null}

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

function readAuditExportMetadata(
  response: Response,
  expectedRangeStart: string,
  expectedRangeEnd: string,
) {
  const contentSha256 = response.headers.get("x-atharvan-audit-content-sha256");
  const itemCountValue = response.headers.get("x-atharvan-audit-item-count");
  const contentLengthValue = response.headers.get(
    "x-atharvan-audit-content-length",
  );
  const truncatedValue = response.headers.get("x-atharvan-audit-truncated");
  const generatedAt = response.headers.get("x-atharvan-audit-generated-at");
  const environment = response.headers.get("x-atharvan-audit-environment");
  const contentDigest = response.headers.get("content-digest");
  const itemCount = Number(itemCountValue);
  const contentLengthBytes = Number(contentLengthValue);
  if (
    response.headers.get("x-atharvan-audit-schema-version") !== "1" ||
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-ndjson") ||
    !contentSha256 ||
    !/^[0-9a-f]{64}$/u.test(contentSha256) ||
    contentDigest !== `sha-256=:${hexToBase64(contentSha256)}:` ||
    (environment !== "development" && environment !== "production") ||
    !generatedAt ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    response.headers.get("x-atharvan-audit-range-start") !==
      expectedRangeStart ||
    response.headers.get("x-atharvan-audit-range-end") !== expectedRangeEnd ||
    itemCountValue === null ||
    !/^\d{1,4}$/u.test(itemCountValue) ||
    contentLengthValue === null ||
    !/^\d{1,8}$/u.test(contentLengthValue) ||
    !Number.isSafeInteger(contentLengthBytes) ||
    contentLengthBytes < 0 ||
    contentLengthBytes > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(itemCount) ||
    itemCount < 0 ||
    itemCount > 5_000 ||
    (truncatedValue !== "true" && truncatedValue !== "false")
  ) {
    throw new Error("The audit export metadata is incomplete or incompatible.");
  }
  return {
    contentSha256,
    generatedAt,
    contentLengthBytes,
    itemCount,
    truncated: truncatedValue === "true",
  };
}

async function sha256Hex(content: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", content);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBase64(hex: string): string {
  const bytes = Uint8Array.from(hex.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  return btoa(String.fromCharCode(...bytes));
}

function saveBlob(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
