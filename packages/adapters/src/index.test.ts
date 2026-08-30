import { describe, expect, it, vi } from "vitest";

import { createPlatformAdapterRegistryService } from "./index";

const now = new Date("2026-08-30T15:00:00.000Z");
const actor = {
  operatorId: "00000000-0000-4000-8000-000000000101",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:adapters:write"],
  stepUpVerifiedAt: now,
};
const capabilities = [
  "detect",
  "understand",
  "modify",
  "validate",
  "preview",
  "deploy",
  "operate",
  "migrate",
].map((name) => ({
  name: name as
    | "detect"
    | "understand"
    | "modify"
    | "validate"
    | "preview"
    | "deploy"
    | "operate"
    | "migrate",
  maturity: name === "detect" ? ("stable" as const) : ("unsupported" as const),
}));

function createStore() {
  return {
    listRegistry: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    setRelease: vi.fn(async (input: { releaseId: string }) => ({
      outcome: "created" as const,
      id: input.releaseId,
      revisionNumber: 1,
    })),
  };
}

function validCommand() {
  return {
    actor,
    key: "django",
    version: "1.2.0",
    displayName: "Django",
    category: "framework" as const,
    packageName: "@arth/django-adapter",
    packageDigestSha256: "a".repeat(64),
    documentationUrl: "https://docs.arth.sh/adapters/django",
    capabilities,
    declaredPermissions: ["repository:read"],
    configurationFields: [
      {
        key: "python_version",
        label: "Python version",
        type: "string" as const,
        required: true,
      },
    ],
    commands: [
      {
        key: "detect",
        description: "Detect a Django repository.",
        risk: "read" as const,
      },
    ],
    supportedEnvironments: ["development", "production"],
    compatibilityTags: ["python:3.13", "django:5"],
    requiredSecretPurposes: [],
    healthChecks: [
      { key: "doctor", command: "arth-adapter doctor", timeoutSeconds: 30 },
    ],
    releaseChannel: "stable" as const,
    signatureStatus: "verified" as const,
    securityReviewStatus: "approved" as const,
    securityReviewReference: "SEC-2026-0042",
    lifecycle: "active" as const,
    reason: "Publish the reviewed Django adapter release.",
  };
}

describe("platform adapter registry", () => {
  it("publishes a fully declared reviewed release", async () => {
    const store = createStore();
    const service = createPlatformAdapterRegistryService({
      store,
      environment: "development",
      now: () => now,
      randomId: () => "00000000-0000-4000-8000-000000000901",
    });
    await expect(service.setRelease(validCommand())).resolves.toMatchObject({
      outcome: "created",
      revisionNumber: 1,
    });
    expect(store.setRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "django",
        packageName: "@arth/django-adapter",
        capabilities: expect.arrayContaining([
          { name: "detect", maturity: "stable" },
          { name: "migrate", maturity: "unsupported" },
        ]),
      }),
    );
  });

  it("rejects incomplete capability matrices", async () => {
    const service = createPlatformAdapterRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setRelease({
        ...validCommand(),
        capabilities: capabilities.slice(0, 7),
      }),
    ).rejects.toMatchObject({ reason: "adapter_capabilities_incomplete" });
  });

  it("requires verified signing and approved review evidence for activation", async () => {
    const service = createPlatformAdapterRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setRelease({
        ...validCommand(),
        releaseChannel: "beta",
        signatureStatus: "unverified",
      }),
    ).rejects.toMatchObject({
      reason: "adapter_activation_evidence_incomplete",
    });
  });

  it("forces invalid or rejected releases into blocked lifecycle", async () => {
    const service = createPlatformAdapterRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setRelease({
        ...validCommand(),
        releaseChannel: "internal",
        lifecycle: "draft",
        signatureStatus: "invalid",
      }),
    ).rejects.toMatchObject({ reason: "unsafe_adapter_must_be_blocked" });
  });

  it("requires a named reason when a release is blocked", async () => {
    const service = createPlatformAdapterRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setRelease({
        ...validCommand(),
        releaseChannel: "internal",
        lifecycle: "blocked",
        signatureStatus: "invalid",
        securityReviewStatus: "rejected",
      }),
    ).rejects.toMatchObject({ reason: "adapter_block_reason_required" });
  });

  it("requires recent step-up for release revisions", async () => {
    const service = createPlatformAdapterRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setRelease({
        ...validCommand(),
        actor: {
          ...actor,
          stepUpVerifiedAt: new Date(now.getTime() - 10 * 60_000),
        },
      }),
    ).rejects.toThrow("recent_step_up_required");
  });
});
