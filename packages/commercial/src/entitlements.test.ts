import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  createEntitlementService,
  EntitlementCommandRejectedError,
  type EntitlementStore,
} from "./index";

const now = new Date("2026-09-07T08:00:00.000Z");
const actor: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:plans:read", "platform:plans:write"],
  stepUpVerifiedAt: now,
};
const actorWithoutStepUp: AuthenticatedOperator = {
  operatorId: actor.operatorId,
  isSuperAdministrator: actor.isSuperAdministrator,
  effectiveCapabilities: actor.effectiveCapabilities,
};

function createStore(): EntitlementStore {
  return {
    getPlanEntitlementSet: vi.fn(async () => null),
    getWorkspaceEntitlements: vi.fn(async () => null),
    sealPlanEntitlementSet: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.setId,
      revisionNumber: 1,
    })),
    assignWorkspacePlan: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.assignmentId,
      revisionNumber: 1,
    })),
    setEnterpriseGrant: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.grantId,
      revisionNumber: 1,
      snapshotRevisionNumber: 2,
    })),
  };
}

function createService() {
  const store = createStore();
  let sequence = 0;
  return {
    store,
    service: createEntitlementService({
      store,
      environment: "development",
      now: () => now,
      randomId: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    }),
  };
}

describe("workspace entitlement authority", () => {
  it("normalizes, validates, and sorts a sealed plan template", async () => {
    const { service, store } = createService();
    await service.sealPlanEntitlementSet(actor, {
      planVersionId: "00000000-0000-4000-8000-000000000100",
      values: [
        {
          key: " RUNNER.MINUTES ",
          valueType: "quantity",
          enabled: null,
          limit: 10_000,
          unit: " MINUTES ",
          overagePolicy: "metered",
        },
        {
          key: "AI.ENABLED",
          valueType: "boolean",
          enabled: true,
          limit: null,
          unit: null,
          overagePolicy: "denied",
        },
      ],
      reason: "Seal the reviewed professional plan allowances.",
    });

    expect(store.sealPlanEntitlementSet).toHaveBeenCalledWith(
      expect.objectContaining({
        values: [
          expect.objectContaining({ key: "ai.enabled", enabled: true }),
          expect.objectContaining({
            key: "runner.minutes",
            unit: "minutes",
            limit: 10_000,
          }),
        ],
      }),
    );
  });

  it("rejects duplicate normalized entitlement keys before persistence", async () => {
    const { service, store } = createService();
    await expect(
      service.sealPlanEntitlementSet(actor, {
        planVersionId: "00000000-0000-4000-8000-000000000100",
        values: [
          {
            key: "ai.enabled",
            valueType: "boolean",
            enabled: true,
            limit: null,
            unit: null,
            overagePolicy: "denied",
          },
          {
            key: " AI.ENABLED ",
            valueType: "boolean",
            enabled: false,
            limit: null,
            unit: null,
            overagePolicy: "denied",
          },
        ],
        reason: "Reject an ambiguous entitlement template.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<EntitlementCommandRejectedError>>({
        reason: "entitlement_keys_duplicate",
      }),
    );
    expect(store.sealPlanEntitlementSet).not.toHaveBeenCalled();
  });

  it("rejects expired and excessively distant active grants", async () => {
    const { service, store } = createService();
    await expect(
      service.setEnterpriseGrant(actor, {
        workspaceId: "workspace-1",
        key: "runner.minutes",
        valueType: "quantity",
        enabled: null,
        limit: 20_000,
        unit: "minutes",
        overagePolicy: "contract",
        lifecycle: "active",
        contractReference: "MSA-2026-104",
        startsAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-02T00:00:00.000Z",
        reason: "Apply the contracted runner allowance.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<EntitlementCommandRejectedError>>({
        reason: "grant_term_inactive",
      }),
    );
    expect(store.setEnterpriseGrant).not.toHaveBeenCalled();
  });

  it("requires recent passkey assurance for assignment", async () => {
    const { service, store } = createService();
    await expect(
      service.assignWorkspacePlan(actorWithoutStepUp, {
        workspaceId: "workspace-1",
        planVersionId: "00000000-0000-4000-8000-000000000100",
        reason: "Assign the reviewed professional plan.",
      }),
    ).rejects.toThrow("recent_step_up_required");
    expect(store.assignWorkspacePlan).not.toHaveBeenCalled();
  });
});
