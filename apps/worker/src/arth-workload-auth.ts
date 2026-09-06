import type { AuthenticationRuntimeConfig } from "@atharvan/config";

const maximumBodyBytes = 1024 * 1024;
const maximumClockSkewSeconds = 60;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const signaturePattern = /^v1=([0-9a-f]{64})$/u;

export class ArthWorkloadAuthenticationError extends Error {
  constructor(readonly reason: string) {
    super("arth_workload_authentication_failed");
  }
}

export async function authenticateArthWorkloadRequest(
  request: Request,
  config: AuthenticationRuntimeConfig,
  now = new Date(),
) {
  const audience = config.ATHARVAN_ARTH_AUDIENCE;
  const currentKeyId = config.ATHARVAN_ARTH_CURRENT_KEY_ID;
  const currentSecret = config.ATHARVAN_ARTH_CURRENT_SHARED_SECRET;
  if (!audience || !currentKeyId || !currentSecret)
    reject("arth_workload_authentication_unconfigured");

  const keyId = request.headers.get("x-atharvan-key-id")?.trim() ?? "";
  const timestampText =
    request.headers.get("x-atharvan-timestamp")?.trim() ?? "";
  const nonce =
    request.headers.get("x-atharvan-nonce")?.trim().toLowerCase() ?? "";
  const contentSha256 =
    request.headers.get("x-atharvan-content-sha256")?.trim().toLowerCase() ??
    "";
  const signatureHeader =
    request.headers.get("x-atharvan-signature")?.trim().toLowerCase() ?? "";
  const signatureMatch = signaturePattern.exec(signatureHeader);
  if (
    !uuidPattern.test(nonce) ||
    !sha256Pattern.test(contentSha256) ||
    !signatureMatch
  ) {
    reject("arth_workload_authentication_invalid");
  }
  const timestampSeconds = Number(timestampText);
  if (!Number.isSafeInteger(timestampSeconds))
    reject("arth_workload_authentication_invalid");
  const requestTime = new Date(timestampSeconds * 1_000);
  if (
    Math.abs(Math.floor(now.getTime() / 1_000) - timestampSeconds) >
    maximumClockSkewSeconds
  ) {
    reject("arth_workload_request_expired");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBodyBytes)
    reject("arth_workload_body_too_large");
  const body = await readBoundedBody(request.clone(), maximumBodyBytes);
  const actualContentSha256 = bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
  );
  if (actualContentSha256 !== contentSha256)
    reject("arth_workload_content_digest_invalid");

  const secret =
    keyId === currentKeyId
      ? currentSecret
      : keyId === config.ATHARVAN_ARTH_PREVIOUS_KEY_ID
        ? config.ATHARVAN_ARTH_PREVIOUS_SHARED_SECRET
        : undefined;
  if (!secret) reject("arth_workload_key_unknown");
  const url = new URL(request.url);
  const canonical = [
    "v1",
    request.method.toUpperCase(),
    `${url.pathname}${url.search}`,
    contentSha256,
    timestampText,
    nonce,
    audience,
  ].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signatureMatch[1]!),
    new TextEncoder().encode(canonical),
  );
  if (!valid) reject("arth_workload_signature_invalid");
  return { keyId, nonce, requestTime, contentSha256 };
}

async function readBoundedBody(
  request: { readonly body: ReadableStream<Uint8Array> | null },
  maximumBytes: number,
) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) reject("arth_workload_body_too_large");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2)
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return bytes;
}

function bytesToHex(value: Uint8Array) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function reject(reason: string): never {
  throw new ArthWorkloadAuthenticationError(reason);
}
