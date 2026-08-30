import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  createCustomerDirectoryService,
  type CustomerDirectoryStore,
} from "./index";

const now = new Date("2026-08-30T18:00:00.000Z");
const actor: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:users:read", "platform:workspaces:read"],
};

function createStore(): CustomerDirectoryStore {
  const store: CustomerDirectoryStore = {
    getStatus: vi.fn(async () => ({
      environment: "development" as const,
      source: "arth" as const,
      freshness: "unknown" as const,
      sourceRevision: null,
      observedAt: null,
      synchronizedAt: null,
    })),
    searchAndAudit: vi.fn(async (input) => ({
      status: {
        environment: input.environment,
        source: "arth" as const,
        freshness: "current" as const,
        sourceRevision: "7",
        observedAt: now.toISOString(),
        synchronizedAt: now.toISOString(),
      },
      queryFingerprint: input.queryFingerprint,
      users: [],
      workspaces: [],
    })),
    inspectAndAudit: vi.fn(async () => null),
    reconcileSnapshot: vi.fn(async (input) => ({
      outcome: "updated" as const,
      sourceRevision: input.sourceRevision,
      users: input.users.length,
      workspaces: input.workspaces.length,
      memberships: input.memberships.length,
    })),
    listRestrictions: vi.fn(async (input) => ({
      environment: input.environment,
      targetType: input.targetType,
      targetId: input.targetId,
      items: [],
    })),
    setRestriction: vi.fn(async (input) => ({
      outcome: "updated" as const,
      restrictionId: "00000000-0000-4000-8000-000000000701",
      revisionNumber: 1,
      desiredState: input.desiredState,
    })),
    recordRestrictionObservation: vi.fn(async (input) => ({
      outcome: "created" as const,
      restrictionId: input.restrictionId,
    })),
    createInternalNote: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000702",
    })),
    setRiskMarker: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000703",
      revisionNumber: 1,
    })),
    requestOwnershipTransfer: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000704",
      revisionNumber: 1,
    })),
    recordOwnershipTransferObservation: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.transferId,
    })),
  };
  return store;
}

describe("customer directory service", () => {
  it("fingerprints search terms and preserves only the access reason", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
      randomId: () => "00000000-0000-4000-8000-000000000010",
    });

    const result = await service.search({
      actor,
      query: " Person@Example.com ",
      scope: "all",
      reason: "Investigate an account access request.",
    });

    expect(result.queryFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(store.searchAndAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "person@example.com",
        queryFingerprint: result.queryFingerprint,
        reason: "Investigate an account access request.",
      }),
    );
  });

  it("requires the exact read capability for each search scope", async () => {
    const service = createCustomerDirectoryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.search({
        actor: { ...actor, effectiveCapabilities: ["platform:users:read"] },
        query: "example",
        scope: "all",
        reason: "Investigate a customer account issue.",
      }),
    ).rejects.toThrow("operator_command_forbidden");
  });

  it("normalizes a bounded snapshot for a stepped-up Super Administrator", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
    });
    const result = await service.reconcileSnapshot({
      actor: {
        ...actor,
        isSuperAdministrator: true,
        effectiveCapabilities: ["platform:*"],
        stepUpVerifiedAt: now,
      },
      sourceRevision: "42",
      observedAt: now.toISOString(),
      users: [
        {
          id: "usr_1",
          email: "OWNER@EXAMPLE.COM",
          displayName: "Owner",
          lifecycle: "active",
          verificationStatus: "verified",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      workspaces: [
        {
          id: "wrk_1",
          organizationId: "org_1",
          name: "Example",
          slug: "Example-Workspace",
          lifecycle: "active",
          ownerUserId: "usr_1",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      memberships: [
        {
          id: "mem_1",
          userId: "usr_1",
          workspaceId: "wrk_1",
          role: "Owner",
          lifecycle: "active",
          grantedPermissions: ["workspace:read"],
          deniedPermissions: [],
          effectivePermissions: ["workspace:read"],
        },
      ],
      reason: "Reconcile the canonical Arth customer directory.",
    });

    expect(result).toMatchObject({ outcome: "updated", sourceRevision: "42" });
    expect(store.reconcileSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        users: [expect.objectContaining({ email: "owner@example.com" })],
        workspaces: [expect.objectContaining({ slug: "example-workspace" })],
        memberships: [expect.objectContaining({ role: "owner" })],
      }),
    );
  });

  it("rejects duplicate source identities before touching PostgreSQL", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
    });
    await expect(
      service.reconcileSnapshot({
        actor: {
          ...actor,
          isSuperAdministrator: true,
          effectiveCapabilities: ["platform:*"],
          stepUpVerifiedAt: now,
        },
        sourceRevision: "42",
        observedAt: now.toISOString(),
        users: [
          {
            id: "usr_1",
            email: "one@example.com",
            displayName: "One",
            lifecycle: "active",
            verificationStatus: "verified",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "usr_1",
            email: "two@example.com",
            displayName: "Two",
            lifecycle: "active",
            verificationStatus: "verified",
            createdAt: "2026-08-02T00:00:00.000Z",
          },
        ],
        workspaces: [],
        memberships: [],
        reason: "Reconcile the canonical Arth customer directory.",
      }),
    ).rejects.toThrow("customer_directory_rejected");
    expect(store.reconcileSnapshot).not.toHaveBeenCalled();
  });

  it("requires step-up and exact target confirmation for a restriction", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
    });
    const restrictionActor = {
      ...actor,
      effectiveCapabilities: ["platform:users:restrict"],
      stepUpVerifiedAt: now,
    };

    await expect(
      service.setRestriction({
        actor: restrictionActor,
        targetType: "user",
        targetId: "usr_1",
        capability: "login",
        desiredState: "restricted",
        confirmation: "RESTRICT usr_1",
        reason: "Contain the confirmed account compromise.",
      }),
    ).resolves.toMatchObject({
      outcome: "updated",
      desiredState: "restricted",
    });
    expect(store.setRestriction).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "user",
        targetId: "usr_1",
        capability: "login",
      }),
    );

    await expect(
      service.setRestriction({
        actor: restrictionActor,
        targetType: "user",
        targetId: "usr_1",
        capability: "login",
        desiredState: "restored",
        confirmation: "RESTORE someone_else",
        reason: "Restore access after the investigation is complete.",
      }),
    ).rejects.toMatchObject({ reason: "restriction_confirmation_invalid" });
  });

  it("rejects login restrictions for a workspace", async () => {
    const service = createCustomerDirectoryService({
      store: createStore(),
      environment: "development",
      now: () => now,
    });
    await expect(
      service.setRestriction({
        actor: {
          ...actor,
          effectiveCapabilities: ["platform:workspaces:restrict"],
          stepUpVerifiedAt: now,
        },
        targetType: "workspace",
        targetId: "wrk_1",
        capability: "login",
        desiredState: "restricted",
        confirmation: "RESTRICT wrk_1",
        reason: "Contain the workspace while the incident is investigated.",
      }),
    ).rejects.toMatchObject({ reason: "workspace_login_restriction_invalid" });
  });

  it("rejects secret-like internal notes before storage", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
    });

    await expect(
      service.createInternalNote({
        actor: {
          ...actor,
          effectiveCapabilities: ["platform:users:notes:write"],
        },
        targetType: "user",
        targetId: "usr_1",
        category: "support",
        body: "api_key = should-never-be-stored",
        reason: "Document the support investigation context.",
      }),
    ).rejects.toMatchObject({
      reason: "customer_private_or_secret_content_rejected",
    });
    expect(store.createInternalNote).not.toHaveBeenCalled();
  });

  it("requires recent step-up for immutable risk markers", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
    });
    const riskActor = {
      ...actor,
      effectiveCapabilities: ["platform:users:risk:write"],
    };

    await expect(
      service.setRiskMarker({
        actor: riskActor,
        targetType: "user",
        targetId: "usr_1",
        category: "security",
        severity: "high",
        state: "active",
        summary: "Confirmed account takeover signal.",
        reason: "Escalate the confirmed authentication anomaly.",
      }),
    ).rejects.toThrow("recent_step_up_required");
    expect(store.setRiskMarker).not.toHaveBeenCalled();
  });

  it("requires approval evidence and exact confirmation for ownership transfer", async () => {
    const store = createStore();
    const service = createCustomerDirectoryService({
      store,
      environment: "development",
      now: () => now,
    });
    const transferActor = {
      ...actor,
      effectiveCapabilities: ["platform:workspaces:transfer"],
      stepUpVerifiedAt: now,
    };

    await expect(
      service.requestOwnershipTransfer({
        actor: transferActor,
        workspaceId: "wrk_1",
        successorUserId: "usr_2",
        approvalReference: "APR-42",
        confirmation: "TRANSFER wrk_1 TO usr_2",
        reason: "Recover ownership after verified owner departure.",
      }),
    ).resolves.toMatchObject({ outcome: "created", revisionNumber: 1 });
    expect(store.requestOwnershipTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "wrk_1",
        successorUserId: "usr_2",
        approvalReference: "APR-42",
      }),
    );

    await expect(
      service.requestOwnershipTransfer({
        actor: transferActor,
        workspaceId: "wrk_1",
        successorUserId: "usr_2",
        approvalReference: "APR-43",
        confirmation: "TRANSFER wrk_1 TO someone_else",
        reason: "Recover ownership after verified owner departure.",
      }),
    ).rejects.toMatchObject({
      reason: "ownership_transfer_confirmation_invalid",
    });
  });
});
