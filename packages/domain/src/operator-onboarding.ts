const verificationCodeLength = 6;
const verificationCodeRange = 10 ** verificationCodeLength;
const maximumUint32 = 2 ** 32;
const unbiasedUint32Limit =
  Math.floor(maximumUint32 / verificationCodeRange) * verificationCodeRange;

const domainLabelPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const emailLocalPartPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

export interface ActiveEmailDomainRule {
  readonly domain: string;
  readonly includeSubdomains: boolean;
  readonly isActive: boolean;
}

export type OperatorLifecycleStatus =
  "invited" | "verification_pending" | "active" | "suspended" | "deactivated";

export type OperatorInvitationStatus =
  "pending" | "accepted" | "expired" | "revoked";

export type VerificationChallengeStatus =
  "pending" | "consumed" | "expired" | "locked" | "superseded";

export type ActivationDenialReason =
  | "identity_mismatch"
  | "domain_not_allowed"
  | "invitation_unavailable"
  | "invitation_expired"
  | "operator_unavailable"
  | "challenge_unavailable"
  | "challenge_expired"
  | "challenge_attempts_exhausted";

export type ActivationPolicyResult =
  | {
      readonly allowed: true;
      readonly normalizedEmail: string;
      readonly emailDomain: string;
    }
  | {
      readonly allowed: false;
      readonly reason: ActivationDenialReason;
    };

export interface ActivationPolicyInput {
  readonly submittedEmail: string;
  readonly invitedEmail: string;
  readonly operatorStatus: OperatorLifecycleStatus;
  readonly invitationStatus: OperatorInvitationStatus;
  readonly invitationExpiresAt: Date;
  readonly challengeStatus: VerificationChallengeStatus;
  readonly challengeExpiresAt: Date;
  readonly challengeAttemptCount: number;
  readonly challengeMaximumAttempts: number;
  readonly domainRules: ReadonlyArray<ActiveEmailDomainRule>;
  readonly now: Date;
}

export interface VerificationIssuancePolicyInput {
  readonly submittedEmail: string;
  readonly invitedEmail: string;
  readonly operatorStatus: OperatorLifecycleStatus;
  readonly invitationStatus: OperatorInvitationStatus;
  readonly invitationExpiresAt: Date;
  readonly domainRules: ReadonlyArray<ActiveEmailDomainRule>;
  readonly now: Date;
}

export function normalizeOrganizationDomain(input: string): string {
  const normalized = input.trim().toLowerCase().replace(/\.$/, "");

  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes("@") ||
    normalized.includes("..")
  ) {
    throw new Error("invalid_organization_domain");
  }

  const labels = normalized.split(".");

  if (
    labels.length < 2 ||
    labels.some((label) => !domainLabelPattern.test(label))
  ) {
    throw new Error("invalid_organization_domain");
  }

  return normalized;
}

export function normalizeOperatorEmail(input: string): string {
  const normalized = input.trim().toLowerCase();
  const separatorIndex = normalized.lastIndexOf("@");

  if (
    normalized.length > 254 ||
    separatorIndex <= 0 ||
    separatorIndex !== normalized.indexOf("@")
  ) {
    throw new Error("invalid_operator_email");
  }

  const localPart = normalized.slice(0, separatorIndex);
  const domain = normalized.slice(separatorIndex + 1);

  if (
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !emailLocalPartPattern.test(localPart)
  ) {
    throw new Error("invalid_operator_email");
  }

  return `${localPart}@${normalizeOrganizationDomain(domain)}`;
}

export function getOperatorEmailDomain(email: string): string {
  const normalizedEmail = normalizeOperatorEmail(email);
  return normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1);
}

export function isOperatorEmailDomainAllowed(
  email: string,
  rules: ReadonlyArray<ActiveEmailDomainRule>,
): boolean {
  const emailDomain = getOperatorEmailDomain(email);

  return rules.some((rule) => {
    if (!rule.isActive) {
      return false;
    }

    const allowedDomain = normalizeOrganizationDomain(rule.domain);

    return (
      emailDomain === allowedDomain ||
      (rule.includeSubdomains && emailDomain.endsWith(`.${allowedDomain}`))
    );
  });
}

export function evaluateOperatorActivation(
  input: ActivationPolicyInput,
): ActivationPolicyResult {
  const issuanceResult = evaluateVerificationIssuance(input);

  if (!issuanceResult.allowed) {
    return issuanceResult;
  }

  if (input.challengeStatus !== "pending") {
    return { allowed: false, reason: "challenge_unavailable" };
  }

  if (input.challengeExpiresAt.getTime() <= input.now.getTime()) {
    return { allowed: false, reason: "challenge_expired" };
  }

  if (input.challengeAttemptCount >= input.challengeMaximumAttempts) {
    return { allowed: false, reason: "challenge_attempts_exhausted" };
  }

  return issuanceResult;
}

export function evaluateVerificationIssuance(
  input: VerificationIssuancePolicyInput,
): ActivationPolicyResult {
  let submittedEmail: string;
  let invitedEmail: string;

  try {
    submittedEmail = normalizeOperatorEmail(input.submittedEmail);
    invitedEmail = normalizeOperatorEmail(input.invitedEmail);
  } catch {
    return { allowed: false, reason: "identity_mismatch" };
  }

  if (submittedEmail !== invitedEmail) {
    return { allowed: false, reason: "identity_mismatch" };
  }

  if (!isOperatorEmailDomainAllowed(submittedEmail, input.domainRules)) {
    return { allowed: false, reason: "domain_not_allowed" };
  }

  if (input.invitationStatus !== "pending") {
    return { allowed: false, reason: "invitation_unavailable" };
  }

  if (input.invitationExpiresAt.getTime() <= input.now.getTime()) {
    return { allowed: false, reason: "invitation_expired" };
  }

  if (
    input.operatorStatus !== "invited" &&
    input.operatorStatus !== "verification_pending"
  ) {
    return { allowed: false, reason: "operator_unavailable" };
  }

  return {
    allowed: true,
    normalizedEmail: submittedEmail,
    emailDomain: getOperatorEmailDomain(submittedEmail),
  };
}

export function generateVerificationCode(): string {
  const values = new Uint32Array(1);
  let value: number;

  do {
    crypto.getRandomValues(values);
    value = values[0] ?? maximumUint32;
  } while (value >= unbiasedUint32Limit);

  return (value % verificationCodeRange)
    .toString()
    .padStart(verificationCodeLength, "0");
}

export async function digestVerificationCode(input: {
  readonly code: string;
  readonly challengeId: string;
  readonly secret: string;
}): Promise<string> {
  validateVerificationMaterial(input);

  const key = await importVerificationKey(input.secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${input.challengeId}:${input.code}`),
  );

  return encodeBase64Url(new Uint8Array(signature));
}

export async function verifyVerificationCode(input: {
  readonly code: string;
  readonly challengeId: string;
  readonly secret: string;
  readonly expectedDigest: string;
}): Promise<boolean> {
  try {
    validateVerificationMaterial(input);
    const signature = decodeBase64Url(input.expectedDigest);
    const key = await importVerificationKey(input.secret);

    return await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      new TextEncoder().encode(`${input.challengeId}:${input.code}`),
    );
  } catch {
    return false;
  }
}

function validateVerificationMaterial(input: {
  readonly code: string;
  readonly challengeId: string;
  readonly secret: string;
}): void {
  if (!/^\d{6}$/.test(input.code) || input.challengeId.length === 0) {
    throw new Error("invalid_verification_material");
  }

  if (new TextEncoder().encode(input.secret).byteLength < 32) {
    throw new Error("verification_secret_too_short");
  }
}

async function importVerificationKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid_verification_digest");
  }

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
