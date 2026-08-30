import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  createModelCatalogueService,
  ModelCatalogueCommandRejectedError,
  type ModelCatalogueStore,
} from "./index";

const now = new Date("2026-08-30T12:00:00.000Z");
const actor: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:models:read", "platform:models:write"],
  stepUpVerifiedAt: now,
};
const actorWithoutStepUp: AuthenticatedOperator = {
  operatorId: actor.operatorId,
  isSuperAdministrator: actor.isSuperAdministrator,
  effectiveCapabilities: actor.effectiveCapabilities,
};

function createStore(): ModelCatalogueStore {
  return {
    listCatalogue: vi.fn(async ({ environment }) => ({
      environment,
      items: [],
    })),
    setProvider: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.providerId,
      revisionNumber: 1,
    })),
    setModel: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.modelId,
      revisionNumber: 1,
    })),
    recordHealthObservation: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.observationId,
    })),
  };
}

function createService(store = createStore()) {
  let sequence = 0;
  return {
    store,
    service: createModelCatalogueService({
      store,
      environment: "development",
      now: () => now,
      randomId: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    }),
  };
}

describe("model provider catalogue", () => {
  it("normalizes provider metadata and binds only a secret reference id", async () => {
    const { service, store } = createService();
    await service.setProvider({
      actor,
      key: " OpenAI ",
      displayName: " OpenAI ",
      adapterKind: "openai",
      baseUrl: "https://api.openai.com/v1/",
      credentialReferenceId: "00000000-0000-4000-8000-000000000301",
      regions: ["Global", "global"],
      maximumDataClassification: "confidential",
      lifecycle: "active",
      reason: "Register the development provider.",
    });

    expect(store.setProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "openai",
        displayName: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        credentialReferenceId: "00000000-0000-4000-8000-000000000301",
        regions: ["global"],
      }),
    );
    expect(JSON.stringify(vi.mocked(store.setProvider).mock.calls)).not.toMatch(
      /secretValue|apiKey|credentialValue/i,
    );
  });

  it("requires recent step-up proof for catalogue mutations", async () => {
    const { service } = createService();
    await expect(
      service.setProvider({
        actor: actorWithoutStepUp,
        key: "openai",
        displayName: "OpenAI",
        adapterKind: "openai",
        regions: ["global"],
        maximumDataClassification: "confidential",
        lifecycle: "draft",
        reason: "Register the development provider.",
      }),
    ).rejects.toThrow("recent_step_up_required");
  });

  it("rejects credential-bearing and non-HTTPS base URLs", async () => {
    const { service } = createService();
    await expect(
      service.setProvider({
        actor,
        key: "openai",
        displayName: "OpenAI",
        adapterKind: "openai",
        baseUrl: "https://token@example.com/v1",
        regions: ["global"],
        maximumDataClassification: "internal",
        lifecycle: "draft",
        reason: "Register the development provider.",
      }),
    ).rejects.toEqual(
      new ModelCatalogueCommandRejectedError("provider_base_url_invalid"),
    );
  });
});

describe("model catalogue", () => {
  it("canonicalizes capabilities, regions, and pricing", async () => {
    const { service, store } = createService();
    await service.setModel({
      actor,
      providerId: "00000000-0000-4000-8000-000000000201",
      key: "gpt-5.6",
      displayName: "GPT 5.6",
      kind: "generation",
      capabilities: ["tool_use", "reasoning", "tool_use"],
      contextWindowTokens: 400_000,
      maximumOutputTokens: 128_000,
      inputPriceMicrounitsPerMillion: 2_500_000,
      outputPriceMicrounitsPerMillion: 15_000_000,
      regions: ["us", "eu", "us"],
      maximumDataClassification: "confidential",
      lifecycle: "active",
      reason: "Publish the verified model metadata.",
    });

    expect(store.setModel).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: ["reasoning", "tool_use"],
        regions: ["eu", "us"],
        inputPriceMicrounitsPerMillion: 2_500_000,
      }),
    );
  });

  it("keeps embedding and generation contracts distinct", async () => {
    const { service } = createService();
    await expect(
      service.setModel({
        actor,
        providerId: "00000000-0000-4000-8000-000000000201",
        key: "embedding-1",
        displayName: "Embedding 1",
        kind: "embedding",
        capabilities: ["embeddings", "reasoning"],
        contextWindowTokens: 8_192,
        inputPriceMicrounitsPerMillion: 100_000,
        outputPriceMicrounitsPerMillion: 0,
        regions: ["global"],
        maximumDataClassification: "internal",
        lifecycle: "active",
        reason: "Publish the embedding metadata.",
      }),
    ).rejects.toEqual(
      new ModelCatalogueCommandRejectedError("model_capabilities_invalid"),
    );
  });
});

describe("provider health evidence", () => {
  it("records bounded, expiring observations without arbitrary evidence", async () => {
    const { service, store } = createService();
    await service.recordHealthObservation({
      actor: actorWithoutStepUp,
      providerId: "00000000-0000-4000-8000-000000000201",
      status: "degraded",
      latencyMs: 1_250,
      httpStatusCode: 429,
      errorCode: "RATE_LIMITED",
      reason: "Recorded from an authenticated provider probe.",
    });

    expect(store.recordHealthObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "degraded",
        source: "operator_probe",
        errorCode: "rate_limited",
        observedAt: now,
        expiresAt: new Date("2026-08-30T12:05:00.000Z"),
      }),
    );
  });

  it("does not allow a healthy observation to carry an error code", async () => {
    const { service } = createService();
    await expect(
      service.recordHealthObservation({
        actor,
        providerId: "00000000-0000-4000-8000-000000000201",
        status: "healthy",
        errorCode: "unexpected_error",
        reason: "Recorded from an authenticated provider probe.",
      }),
    ).rejects.toEqual(
      new ModelCatalogueCommandRejectedError(
        "healthy_observation_error_forbidden",
      ),
    );
  });
});
