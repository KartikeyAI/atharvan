import { describe, expect, it } from "vitest";

import {
  digestVerificationCode,
  evaluateOperatorActivation,
  evaluateVerificationIssuance,
  generateVerificationCode,
  getOperatorEmailDomain,
  isOperatorEmailDomainAllowed,
  normalizeOperatorEmail,
  normalizeOrganizationDomain,
  verifyVerificationCode,
  type ActivationPolicyInput,
} from "./operator-onboarding";

const activeRule = {
  domain: "rokad.co",
  includeSubdomains: false,
  isActive: true,
} as const;

const activationInput: ActivationPolicyInput = {
  submittedEmail: "operator@rokad.co",
  invitedEmail: "operator@rokad.co",
  operatorStatus: "verification_pending",
  invitationStatus: "pending",
  invitationExpiresAt: new Date("2026-08-29T00:00:00.000Z"),
  challengeStatus: "pending",
  challengeExpiresAt: new Date("2026-08-28T23:10:00.000Z"),
  challengeAttemptCount: 0,
  challengeMaximumAttempts: 5,
  domainRules: [activeRule],
  now: new Date("2026-08-28T23:00:00.000Z"),
};

describe("operator identity normalization", () => {
  it("normalizes exact email and domain values", () => {
    expect(normalizeOrganizationDomain(" ROKAD.CO. ")).toBe("rokad.co");
    expect(normalizeOperatorEmail(" Operator@ROKAD.CO ")).toBe(
      "operator@rokad.co",
    );
    expect(getOperatorEmailDomain("operator@rokad.co")).toBe("rokad.co");
  });

  it("rejects malformed values instead of guessing", () => {
    expect(() => normalizeOrganizationDomain("rokad")).toThrow(
      "invalid_organization_domain",
    );
    expect(() => normalizeOperatorEmail("operator@@rokad.co")).toThrow(
      "invalid_operator_email",
    );
  });
});

describe("organisation email-domain allowlist", () => {
  it("uses exact domain matching and does not accept suffix attacks", () => {
    expect(isOperatorEmailDomainAllowed("a@rokad.co", [activeRule])).toBe(true);
    expect(isOperatorEmailDomainAllowed("a@evilrokad.co", [activeRule])).toBe(
      false,
    );
    expect(isOperatorEmailDomainAllowed("a@team.rokad.co", [activeRule])).toBe(
      false,
    );
  });

  it("allows subdomains only when the rule explicitly enables them", () => {
    expect(
      isOperatorEmailDomainAllowed("a@team.rokad.co", [
        { ...activeRule, includeSubdomains: true },
      ]),
    ).toBe(true);
    expect(
      isOperatorEmailDomainAllowed("a@rokad.co", [
        { ...activeRule, isActive: false },
      ]),
    ).toBe(false);
  });
});

describe("first-login activation policy", () => {
  it("will not issue a code to an unknown or non-allowlisted identity", () => {
    expect(
      evaluateVerificationIssuance({
        submittedEmail: "unknown@rokad.co",
        invitedEmail: "operator@rokad.co",
        operatorStatus: "invited",
        invitationStatus: "pending",
        invitationExpiresAt: activationInput.invitationExpiresAt,
        domainRules: [activeRule],
        now: activationInput.now,
      }),
    ).toEqual({ allowed: false, reason: "identity_mismatch" });
    expect(
      evaluateVerificationIssuance({
        submittedEmail: "operator@rokad.co",
        invitedEmail: "operator@rokad.co",
        operatorStatus: "invited",
        invitationStatus: "pending",
        invitationExpiresAt: activationInput.invitationExpiresAt,
        domainRules: [],
        now: activationInput.now,
      }),
    ).toEqual({ allowed: false, reason: "domain_not_allowed" });
  });

  it("allows only the exact invited identity in a valid state", () => {
    expect(evaluateOperatorActivation(activationInput)).toEqual({
      allowed: true,
      normalizedEmail: "operator@rokad.co",
      emailDomain: "rokad.co",
    });
  });

  it.each([
    ["identity_mismatch", { submittedEmail: "other@rokad.co" }],
    ["domain_not_allowed", { domainRules: [] }],
    ["invitation_unavailable", { invitationStatus: "revoked" }],
    [
      "invitation_expired",
      { invitationExpiresAt: new Date("2026-08-28T22:59:59.000Z") },
    ],
    ["operator_unavailable", { operatorStatus: "suspended" }],
    ["challenge_unavailable", { challengeStatus: "consumed" }],
    [
      "challenge_expired",
      { challengeExpiresAt: new Date("2026-08-28T22:59:59.000Z") },
    ],
    [
      "challenge_attempts_exhausted",
      { challengeAttemptCount: 5, challengeMaximumAttempts: 5 },
    ],
  ] as const)("denies %s", (reason, override) => {
    expect(
      evaluateOperatorActivation({ ...activationInput, ...override }),
    ).toEqual({ allowed: false, reason });
  });
});

describe("verification-code material", () => {
  const secret = "a-secure-test-secret-with-at-least-32-bytes";
  const challengeId = "challenge-1";

  it("generates fixed-width numeric codes with secure randomness", () => {
    for (let index = 0; index < 32; index += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it("stores a context-bound HMAC digest and verifies through Web Crypto", async () => {
    const expectedDigest = await digestVerificationCode({
      code: "123456",
      challengeId,
      secret,
    });

    expect(expectedDigest).not.toContain("123456");
    await expect(
      verifyVerificationCode({
        code: "123456",
        challengeId,
        secret,
        expectedDigest,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyVerificationCode({
        code: "654321",
        challengeId,
        secret,
        expectedDigest,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyVerificationCode({
        code: "123456",
        challengeId: "challenge-2",
        secret,
        expectedDigest,
      }),
    ).resolves.toBe(false);
  });
});
