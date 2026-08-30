import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  createOperatorRoleAdministrationService,
  type OperatorRoleAdministrationStore,
} from "./operator-roles";

const superAdministrator: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: new Date("2026-08-30T00:00:00.000Z"),
};

function createStore(): OperatorRoleAdministrationStore {
  return {
    replaceOperatorRoles: vi.fn(async (input) => ({
      outcome: "updated" as const,
      operatorId: input.targetOperatorId,
    })),
  };
}

describe("operator role administration", () => {
  it("normalizes and de-duplicates role keys before the transaction", async () => {
    const store = createStore();
    const service = createOperatorRoleAdministrationService({
      store,
      now: () => new Date("2026-08-30T00:02:00.000Z"),
    });

    await service.replaceOperatorRoles({
      actor: superAdministrator,
      targetOperatorId: "00000000-0000-4000-8000-000000000201",
      roleKeys: [" Auditor ", "auditor", "platform_viewer"],
      reason: "Approved responsibility change.",
      correlationId: "00000000-0000-4000-8000-000000000301",
    });

    expect(store.replaceOperatorRoles).toHaveBeenCalledWith(
      expect.objectContaining({ roleKeys: ["auditor", "platform_viewer"] }),
    );
  });

  it("requires a recently verified Super Administrator session", async () => {
    const store = createStore();
    const service = createOperatorRoleAdministrationService({
      store,
      now: () => new Date("2026-08-30T00:10:00.000Z"),
    });

    await expect(
      service.replaceOperatorRoles({
        actor: superAdministrator,
        targetOperatorId: "00000000-0000-4000-8000-000000000201",
        roleKeys: ["auditor"],
        reason: "Approved responsibility change.",
      }),
    ).rejects.toThrow("recent_step_up_required");
    expect(store.replaceOperatorRoles).not.toHaveBeenCalled();
  });

  it("rejects an empty role set before storage", async () => {
    const store = createStore();
    const service = createOperatorRoleAdministrationService({
      store,
      now: () => new Date("2026-08-30T00:02:00.000Z"),
    });

    await expect(
      service.replaceOperatorRoles({
        actor: superAdministrator,
        targetOperatorId: "00000000-0000-4000-8000-000000000201",
        roleKeys: [],
        reason: "Approved responsibility change.",
      }),
    ).rejects.toThrow("at_least_one_role_required");
  });
});
