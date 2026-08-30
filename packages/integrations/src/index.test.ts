import { describe, expect, it, vi } from "vitest";

import { createPlatformIntegrationRegistryService } from "./index";

const now = new Date("2026-08-30T10:00:00.000Z");
const actor = {
  operatorId: "00000000-0000-4000-8000-000000000101",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:integrations:write"],
  stepUpVerifiedAt: now,
};

function createStore() {
  return {
    listRegistry: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    setIntegration: vi.fn(async (input: { integrationId: string }) => ({
      outcome: "created" as const,
      id: input.integrationId,
      revisionNumber: 1,
    })),
    recordHealthObservation: vi.fn(
      async (input: { observationId: string }) => ({
        outcome: "created" as const,
        id: input.observationId,
      }),
    ),
  };
}

describe("platform integration registry", () => {
  it("normalizes a complete OAuth registration without secret material", async () => {
    const store = createStore();
    const service = createPlatformIntegrationRegistryService({
      store,
      environment: "development",
      now: () => now,
      randomId: () => "00000000-0000-4000-8000-000000000801",
    });
    await service.setIntegration({
      actor,
      key: "GitHub",
      displayName: "GitHub",
      protocol: "oauth2",
      connectionMode: "direct",
      capabilities: ["source_control"],
      adapterPackage: "@arth/github",
      adapterVersion: "1.0.0",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientId: "public-client-id",
      clientSecretReferenceId: "00000000-0000-4000-8000-000000000301",
      webhookSecretReferenceId: null,
      callbackUrls: ["https://dev.admin.arth.sh/api/oauth/github/callback"],
      requiredScopes: ["repo:status", "read:user"],
      optionalScopes: [],
      lifecycle: "active",
      operationalState: "enabled",
      reason: "Register the development GitHub OAuth application.",
    });
    expect(store.setIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "github",
        requiredScopes: ["read:user", "repo:status"],
        clientId: "public-client-id",
      }),
    );
    expect(JSON.stringify(store.setIntegration.mock.calls[0])).not.toContain(
      "client-secret-value",
    );
  });

  it("rejects active OAuth applications without a secret reference", async () => {
    const service = createPlatformIntegrationRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setIntegration({
        actor,
        key: "github",
        displayName: "GitHub",
        protocol: "oauth2",
        connectionMode: "direct",
        capabilities: ["source_control"],
        adapterPackage: "@arth/github",
        adapterVersion: "1.0.0",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        clientId: "client-id",
        clientSecretReferenceId: null,
        callbackUrls: ["https://dev.admin.arth.sh/api/oauth/github/callback"],
        requiredScopes: ["read:user"],
        optionalScopes: [],
        lifecycle: "active",
        operationalState: "enabled",
        reason: "Activate GitHub for development operators.",
      }),
    ).rejects.toMatchObject({ reason: "oauth_configuration_incomplete" });
  });

  it("rejects overlapping scopes and permanent maintenance", async () => {
    const service = createPlatformIntegrationRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setIntegration({
        actor,
        key: "github",
        displayName: "GitHub",
        protocol: "oauth2",
        connectionMode: "direct",
        capabilities: ["source_control"],
        adapterPackage: "@arth/github",
        adapterVersion: "1.0.0",
        authorizationUrl: "https://github.com/oauth/authorize",
        tokenUrl: "https://github.com/oauth/token",
        clientId: "client-id",
        clientSecretReferenceId: "00000000-0000-4000-8000-000000000301",
        callbackUrls: ["https://dev.admin.arth.sh/api/oauth/github/callback"],
        requiredScopes: ["repo"],
        optionalScopes: ["repo"],
        lifecycle: "active",
        operationalState: "maintenance",
        reason: "Place GitHub into bounded maintenance.",
      }),
    ).rejects.toMatchObject({ reason: "integration_scope_overlap" });
  });

  it("requires recent step-up for registry revisions", async () => {
    const service = createPlatformIntegrationRegistryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setIntegration({
        actor: {
          ...actor,
          stepUpVerifiedAt: new Date(now.getTime() - 600_000),
        },
        key: "pagerduty",
        displayName: "PagerDuty",
        protocol: "api_key",
        connectionMode: "direct",
        capabilities: ["observability"],
        adapterPackage: "@arth/pagerduty",
        adapterVersion: "1.0.0",
        callbackUrls: [],
        requiredScopes: [],
        optionalScopes: [],
        lifecycle: "draft",
        operationalState: "disabled",
        reason: "Create the PagerDuty registry draft.",
      }),
    ).rejects.toThrow("recent_step_up_required");
  });
});
