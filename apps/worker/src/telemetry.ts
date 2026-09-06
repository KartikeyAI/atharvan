/** Minimal W3C trace context used to correlate edge requests and scheduled work. */
export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly traceFlags: string;
}

type TelemetryValue = string | number | boolean | null | undefined;

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;

/** Continue a valid version-00 trace or create a new local root span. */
export function createTraceContext(traceparent?: string | null): TraceContext {
  const match = traceparent?.toLowerCase().match(traceparentPattern);
  const incomingIsValid =
    match !== undefined &&
    match !== null &&
    !/^0{32}$/u.test(match[1] ?? "") &&
    !/^0{16}$/u.test(match[2] ?? "");
  return {
    traceId: incomingIsValid ? (match?.[1] ?? randomHex(16)) : randomHex(16),
    spanId: randomHex(8),
    parentSpanId: incomingIsValid ? (match?.[2] ?? null) : null,
    traceFlags: incomingIsValid ? (match?.[3] ?? "01") : "01",
  };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

/** Emit one flat JSON record whose caller supplies only bounded, safe metadata. */
export function writeTelemetry(
  level: "info" | "warning" | "error",
  event: string,
  fields: Readonly<Record<string, TelemetryValue>>,
): void {
  const record: Record<string, Exclude<TelemetryValue, undefined>> = {
    timestamp: new Date().toISOString(),
    level,
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (
      value === undefined ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      continue;
    record[key] = value;
  }
  const payload = JSON.stringify(record);
  if (level === "error") console.error(payload);
  else if (level === "warning") console.warn(payload);
  else console.info(payload);
}

/** Keep route labels useful while excluding queries and control characters. */
export function normalizeTelemetryPath(path: string): string {
  const safe = path.replace(/[\u0000-\u001f\u007f]/gu, "_");
  return safe.length <= 240 ? safe : `${safe.slice(0, 239)}…`;
}

/** Reduce diagnostic categories to a bounded label alphabet. */
export function normalizeTelemetryLabel(value: string): string {
  const safe = value.replace(/[^a-z0-9_.:-]/giu, "_");
  return safe.length <= 80 ? safe : safe.slice(0, 80);
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
