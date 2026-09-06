export type ResendEmailEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.failed"
  | "email.bounced"
  | "email.complained"
  | "email.suppressed";

export interface VerifiedResendEmailEvent {
  readonly providerEventId: string;
  readonly providerMessageId: string;
  readonly type: ResendEmailEventType;
  readonly occurredAt: Date;
  readonly payloadDigest: string;
}

const supportedEvents = new Set<ResendEmailEventType>([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);

/** Verify the raw Svix envelope used by Resend before parsing bounded metadata. */
export async function verifyResendEmailWebhook(input: {
  readonly body: string;
  readonly eventId: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
  readonly secret: string;
  readonly now?: Date;
}): Promise<VerifiedResendEmailEvent> {
  const now = input.now ?? new Date();
  if (
    input.body.length === 0 ||
    new TextEncoder().encode(input.body).byteLength > 65_536 ||
    !input.eventId ||
    input.eventId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/u.test(input.eventId) ||
    !input.timestamp ||
    !/^[0-9]{10}$/u.test(input.timestamp) ||
    !input.signature
  )
    throw new Error("resend_webhook_invalid");
  const timestampSeconds = Number(input.timestamp);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(now.getTime() - timestampSeconds * 1_000) > 5 * 60_000
  )
    throw new Error("resend_webhook_expired");
  const secretValue = input.secret.startsWith("whsec_")
    ? input.secret.slice("whsec_".length)
    : input.secret;
  let secretBytes: Uint8Array<ArrayBuffer>;
  try {
    secretBytes = decodeBase64(secretValue);
  } catch {
    throw new Error("resend_webhook_unconfigured");
  }
  if (secretBytes.byteLength < 16)
    throw new Error("resend_webhook_unconfigured");
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new TextEncoder().encode(
    `${input.eventId}.${input.timestamp}.${input.body}`,
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, signed),
  );
  const candidates = input.signature
    .split(/\s+/u)
    .flatMap((part) => (part.startsWith("v1,") ? [part.slice(3)] : []));
  const valid = candidates.some((candidate) => {
    try {
      return constantTimeEqual(expected, decodeBase64(candidate));
    } catch {
      return false;
    }
  });
  if (!valid) throw new Error("resend_webhook_signature_invalid");

  let payload: unknown;
  try {
    payload = JSON.parse(input.body);
  } catch {
    throw new Error("resend_webhook_payload_invalid");
  }
  if (!isRecord(payload) || !isRecord(payload.data))
    throw new Error("resend_webhook_payload_invalid");
  const type = payload.type;
  const providerMessageId = payload.data.email_id;
  const occurredAt = new Date(
    typeof payload.created_at === "string" ? payload.created_at : "",
  );
  if (
    typeof type !== "string" ||
    !supportedEvents.has(type as ResendEmailEventType) ||
    typeof providerMessageId !== "string" ||
    providerMessageId.length < 1 ||
    providerMessageId.length > 256 ||
    !Number.isFinite(occurredAt.getTime()) ||
    occurredAt.getTime() > now.getTime() + 5 * 60_000 ||
    occurredAt.getTime() < now.getTime() - 7 * 24 * 60 * 60_000
  )
    throw new Error("resend_webhook_payload_invalid");
  return {
    providerEventId: input.eventId,
    providerMessageId,
    type: type as ResendEmailEventType,
    occurredAt,
    payloadDigest: await sha256Hex(input.body),
  };
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  ) as Uint8Array<ArrayBuffer>;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index++)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
