import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  createCloudflareSecretsStoreProvider,
  createPlatformSecretLifecycleService,
  PlatformSecretProviderError,
  type PlatformSecretLifecycleStore,
  type PlatformSecretMaterialProvider,
} from "./index";

const now = new Date("2026-08-30T12:00:00.000Z");
const actor: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: now,
};

function createStore(): PlatformSecretLifecycleStore {
  return {
    listReferences: vi.fn(async () => []),
    beginCreate: vi.fn(async () => ({ outcome: "created" as const })),
    completeCreate: vi.fn(async () => undefined),
    failCreate: vi.fn(async () => undefined),
    beginRotation: vi.fn(async () => ({
      outcome: "started" as const,
      externalId: "provider-secret-id",
      providerName: "atharvan_development_models_openai_00000000",
    })),
    completeRotation: vi.fn(async () => undefined),
    failRotation: vi.fn(async () => undefined),
    beginRevocation: vi.fn(async () => ({
      outcome: "started" as const,
      externalId: "provider-secret-id",
    })),
    completeRevocation: vi.fn(async () => undefined),
    failRevocation: vi.fn(async () => undefined),
  };
}

function createProvider(): PlatformSecretMaterialProvider {
  return {
    configured: true,
    create: vi.fn(async () => ({ externalId: "provider-secret-id" })),
    rotate: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
  };
}

function createService(store = createStore(), provider = createProvider()) {
  let sequence = 0;
  return {
    store,
    provider,
    service: createPlatformSecretLifecycleService({
      store,
      provider,
      environment: "development",
      now: () => now,
      randomId: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    }),
  };
}

describe("platform secret lifecycle", () => {
  it("stores metadata only and never passes material to PostgreSQL", async () => {
    const { service, store, provider } = createService();
    const value = "provider-key-that-must-not-enter-postgres";
    const result = await service.create({
      actor,
      key: "models.openai",
      purpose: "Platform model routing",
      value,
      reason: "Provision development model access.",
    });

    expect(result.outcome).toBe("created");
    expect(store.beginCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "models.openai",
        purpose: "Platform model routing",
      }),
    );
    expect(
      JSON.stringify(vi.mocked(store.beginCreate).mock.calls),
    ).not.toContain(value);
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        value,
        name: expect.stringContaining("models_openai"),
      }),
    );
    expect(store.completeCreate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "provider-secret-id" }),
    );
  });

  it("keeps the previous version active until provider rotation succeeds", async () => {
    const { service, store, provider } = createService();
    await service.rotate({
      actor,
      referenceId: "00000000-0000-4000-8000-000000000301",
      value: "replacement-provider-key",
      reason: "Scheduled credential rotation.",
    });
    expect(store.beginRotation).toHaveBeenCalledBefore(
      vi.mocked(provider.rotate),
    );
    expect(provider.rotate).toHaveBeenCalledBefore(
      vi.mocked(store.completeRotation),
    );
  });

  it("records a failed state without leaking provider error details", async () => {
    const store = createStore();
    const provider = createProvider();
    vi.mocked(provider.rotate).mockRejectedValue(
      new Error("upstream response contained replacement-provider-key"),
    );
    const { service } = createService(store, provider);
    await expect(
      service.rotate({
        actor,
        referenceId: "00000000-0000-4000-8000-000000000301",
        value: "replacement-provider-key",
        reason: "Scheduled credential rotation.",
      }),
    ).rejects.toEqual(new PlatformSecretProviderError("request_failed"));
    expect(store.failRotation).toHaveBeenCalledOnce();
    expect(store.completeRotation).not.toHaveBeenCalled();
  });

  it("fails before reserving database state when the provider is absent", async () => {
    const store = createStore();
    const provider = { ...createProvider(), configured: false };
    const { service } = createService(store, provider);
    await expect(
      service.create({
        actor,
        key: "models.openai",
        purpose: "Platform model routing",
        value: "provider-key",
        reason: "Provision development model access.",
      }),
    ).rejects.toEqual(new PlatformSecretProviderError("unconfigured"));
    expect(store.beginCreate).not.toHaveBeenCalled();
  });
});

describe("Cloudflare Secrets Store adapter", () => {
  it("uses metadata-only responses and a bearer token for create", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        result: [{ id: "cloudflare-secret-id", name: "provider_name" }],
      }),
    );
    const provider = createCloudflareSecretsStoreProvider({
      accountId: "account-id",
      storeId: "store-id",
      apiToken: "secrets-store-write-token",
      fetch: fetchMock,
    });
    await expect(
      provider.create({
        name: "provider_name",
        value: "provider-value",
        comment: "Platform credential",
      }),
    ).resolves.toEqual({ externalId: "cloudflare-secret-id" });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account-id/secrets_store/stores/store-id/secrets",
    );
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer secrets-store-write-token",
    );
    expect(request?.body).toContain("provider-value");
  });

  it("treats an already-deleted provider secret as revoked", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 404 }),
    );
    const provider = createCloudflareSecretsStoreProvider({
      accountId: "account-id",
      storeId: "store-id",
      apiToken: "secrets-store-write-token",
      fetch: fetchMock,
    });
    await expect(
      provider.revoke({ externalId: "already-deleted" }),
    ).resolves.toBeUndefined();
  });
});
