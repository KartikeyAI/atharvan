/** Revisioned contract for an outbound HTTP health probe. */
export interface PlatformHttpHealthProbe {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly expectedStatusCodes: ReadonlyArray<number>;
  readonly timeoutMs: number;
  readonly intervalSeconds: number;
}

export type PlatformHealthObservationSource =
  "operator_probe" | "scheduled_probe";

/** Bounded operational evidence for the durable scheduled-probe queue. */
export interface PlatformHealthProbeQueueHealth {
  readonly observedAt: string;
  readonly pending: number;
  readonly leased: number;
  readonly retryExhausted: number;
  readonly oldestOutstandingAt: string | null;
}

/** Validate and canonicalize a probe before it becomes immutable revision data. */
export function normalizePlatformHttpHealthProbe(
  value: PlatformHttpHealthProbe | null,
): PlatformHttpHealthProbe | null {
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("health_probe_url_invalid");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    value.url.length > 2_048 ||
    isForbiddenProbeHostname(hostname)
  ) {
    throw new Error("health_probe_url_invalid");
  }
  url.hostname = hostname;
  url.hash = "";
  const expectedStatusCodes = [...new Set(value.expectedStatusCodes)].sort(
    (left, right) => left - right,
  );
  if (
    (value.method !== "GET" && value.method !== "HEAD") ||
    expectedStatusCodes.length === 0 ||
    expectedStatusCodes.length > 32 ||
    expectedStatusCodes.some(
      (status) => !Number.isSafeInteger(status) || status < 100 || status > 599,
    ) ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 500 ||
    value.timeoutMs > 10_000 ||
    !Number.isSafeInteger(value.intervalSeconds) ||
    value.intervalSeconds < 60 ||
    value.intervalSeconds > 3_600 ||
    value.intervalSeconds % 60 !== 0
  ) {
    throw new Error("health_probe_contract_invalid");
  }
  return {
    url: url.toString(),
    method: value.method,
    expectedStatusCodes,
    timeoutMs: value.timeoutMs,
    intervalSeconds: value.intervalSeconds,
  };
}

function isForbiddenProbeHostname(hostname: string): boolean {
  const unwrapped = hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "0.0.0.0" ||
    unwrapped === "::" ||
    unwrapped === "::1" ||
    (unwrapped.includes(":") &&
      (unwrapped.startsWith("fc") ||
        unwrapped.startsWith("fd") ||
        /^fe[89ab]/.test(unwrapped) ||
        unwrapped.startsWith("::ffff:")))
  ) {
    return true;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return false;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}
