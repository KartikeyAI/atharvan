import { describe, expect, it, vi } from "vitest";

import type { PlatformFeatureFlagEntry } from "@atharvan/domain";

import { createPlatformFeatureFlagService } from "./index";

const now = new Date("2026-08-30T16:00:00.000Z");
const actor = {
  operatorId: "00000000-0000-4000-8000-000000000101",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:flags:write"],
  stepUpVerifiedAt: now,
};

const rule = {
  id: "beta_rollout",
  description: "Enable the beta cohort in supported regions.",
  enabled: true,
  planKeys: [],
  workspaceIds: [],
  userIds: [],
  regions: ["eu-west"],
  cohorts: ["beta"],
  internalStaff: null,
  minimumAccountAgeDays: null,
  maximumAccountAgeDays: null,
  rolloutBasisPoints: 10_000,
} as const;

function entry(
  overrides: Partial<PlatformFeatureFlagEntry["current"]> = {},
): PlatformFeatureFlagEntry {
  const current = {
    revisionNumber: 1,
    displayName: "New dashboard",
    purpose: "Stage the new Arth dashboard safely.",
    ownerOperatorId: actor.operatorId,
    ownerEmail: "owner@arth.example",
    lifecycle: "active" as const,
    defaultEnabled: false,
    emergencyDisabled: false,
    rules: [rule],
    reviewAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    reason: "Start the reviewed beta rollout.",
    correlationId: "00000000-0000-4000-8000-000000000102",
    createdByOperatorId: actor.operatorId,
    createdAt: now.toISOString(),
    ...overrides,
  };
  return {
    id: "00000000-0000-4000-8000-000000000201",
    key: "dashboard.new_navigation",
    environment: "development",
    freshness: "current",
    current,
    recentRevisions: [current],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function createStore(flag: PlatformFeatureFlagEntry | null = entry()) {
  return {
    listFlags: vi.fn(async () => ({
      environment: "development" as const,
      items: flag === null ? [] : [flag],
    })),
    findFlag: vi.fn(async () => flag),
    setFlag: vi.fn(async (input: { flagId: string }) => ({
      outcome: "created" as const,
      id: input.flagId,
      revisionNumber: 1,
    })),
  };
}

function validCommand() {
  return {
    actor,
    key: "dashboard.new_navigation",
    displayName: "New dashboard",
    purpose: "Stage the new Arth dashboard safely.",
    ownerOperatorId: actor.operatorId,
    lifecycle: "active" as const,
    defaultEnabled: false,
    emergencyDisabled: false,
    rules: [rule],
    reviewAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    reason: "Start the reviewed beta rollout.",
  };
}

describe("platform feature flags", () => {
  it("normalizes and persists an owned, reviewable revision", async () => {
    const store = createStore();
    const service = createPlatformFeatureFlagService({
      store,
      environment: "development",
      now: () => now,
      randomId: () => "00000000-0000-4000-8000-000000000901",
    });
    await expect(service.setFlag(validCommand())).resolves.toMatchObject({
      outcome: "created",
      revisionNumber: 1,
    });
    expect(store.setFlag).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "dashboard.new_navigation",
        ownerOperatorId: actor.operatorId,
        rules: [expect.objectContaining({ id: "beta_rollout" })],
      }),
    );
  });

  it("evaluates ordered targeting and returns its evidence", async () => {
    const service = createPlatformFeatureFlagService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.evaluate("dashboard.new_navigation", {
        stableRoutingKey: "workspace-42",
        region: "EU-WEST",
        cohorts: ["BETA"],
      }),
    ).resolves.toMatchObject({
      enabled: true,
      reason: "targeting_rule",
      matchedRuleId: "beta_rollout",
      rolloutBucket: expect.any(Number),
    });
  });

  it("uses the same percentage bucket for the same routing identity", async () => {
    const percentageRule = {
      ...rule,
      regions: [],
      cohorts: [],
      rolloutBasisPoints: 5_000,
    };
    const service = createPlatformFeatureFlagService({
      store: createStore(entry({ rules: [percentageRule] })),
      environment: "development",
      now: () => now,
    });
    const first = await service.evaluate("dashboard.new_navigation", {
      stableRoutingKey: "workspace-stable",
    });
    const second = await service.evaluate("dashboard.new_navigation", {
      stableRoutingKey: "workspace-stable",
    });
    expect(second).toMatchObject({
      enabled: first.enabled,
      matchedRuleId: first.matchedRuleId,
      rolloutBucket: first.rolloutBucket,
    });
  });

  it("fails closed before targeting when the kill switch is active", async () => {
    const service = createPlatformFeatureFlagService({
      store: createStore(entry({ emergencyDisabled: true })),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.evaluate("dashboard.new_navigation", {
        stableRoutingKey: "workspace-42",
        region: "eu-west",
        cohorts: ["beta"],
      }),
    ).resolves.toMatchObject({
      enabled: false,
      reason: "emergency_disabled",
      matchedRuleId: null,
    });
  });

  it("fails closed for expired or inactive flags", async () => {
    const expiredService = createPlatformFeatureFlagService({
      store: createStore(
        entry({
          reviewAt: "2026-08-28T00:00:00.000Z",
          expiresAt: "2026-08-29T00:00:00.000Z",
        }),
      ),
      environment: "development",
      now: () => now,
    });
    await expect(
      expiredService.evaluate("dashboard.new_navigation", {
        stableRoutingKey: "workspace-42",
      }),
    ).resolves.toMatchObject({ enabled: false, reason: "flag_expired" });

    const draftService = createPlatformFeatureFlagService({
      store: createStore(entry({ lifecycle: "draft" })),
      environment: "development",
      now: () => now,
    });
    await expect(
      draftService.evaluate("dashboard.new_navigation", {
        stableRoutingKey: "workspace-42",
      }),
    ).resolves.toMatchObject({ enabled: false, reason: "flag_not_active" });
  });

  it("requires future review, ordered expiry, valid rule ranges, and recent step-up", async () => {
    const service = createPlatformFeatureFlagService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setFlag({ ...validCommand(), reviewAt: now.toISOString() }),
    ).rejects.toMatchObject({ reason: "flag_review_must_be_future" });
    await expect(
      service.setFlag({
        ...validCommand(),
        expiresAt: "2026-09-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ reason: "flag_expiry_must_follow_review" });
    await expect(
      service.setFlag({
        ...validCommand(),
        rules: [
          {
            ...rule,
            minimumAccountAgeDays: 90,
            maximumAccountAgeDays: 30,
          },
        ],
      }),
    ).rejects.toMatchObject({ reason: "flag_account_age_range_invalid" });
    await expect(
      service.setFlag({
        ...validCommand(),
        actor: {
          ...actor,
          stepUpVerifiedAt: new Date(now.getTime() - 10 * 60_000),
        },
      }),
    ).rejects.toThrow("recent_step_up_required");
  });
});
