import { describe, expect, it, vi } from "vitest";

import type {
  AuthenticatedOperator,
  ModelRoutingResolutionCandidate,
  ModelRoutingResolutionSnapshot,
} from "@atharvan/domain";

import {
  createModelRoutingService,
  ModelRoutingCommandRejectedError,
  type ModelRoutingStore,
} from "./routing";

const now = new Date("2026-08-30T14:00:00.000Z");
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

function candidate(
  overrides: Partial<ModelRoutingResolutionCandidate> = {},
): ModelRoutingResolutionCandidate {
  return {
    targetId: "00000000-0000-4000-8000-000000000501",
    modelId: "00000000-0000-4000-8000-000000000401",
    modelKey: "primary-model",
    modelDisplayName: "Primary Model",
    providerId: "00000000-0000-4000-8000-000000000301",
    providerKey: "primary-provider",
    providerDisplayName: "Primary Provider",
    priority: 1,
    rolloutBasisPoints: 10_000,
    allowDegraded: false,
    modelCapabilities: ["code_generation", "reasoning", "tool_use"],
    modelRegions: ["global"],
    modelMaximumDataClassification: "confidential",
    modelLifecycle: "active",
    providerRegions: ["global"],
    providerMaximumDataClassification: "confidential",
    providerLifecycle: "active",
    providerAdapterKind: "openai",
    providerCredentialActive: true,
    providerHealthState: "healthy",
    providerControlState: "enabled",
    modelControlState: "enabled",
    ...overrides,
  };
}

function snapshot(
  candidates: ReadonlyArray<ModelRoutingResolutionCandidate> = [candidate()],
): ModelRoutingResolutionSnapshot {
  return {
    policyId: "00000000-0000-4000-8000-000000000201",
    policyKey: "code_generation",
    policyRevisionId: "00000000-0000-4000-8000-000000000202",
    policyRevisionNumber: 2,
    requiredCapabilities: ["code_generation"],
    maximumDataClassification: "confidential",
    allowedRegions: ["global"],
    candidates,
  };
}

function createStore(
  resolution: ModelRoutingResolutionSnapshot | null = snapshot(),
): ModelRoutingStore {
  return {
    listOperations: vi.fn(async ({ environment }) => ({
      environment,
      policies: [],
      controls: [],
    })),
    setPolicy: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.policyId,
      revisionNumber: 1,
    })),
    setControl: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.controlId,
      revisionNumber: 1,
    })),
    getResolutionSnapshot: vi.fn(async () => resolution),
  };
}

function createService(store = createStore()) {
  let sequence = 600;
  return {
    store,
    service: createModelRoutingService({
      store,
      environment: "development",
      now: () => now,
      randomId: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    }),
  };
}

describe("model routing policy administration", () => {
  it("normalizes policy metadata and makes array order the fallback priority", async () => {
    const { service, store } = createService();
    await service.setPolicy({
      actor,
      key: " Code_Generation ",
      displayName: " Code generation ",
      requiredCapabilities: ["tool_use", "reasoning", "tool_use"],
      maximumDataClassification: "confidential",
      allowedRegions: ["Global", "global"],
      targets: [
        {
          modelId: "00000000-0000-4000-8000-000000000401",
          rolloutBasisPoints: 1_000,
        },
        {
          modelId: "00000000-0000-4000-8000-000000000402",
          rolloutBasisPoints: 10_000,
          allowDegraded: true,
        },
      ],
      reason: "Introduce a controlled coding-model rollout.",
    });

    expect(store.setPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "code_generation",
        displayName: "Code generation",
        requiredCapabilities: ["reasoning", "tool_use"],
        allowedRegions: ["global"],
        targets: [
          expect.objectContaining({ priority: 1, rolloutBasisPoints: 1_000 }),
          expect.objectContaining({
            priority: 2,
            rolloutBasisPoints: 10_000,
            allowDegraded: true,
          }),
        ],
      }),
    );
  });

  it("requires recent step-up proof for policy and control mutations", async () => {
    const { service } = createService();
    await expect(
      service.setControl({
        actor: actorWithoutStepUp,
        targetKind: "provider",
        targetId: "00000000-0000-4000-8000-000000000301",
        state: "disabled",
        reason: "Emergency provider containment switch.",
      }),
    ).rejects.toThrow("recent_step_up_required");
  });

  it("bounds maintenance windows and forbids expiry on kill switches", async () => {
    const { service } = createService();
    await expect(
      service.setControl({
        actor,
        targetKind: "provider",
        targetId: "00000000-0000-4000-8000-000000000301",
        state: "maintenance",
        reason: "Provider maintenance requires an explicit window.",
      }),
    ).rejects.toEqual(
      new ModelRoutingCommandRejectedError("maintenance_expiry_required"),
    );
    await expect(
      service.setControl({
        actor,
        targetKind: "provider",
        targetId: "00000000-0000-4000-8000-000000000301",
        state: "disabled",
        maintenanceExpiresAt: "2026-08-30T15:00:00.000Z",
        reason: "Kill switches remain explicit until re-enabled.",
      }),
    ).rejects.toEqual(
      new ModelRoutingCommandRejectedError("maintenance_expiry_forbidden"),
    );
  });
});

describe("model routing resolution", () => {
  it("skips a disabled primary and selects the ordered healthy fallback", async () => {
    const primary = candidate({
      providerControlState: "disabled",
    });
    const fallback = candidate({
      targetId: "00000000-0000-4000-8000-000000000502",
      modelId: "00000000-0000-4000-8000-000000000402",
      modelKey: "fallback-model",
      priority: 2,
    });
    const { service } = createService(
      createStore(snapshot([primary, fallback])),
    );
    await expect(
      service.previewRoute({
        policyKey: "code_generation",
        stableRoutingKey: "request-123",
        requiredCapabilities: ["reasoning"],
        dataClassification: "confidential",
        region: "global",
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      modelId: fallback.modelId,
      evaluations: [
        { accepted: false, reason: "provider_disabled" },
        { accepted: true, reason: null },
      ],
    });
  });

  it("fails closed for missing controls, stale health, and credentials", async () => {
    const { service } = createService(
      createStore(
        snapshot([
          candidate({ providerControlState: "unconfigured" }),
          candidate({
            targetId: "00000000-0000-4000-8000-000000000502",
            modelId: "00000000-0000-4000-8000-000000000402",
            priority: 2,
            providerHealthState: "stale",
          }),
          candidate({
            targetId: "00000000-0000-4000-8000-000000000503",
            modelId: "00000000-0000-4000-8000-000000000403",
            priority: 3,
            providerCredentialActive: false,
          }),
        ]),
      ),
    );
    await expect(
      service.previewRoute({
        policyKey: "code_generation",
        stableRoutingKey: "request-456",
        dataClassification: "internal",
        region: "global",
      }),
    ).resolves.toMatchObject({
      outcome: "unavailable",
      reason: "no_eligible_target",
      evaluations: [
        { reason: "provider_control_unconfigured" },
        { reason: "provider_health_unacceptable" },
        { reason: "provider_credential_unavailable" },
      ],
    });
  });

  it("allows degraded health only when the target explicitly opts in", async () => {
    const degraded = candidate({
      providerHealthState: "degraded",
      allowDegraded: true,
    });
    const { service } = createService(createStore(snapshot([degraded])));
    await expect(
      service.previewRoute({
        policyKey: "code_generation",
        stableRoutingKey: "request-789",
        dataClassification: "internal",
        region: "global",
      }),
    ).resolves.toMatchObject({
      outcome: "selected",
      modelId: degraded.modelId,
    });
  });

  it("rejects requests outside the policy classification or region envelope", async () => {
    const restricted = snapshot();
    const { service } = createService(createStore(restricted));
    await expect(
      service.previewRoute({
        policyKey: "code_generation",
        stableRoutingKey: "request-policy-denied",
        dataClassification: "restricted",
        region: "eu-west-1",
      }),
    ).resolves.toMatchObject({
      outcome: "unavailable",
      reason: "request_policy_incompatible",
      evaluations: [],
    });
  });
});
