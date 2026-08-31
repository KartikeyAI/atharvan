import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  createOperatorBreakGlassAdministrationService,
  type OperatorBreakGlassAdministrationStore,
} from "./operator-break-glass";

const now = new Date("2026-08-30T12:00:00.000Z");
const superAdministrator: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: now,
};
const reviewer: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000002",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:operators:break-glass:review"],
  stepUpVerifiedAt: now,
};
const targetOperatorId = "00000000-0000-4000-8000-000000000003";

function createStore(): OperatorBreakGlassAdministrationStore {
  return {
    createGrant: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.id,
    })),
    revokeGrant: vi.fn(async (input) => ({
      outcome: "updated" as const,
      id: input.grantId,
    })),
    reviewGrant: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.id,
    })),
  };
}

describe("operator break-glass administration", () => {
  it("normalizes exact capabilities and creates a bounded expiring grant", async () => {
    const store = createStore();
    const service = createOperatorBreakGlassAdministrationService({
      store,
      now: () => now,
    });

    await service.createGrant({
      actor: superAdministrator,
      targetOperatorId,
      capabilities: [
        " platform:models:write ",
        "platform:models:write",
        "platform:secrets:write",
      ],
      durationMinutes: 15,
      reason: "Restore model routing during the incident.",
      incidentReference: "INC-2026-0042",
      approvalReference: "approval/security/811",
      confirmation: `GRANT BREAK-GLASS TO ${targetOperatorId}`,
      correlationId: "00000000-0000-4000-8000-000000000004",
    });

    expect(store.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: ["platform:models:write", "platform:secrets:write"],
        expiresAt: new Date("2026-08-30T12:15:00.000Z"),
      }),
    );
  });

  it("rejects wildcard delegation and grants longer than one hour", async () => {
    const store = createStore();
    const service = createOperatorBreakGlassAdministrationService({
      store,
      now: () => now,
    });
    const base = {
      actor: superAdministrator,
      targetOperatorId,
      reason: "Restore a blocked production operation.",
      incidentReference: "INC-2026-0042",
      approvalReference: "approval/security/811",
      confirmation: `GRANT BREAK-GLASS TO ${targetOperatorId}`,
    };

    await expect(
      service.createGrant({
        ...base,
        capabilities: ["platform:*"],
        durationMinutes: 15,
      }),
    ).rejects.toThrow("invalid_operator_capabilities");
    await expect(
      service.createGrant({
        ...base,
        capabilities: ["platform:models:write"],
        durationMinutes: 61,
      }),
    ).rejects.toThrow("break_glass_duration_out_of_range");
    expect(store.createGrant).not.toHaveBeenCalled();
  });

  it("requires a fresh Super Administrator session and exact confirmation", async () => {
    const store = createStore();
    const service = createOperatorBreakGlassAdministrationService({
      store,
      now: () => new Date("2026-08-30T12:06:00.000Z"),
    });

    await expect(
      service.createGrant({
        actor: superAdministrator,
        targetOperatorId,
        capabilities: ["platform:models:write"],
        durationMinutes: 15,
        reason: "Restore a blocked production operation.",
        incidentReference: "INC-2026-0042",
        approvalReference: "approval/security/811",
        confirmation: `GRANT BREAK-GLASS TO ${targetOperatorId}`,
      }),
    ).rejects.toThrow("recent_step_up_required");

    const freshService = createOperatorBreakGlassAdministrationService({
      store,
      now: () => now,
    });
    await expect(
      freshService.createGrant({
        actor: superAdministrator,
        targetOperatorId,
        capabilities: ["platform:models:write"],
        durationMinutes: 15,
        reason: "Restore a blocked production operation.",
        incidentReference: "INC-2026-0042",
        approvalReference: "approval/security/811",
        confirmation: "GRANT BREAK-GLASS",
      }),
    ).rejects.toThrow("break_glass_confirmation_mismatch");
  });

  it("allows a dedicated reviewer capability to record a terminal review", async () => {
    const store = createStore();
    const service = createOperatorBreakGlassAdministrationService({
      store,
      now: () => now,
    });

    await service.reviewGrant({
      actor: reviewer,
      grantId: "00000000-0000-4000-8000-000000000005",
      outcome: "concerns",
      summary: "The granted scope was broader than the incident required.",
      correlationId: "00000000-0000-4000-8000-000000000006",
    });

    expect(store.reviewGrant).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "concerns" }),
    );
  });
});
