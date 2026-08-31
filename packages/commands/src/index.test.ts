import type { AuthenticatedOperator } from "@atharvan/domain";
import { describe, expect, it, vi } from "vitest";

import {
  createPlatformCommandService,
  PlatformCommandRejectedError,
  type PlatformCommandAuditStore,
} from "./index";

const now = new Date("2026-08-30T16:00:00.000Z");
const actor: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: now,
};

function createStore(): PlatformCommandAuditStore {
  return {
    beginCommand: vi.fn(async (input) => ({
      state: "started" as const,
      commandId: input.commandId,
    })),
    completeCommand: vi.fn(async () => ({ state: "completed" as const })),
    listAuditEvents: vi.fn(async () => ({ items: [], nextCursor: null })),
    exportAuditEvents: vi.fn(async () => ({ items: [], truncated: false })),
  };
}

describe("platform command service", () => {
  it("creates stable secret-safe envelope and idempotency fingerprints", async () => {
    const store = createStore();
    const service = createPlatformCommandService({
      store,
      environment: "development",
      now: () => now,
      randomId: () => "00000000-0000-4000-8000-000000000101",
    });

    await service.begin({
      actor,
      requiredCapability: "platform:configuration:write",
      name: "platform.configuration.set",
      version: 1,
      targetType: "platform_configuration",
      targetId: "platform.release.channel",
      safePayload: { value: "stable", scope: "environment" },
      idempotencyKey: "command-key-0001",
      correlationId: "00000000-0000-4000-8000-000000000201",
      reason: "Promote the configured release channel.",
    });
    const first = vi.mocked(store.beginCommand).mock.calls[0]?.[0];
    expect(first).toMatchObject({
      name: "platform.configuration.set",
      version: 1,
      payloadFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      idempotencyFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      breakGlassGrantIds: [],
    });
    expect(JSON.stringify(first)).not.toContain("command-key-0001");

    await service.begin({
      actor,
      requiredCapability: "platform:configuration:write",
      name: "platform.configuration.set",
      version: 1,
      targetType: "platform_configuration",
      targetId: "platform.release.channel",
      safePayload: { scope: "environment", value: "stable" },
      idempotencyKey: "command-key-0001",
      correlationId: "00000000-0000-4000-8000-000000000202",
      reason: "Promote the configured release channel.",
    });
    const second = vi.mocked(store.beginCommand).mock.calls[1]?.[0];
    expect(second?.payloadFingerprint).toBe(first?.payloadFingerprint);
    expect(second?.idempotencyFingerprint).toBe(first?.idempotencyFingerprint);
  });

  it("preserves temporary authority provenance in the immutable envelope", async () => {
    const store = createStore();
    const service = createPlatformCommandService({
      store,
      environment: "development",
      now: () => now,
    });
    const grantId = "00000000-0000-4000-8000-000000000301";

    await service.begin({
      actor: {
        ...actor,
        isSuperAdministrator: false,
        effectiveCapabilities: ["platform:models:write"],
        breakGlassGrantIds: [grantId],
      },
      requiredCapability: "platform:models:write",
      name: "platform.model.set",
      version: 1,
      targetType: "model",
      targetId: "openai/gpt",
      safePayload: { lifecycle: "active" },
      idempotencyKey: "temporary-model-change",
      correlationId: "00000000-0000-4000-8000-000000000302",
      reason: "Restore model availability during an incident.",
    });

    expect(store.beginCommand).toHaveBeenCalledWith(
      expect.objectContaining({ breakGlassGrantIds: [grantId] }),
    );
  });

  it("normalizes bounded audit searches and requires audit authority", async () => {
    const store = createStore();
    const service = createPlatformCommandService({
      store,
      environment: "development",
      now: () => now,
    });
    await service.listAuditEvents(actor, {
      eventType: "platform.command",
      outcome: "succeeded",
      limit: 25,
    });
    expect(store.listAuditEvents).toHaveBeenCalledWith({
      query: expect.objectContaining({
        eventType: "platform.command",
        outcome: "succeeded",
        limit: 25,
      }),
    });

    expect(() =>
      service.listAuditEvents(
        { ...actor, isSuperAdministrator: false, effectiveCapabilities: [] },
        {},
      ),
    ).toThrow("operator_command_forbidden");
  });

  it("requires recent step-up and a bounded range for exports", async () => {
    const store = createStore();
    const service = createPlatformCommandService({
      store,
      environment: "development",
      now: () => now,
    });
    await expect(
      service.exportAuditEvents(
        { ...actor, stepUpVerifiedAt: new Date(now.getTime() - 6 * 60_000) },
        {
          from: "2026-08-29T00:00:00.000Z",
          to: "2026-08-30T00:00:00.000Z",
        },
      ),
    ).rejects.toThrow("recent_step_up_required");
    await expect(service.exportAuditEvents(actor, {})).rejects.toEqual(
      expect.objectContaining<Partial<PlatformCommandRejectedError>>({
        reason: "audit_export_range_required",
      }),
    );
    await expect(
      service.exportAuditEvents(actor, {
        from: "2026-08-29T00:00:00.000Z",
        to: "2026-08-30T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ format: "ndjson", itemCount: 0 });
  });
});
