import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";
import type { TransactionalEmailSender } from "@atharvan/email";

import {
  createOperatorOnboardingService,
  type OperatorOnboardingStore,
} from "./index";

const fixedNow = new Date("2026-08-28T12:00:00.000Z");
const verificationSecret = "v".repeat(32);
const superAdministrator: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: new Date("2026-08-28T11:59:00.000Z"),
};

function createStore(): OperatorOnboardingStore {
  return {
    bootstrapSuperAdministrator: vi.fn().mockResolvedValue({
      outcome: "created",
      id: "operator-1",
    }),
    addAllowedEmailDomain: vi.fn().mockResolvedValue({
      outcome: "created",
      id: "domain-1",
    }),
    disableAllowedEmailDomain: vi.fn().mockResolvedValue({
      outcome: "created",
      id: "domain-1",
    }),
    createInvitation: vi.fn().mockResolvedValue({
      outcome: "created",
      id: "invitation-1",
    }),
    prepareVerificationChallenge: vi
      .fn()
      .mockResolvedValue({ prepared: false }),
    recordVerificationDelivery: vi.fn().mockResolvedValue(undefined),
    abandonVerificationChallenge: vi.fn().mockResolvedValue(undefined),
    findVerificationAttemptContext: vi.fn().mockResolvedValue(null),
    recordFailedVerification: vi.fn().mockResolvedValue(undefined),
    activateVerifiedOperator: vi.fn().mockResolvedValue(false),
  };
}

function createEmailSender(): TransactionalEmailSender {
  return {
    sendFirstLoginVerification: vi.fn().mockResolvedValue({
      providerMessageId: "message-1",
      acceptedAt: fixedNow,
    }),
  };
}

function createService(
  store: OperatorOnboardingStore,
  emailSender = createEmailSender(),
) {
  return createOperatorOnboardingService({
    store,
    emailSender,
    verificationHmacSecret: verificationSecret,
    now: () => fixedNow,
  });
}

describe("operator onboarding commands", () => {
  it("normalizes a bootstrap identity while preserving singleton handling in the store", async () => {
    const store = createStore();
    const service = createService(store);

    await expect(
      service.bootstrapSuperAdministrator({
        email: " Owner@Example.COM ",
        reason: "Initial deployment bootstrap",
      }),
    ).resolves.toMatchObject({ outcome: "created" });

    expect(store.bootstrapSuperAdministrator).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedEmail: "owner@example.com",
        emailDomain: "example.com",
      }),
    );
  });

  it("requires Super Administrator step-up for allowlist mutations", async () => {
    const store = createStore();
    const service = createService(store);
    const staleActor = {
      ...superAdministrator,
      stepUpVerifiedAt: new Date("2026-08-28T11:54:59.000Z"),
    };

    await expect(
      service.addAllowedEmailDomain({
        actor: staleActor,
        domain: "example.com",
        reason: "Corporate identity domain",
      }),
    ).rejects.toThrow("recent_step_up_required");
    expect(store.addAllowedEmailDomain).not.toHaveBeenCalled();
  });

  it("rejects invitations that try to delegate wildcard or customer-private access", async () => {
    const store = createStore();
    const service = createService(store);

    await expect(
      service.createInvitation({
        actor: superAdministrator,
        email: "operator@example.com",
        organizationId: "arth",
        intendedCapabilities: ["customer-private:chats:read"],
        reason: "Support operator",
      }),
    ).rejects.toThrow("invalid_operator_capabilities");
    expect(store.createInvitation).not.toHaveBeenCalled();
  });

  it("rejects an invitation that is already expired before reaching storage", async () => {
    const store = createStore();
    const service = createService(store);

    await expect(
      service.createInvitation({
        actor: superAdministrator,
        email: "operator@example.com",
        organizationId: "arth",
        intendedCapabilities: ["platform:operators:read"],
        reason: "Support operator",
        expiresAt: fixedNow,
      }),
    ).rejects.toThrow("invitation_expiry_must_be_future");
    expect(store.createInvitation).not.toHaveBeenCalled();
  });

  it("returns the same non-enumerating verification response for unknown identities", async () => {
    const store = createStore();
    const emailSender = createEmailSender();
    const service = createService(store, emailSender);

    await expect(
      service.requestFirstLoginVerification({ email: "unknown@example.com" }),
    ).resolves.toEqual({ accepted: true });
    expect(emailSender.sendFirstLoginVerification).not.toHaveBeenCalled();
  });

  it("commits a digest-only challenge before sending and records delivery afterward", async () => {
    const store = createStore();
    vi.mocked(store.prepareVerificationChallenge).mockResolvedValue({
      prepared: true,
      email: "operator@example.com",
      correlationId: "00000000-0000-4000-8000-000000000010",
    });
    const emailSender = createEmailSender();
    const service = createService(store, emailSender);

    await service.requestFirstLoginVerification({
      email: "operator@example.com",
    });

    const preparedInput = vi.mocked(store.prepareVerificationChallenge).mock
      .calls[0]?.[0];
    const deliveredMessage = vi.mocked(emailSender.sendFirstLoginVerification)
      .mock.calls[0]?.[0];

    expect(preparedInput?.codeDigest).toBeTruthy();
    expect(preparedInput).not.toHaveProperty("code");
    expect(deliveredMessage?.code).toMatch(/^\d{6}$/);
    expect(store.recordVerificationDelivery).toHaveBeenCalledWith({
      challengeId: preparedInput?.challengeId,
      providerMessageId: "message-1",
    });
  });

  it("abandons an undelivered challenge without exposing provider failure", async () => {
    const store = createStore();
    vi.mocked(store.prepareVerificationChallenge).mockResolvedValue({
      prepared: true,
      email: "operator@example.com",
      correlationId: "00000000-0000-4000-8000-000000000010",
    });
    const emailSender: TransactionalEmailSender = {
      sendFirstLoginVerification: vi
        .fn()
        .mockRejectedValue(new Error("provider unavailable")),
    };
    const service = createService(store, emailSender);

    await expect(
      service.requestFirstLoginVerification({
        email: "operator@example.com",
      }),
    ).resolves.toEqual({ accepted: true });
    expect(store.abandonVerificationChallenge).toHaveBeenCalledOnce();
  });

  it("records invalid attempts and atomically delegates successful activation", async () => {
    const store = createStore();
    const emailSender = createEmailSender();
    vi.mocked(store.prepareVerificationChallenge).mockResolvedValue({
      prepared: true,
      email: "operator@example.com",
      correlationId: "00000000-0000-4000-8000-000000000010",
    });
    const service = createService(store, emailSender);

    await service.requestFirstLoginVerification({
      email: "operator@example.com",
    });
    const challengeId = vi.mocked(store.prepareVerificationChallenge).mock
      .calls[0]?.[0].challengeId;
    const codeDigest = vi.mocked(store.prepareVerificationChallenge).mock
      .calls[0]?.[0].codeDigest;
    const code = vi.mocked(emailSender.sendFirstLoginVerification).mock
      .calls[0]?.[0].code;

    vi.mocked(store.findVerificationAttemptContext).mockResolvedValue({
      challengeId: challengeId!,
      codeDigest: codeDigest!,
    });

    await expect(
      service.verifyAndActivate({
        email: "operator@example.com",
        code: "000000",
      }),
    ).resolves.toMatchObject({ activated: false });
    expect(store.recordFailedVerification).toHaveBeenCalledOnce();

    vi.mocked(store.activateVerifiedOperator).mockResolvedValue(true);
    await expect(
      service.verifyAndActivate({
        email: "operator@example.com",
        code: code!,
      }),
    ).resolves.toEqual({ activated: true });
    expect(store.activateVerifiedOperator).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId,
        expectedDigest: codeDigest,
        normalizedEmail: "operator@example.com",
      }),
    );
  });
});
