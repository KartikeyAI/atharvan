import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";
import { PlatformSecretProviderError } from "@atharvan/secrets";

import {
  createApp,
  type AuthenticationRuntime,
  type RuntimeBindings,
} from "../src/index";

const bindings: RuntimeBindings = {
  ATHARVAN_ENVIRONMENT: "development",
  ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.invalid",
};

function createRuntime(input?: {
  readonly userId?: string | null;
  readonly operator?: AuthenticatedOperator | null;
  readonly emailDeliveryConfigured?: boolean;
}): AuthenticationRuntime {
  return {
    emailDeliveryConfigured: input?.emailDeliveryConfigured ?? true,
    secretProviderConfigured: true,
    handle: vi.fn(async () => new Response("auth-handler", { status: 202 })),
    getSession: vi.fn(async () =>
      input?.userId === null
        ? null
        : {
            userId: input?.userId ?? "auth-user-1",
            createdAt: new Date(),
          },
    ),
    resolveActiveOperator: vi.fn(async () =>
      input?.operator === undefined
        ? {
            operatorId: "operator-1",
            isSuperAdministrator: true,
            effectiveCapabilities: ["platform:*"],
          }
        : input.operator,
    ),
    listOperators: vi.fn(async () => []),
    listMembershipDomains: vi.fn(async () => []),
    listOperatorRoleDefinitions: vi.fn(async () => []),
    listPlatformConfiguration: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    listPlatformSecretReferences: vi.fn(async () => []),
    listModelCatalogue: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    listModelRoutingOperations: vi.fn(async () => ({
      environment: "development" as const,
      policies: [],
      controls: [],
    })),
    listPlatformIntegrations: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    listPlatformAdapters: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    listPlatformFeatureFlags: vi.fn(async () => ({
      environment: "development" as const,
      items: [],
    })),
    getCustomerDirectoryStatus: vi.fn(async () => ({
      environment: "development" as const,
      source: "arth" as const,
      freshness: "unknown" as const,
      sourceRevision: null,
      observedAt: null,
      synchronizedAt: null,
    })),
    searchCustomerDirectory: vi.fn(async () => ({
      status: {
        environment: "development" as const,
        source: "arth" as const,
        freshness: "unknown" as const,
        sourceRevision: null,
        observedAt: null,
        synchronizedAt: null,
      },
      queryFingerprint:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      users: [],
      workspaces: [],
    })),
    inspectCustomerDirectory: vi.fn(async () => null),
    reconcileCustomerDirectorySnapshot: vi.fn(async (actor, input) => ({
      outcome: "updated" as const,
      sourceRevision: input.sourceRevision,
      users: input.users.length,
      workspaces: input.workspaces.length,
      memberships: input.memberships.length,
    })),
    listCustomerRestrictions: vi.fn(async (actor, input) => ({
      environment: "development" as const,
      targetType: input.targetType,
      targetId: input.targetId,
      items: [],
    })),
    setCustomerRestriction: vi.fn(async (actor, input) => ({
      outcome: "updated" as const,
      restrictionId: "00000000-0000-4000-8000-000000000701",
      revisionNumber: 1,
      desiredState: input.desiredState,
    })),
    recordCustomerRestrictionObservation: vi.fn(async (actor, input) => ({
      outcome: "created" as const,
      restrictionId: input.restrictionId,
    })),
    createCustomerInternalNote: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000702",
    })),
    setCustomerRiskMarker: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000703",
      revisionNumber: 1,
    })),
    requestCustomerOwnershipTransfer: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000704",
      revisionNumber: 1,
    })),
    recordCustomerOwnershipTransferObservation: vi.fn(async (actor, input) => ({
      outcome: "created" as const,
      id: input.transferId,
    })),
    beginPlatformCommand: vi.fn(async () => ({
      state: "started" as const,
      commandId: "00000000-0000-4000-8000-000000000990",
    })),
    completePlatformCommand: vi.fn(async () => ({
      state: "completed" as const,
    })),
    listPlatformAuditEvents: vi.fn(async () => ({
      items: [],
      nextCursor: null,
    })),
    exportPlatformAuditEvents: vi.fn(async () => ({
      generatedAt: "2026-08-30T16:00:00.000Z",
      format: "ndjson" as const,
      itemCount: 0,
      truncated: false,
      content: "",
    })),
    createOperatorInvitation: vi.fn(async () => ({
      outcome: "created" as const,
      id: "invitation-1",
    })),
    addMembershipDomain: vi.fn(async () => ({
      outcome: "created" as const,
      id: "domain-1",
    })),
    disableMembershipDomain: vi.fn(async () => ({
      outcome: "created" as const,
      id: "domain-1",
    })),
    replaceOperatorRoles: vi.fn(async () => ({
      outcome: "updated" as const,
      operatorId: "operator-2",
    })),
    setPlatformConfiguration: vi.fn(async () => ({
      outcome: "updated" as const,
      key: "platform.release.channel",
      revisionNumber: 1,
    })),
    createPlatformSecret: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000301",
    })),
    rotatePlatformSecret: vi.fn(async () => ({
      outcome: "updated" as const,
      id: "00000000-0000-4000-8000-000000000301",
    })),
    revokePlatformSecret: vi.fn(async () => ({
      outcome: "updated" as const,
      id: "00000000-0000-4000-8000-000000000301",
    })),
    setModelProvider: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000401",
      revisionNumber: 1,
    })),
    setModel: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000402",
      revisionNumber: 1,
    })),
    recordModelProviderHealth: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000403",
    })),
    setModelRoutingPolicy: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000501",
      revisionNumber: 1,
    })),
    setModelRoutingControl: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000502",
      revisionNumber: 1,
    })),
    previewModelRoute: vi.fn(async () => ({
      outcome: "unavailable" as const,
      reason: "policy_not_found" as const,
      policyId: null,
      policyKey: "code_generation",
      policyRevisionNumber: null,
      evaluations: [],
    })),
    setPlatformIntegration: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000801",
      revisionNumber: 1,
    })),
    recordPlatformIntegrationHealth: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000802",
    })),
    setPlatformAdapterRelease: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000901",
      revisionNumber: 1,
    })),
    setPlatformFeatureFlag: vi.fn(async () => ({
      outcome: "created" as const,
      id: "00000000-0000-4000-8000-000000000902",
      revisionNumber: 1,
    })),
    evaluatePlatformFeatureFlag: vi.fn(async (key) => ({
      key,
      environment: "development" as const,
      enabled: false,
      reason: "flag_not_found" as const,
      revisionNumber: null,
      matchedRuleId: null,
      rolloutBucket: null,
      evaluatedAt: "2026-08-30T16:00:00.000Z",
    })),
  };
}

function createTestApp(runtime: AuthenticationRuntime) {
  return createApp({
    resolveAuthenticationRuntime: vi.fn(async () => runtime),
  });
}

describe("Atharvan control-plane worker", () => {
  it("reports liveness without claiming dependency readiness", async () => {
    const response = await createTestApp(createRuntime()).request(
      "/health/live",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "atharvan-control-plane",
      status: "alive",
    });
  });

  it("validates runtime configuration before reporting readiness", async () => {
    const response = await createTestApp(createRuntime()).request(
      "/health/ready",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "atharvan-control-plane",
      status: "ready",
      environment: "development",
    });
  });

  it("does not expose protected platform data without a session", async () => {
    const response = await createTestApp(
      createRuntime({ userId: null }),
    ).request("/v1/platform/overview", undefined, bindings);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "authentication_required",
    });
  });

  it("rejects a session whose operator is no longer active", async () => {
    const response = await createTestApp(
      createRuntime({ operator: null }),
    ).request("/v1/platform/overview", undefined, bindings);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "operator_access_denied",
    });
  });

  it("checks the route capability after session validation", async () => {
    const response = await createTestApp(
      createRuntime({
        operator: {
          operatorId: "operator-1",
          isSuperAdministrator: false,
          effectiveCapabilities: ["platform:operators:read"],
        },
      }),
    ).request("/v1/platform/overview", undefined, bindings);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "operator_capability_required",
    });
  });

  it("returns explicit unknown evidence to an authorized operator", async () => {
    const response = await createTestApp(createRuntime()).request(
      "/v1/platform/overview",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "unknown",
      observedAt: null,
      evidence: [],
    });
  });

  it("searches the customer directory through a purpose-bound audited read", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.searchCustomerDirectory).mockResolvedValue({
      status: {
        environment: "development",
        source: "arth",
        freshness: "current",
        sourceRevision: "12",
        observedAt: "2026-08-30T17:59:00.000Z",
        synchronizedAt: "2026-08-30T18:00:00.000Z",
      },
      queryFingerprint:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      users: [
        {
          id: "usr_1",
          email: "person@example.com",
          displayName: "Person",
          lifecycle: "active",
          verificationStatus: "verified",
          createdAt: "2026-08-01T00:00:00.000Z",
          observedAt: "2026-08-30T17:59:00.000Z",
          sourceRevision: "12",
        },
      ],
      workspaces: [],
    });

    const response = await createTestApp(runtime).request(
      "/v1/platform/customer-directory/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "person@example.com",
          scope: "all",
          limit: 20,
          reason: "Investigate an account access request.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      users: [{ id: "usr_1" }],
    });
    expect(runtime.searchCustomerDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "operator-1" }),
      expect.objectContaining({
        query: "person@example.com",
        scope: "all",
        reason: "Investigate an account access request.",
        correlationId: expect.any(String),
      }),
    );
  });

  it("does not broaden a user-only role into workspace inspection", async () => {
    const response = await createTestApp(
      createRuntime({
        operator: {
          operatorId: "operator-2",
          isSuperAdministrator: false,
          effectiveCapabilities: ["platform:users:read"],
        },
      }),
    ).request(
      "/v1/platform/customer-directory/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "example",
          scope: "all",
          limit: 20,
          reason: "Investigate an account access request.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "operator_capability_required",
    });
  });

  it("wraps customer-directory reconciliation in the shared command envelope", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/customer-directory/snapshot",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "directory-revision-12",
        },
        body: JSON.stringify({
          sourceRevision: "12",
          observedAt: "2026-08-30T18:00:00.000Z",
          users: [],
          workspaces: [],
          memberships: [],
          reason: "Reconcile the canonical Arth customer directory.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    expect(runtime.beginPlatformCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "customer-directory.snapshot.reconcile",
        requiredCapability: "platform:customer-directory:sync",
        targetId: "12",
        idempotencyKey: "directory-revision-12",
      }),
    );
    expect(runtime.reconcileCustomerDirectorySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({ sourceRevision: "12" }),
    );
  });

  it("requests a granular customer restriction through the shared command envelope", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/customer-restrictions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "restrict-user-login-1",
        },
        body: JSON.stringify({
          targetType: "user",
          targetId: "usr_1",
          capability: "login",
          desiredState: "restricted",
          confirmation: "RESTRICT usr_1",
          reason: "Contain the confirmed customer account compromise.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    expect(runtime.beginPlatformCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "user.restrict-capability",
        requiredCapability: "platform:users:restrict",
        targetType: "customer_user",
        targetId: "usr_1",
        idempotencyKey: "restrict-user-login-1",
      }),
    );
    expect(runtime.setCustomerRestriction).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        targetType: "user",
        targetId: "usr_1",
        capability: "login",
      }),
    );
  });

  it("does not let a directory reader mutate customer restrictions", async () => {
    const response = await createTestApp(
      createRuntime({
        operator: {
          operatorId: "operator-2",
          isSuperAdministrator: false,
          effectiveCapabilities: ["platform:users:read"],
        },
      }),
    ).request(
      "/v1/platform/customer-restrictions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "unauthorized-restriction",
        },
        body: JSON.stringify({
          targetType: "user",
          targetId: "usr_1",
          capability: "login",
          desiredState: "restricted",
          confirmation: "RESTRICT usr_1",
          reason: "Attempt a restriction without mutation authority.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "operator_capability_required",
    });
  });

  it("records ownership transfer approval in the shared command envelope", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/customer-ownership-transfers",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "transfer-workspace-owner-1",
        },
        body: JSON.stringify({
          workspaceId: "wrk_1",
          successorUserId: "usr_2",
          approvalReference: "APR-42",
          confirmation: "TRANSFER wrk_1 TO usr_2",
          reason: "Recover ownership after verified owner departure.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(201);
    expect(runtime.beginPlatformCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "workspace.ownership-transfer.request",
        requiredCapability: "platform:workspaces:transfer",
        approvalReference: "APR-42",
        idempotencyKey: "transfer-workspace-owner-1",
      }),
    );
    expect(runtime.requestCustomerOwnershipTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        workspaceId: "wrk_1",
        successorUserId: "usr_2",
      }),
    );
  });

  it("redacts internal note bodies from command fingerprints", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/customer-operations/notes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "customer-note-1",
        },
        body: JSON.stringify({
          targetType: "user",
          targetId: "usr_1",
          category: "support",
          body: "Customer requested an account access review.",
          reason: "Record bounded internal support context.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(201);
    expect(runtime.beginPlatformCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "user.internal-note.create",
        safePayload: expect.objectContaining({ body: "[redacted]" }),
      }),
    );
  });

  it("searches and exports immutable audit evidence with separate capabilities", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.listPlatformAuditEvents).mockResolvedValue({
      items: [
        {
          id: "00000000-0000-4000-8000-000000000991",
          actorId: "00000000-0000-4000-8000-000000000001",
          actorEmail: "owner@example.com",
          eventType: "platform.command.succeeded",
          targetType: "platform_configuration",
          targetId: "platform.release.channel",
          correlationId: "00000000-0000-4000-8000-000000000992",
          reason: "Promote the development release channel.",
          evidence: { outcome: "succeeded" },
          occurredAt: "2026-08-30T16:00:00.000Z",
          command: null,
        },
      ],
      nextCursor: null,
    });
    const search = await createTestApp(runtime).request(
      "/v1/platform/audit-events?eventType=platform.command&outcome=succeeded",
      undefined,
      bindings,
    );
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toMatchObject({
      items: [{ eventType: "platform.command.succeeded" }],
    });
    expect(runtime.listPlatformAuditEvents).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "operator-1" }),
      expect.objectContaining({
        eventType: "platform.command",
        outcome: "succeeded",
      }),
    );

    const exported = await createTestApp(runtime).request(
      "/v1/platform/audit-events/export?from=2026-08-29T00%3A00%3A00.000Z&to=2026-08-30T00%3A00%3A00.000Z",
      undefined,
      bindings,
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain(
      "application/x-ndjson",
    );
  });

  it("returns the operator directory only with its read capability", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.listOperators).mockResolvedValue([
      {
        id: "operator-1",
        email: "owner@example.com",
        emailDomain: "example.com",
        status: "active",
        isSuperAdministrator: true,
        effectiveCapabilities: ["platform:*"],
        assignedRoles: [],
        invitationStatus: null,
        invitedAt: "2026-08-30T00:00:00.000Z",
        activatedAt: "2026-08-30T00:00:00.000Z",
      },
    ]);

    const response = await createTestApp(runtime).request(
      "/v1/platform/operators",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ email: "owner@example.com" }],
    });
  });

  it("validates and delegates an audited operator invitation", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/operators/invitations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "operator@example.com",
          organizationId: "arth",
          roleKey: "platform_viewer",
          reason: "Platform operations responsibility.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(201);
    expect(runtime.createOperatorInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "operator-1" }),
      expect.objectContaining({
        email: "operator@example.com",
        roleKey: "platform_viewer",
        correlationId: expect.any(String),
      }),
    );
  });

  it("lists immutable role definitions for directory readers", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.listOperatorRoleDefinitions).mockResolvedValue([
      {
        definitionId: "00000000-0000-4000-8000-000000000101",
        key: "platform_viewer",
        name: "Platform Viewer",
        version: 1,
        description: "Read non-sensitive platform state.",
        capabilities: ["platform:overview:read"],
        isActive: true,
        isSystem: true,
      },
    ]);

    const response = await createTestApp(runtime).request(
      "/v1/platform/operator-roles",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ key: "platform_viewer", version: 1 }],
    });
  });

  it("delegates role replacement with fresh-session proof", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/operators/00000000-0000-4000-8000-000000000201/roles",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          roleKeys: ["platform_viewer", "auditor"],
          reason: "Approved responsibility change.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    expect(runtime.replaceOperatorRoles).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        targetOperatorId: "00000000-0000-4000-8000-000000000201",
        roleKeys: ["platform_viewer", "auditor"],
      }),
    );
  });

  it("returns resolved platform configuration only to authorized operators", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.listPlatformConfiguration).mockResolvedValue({
      environment: "development",
      items: [
        {
          definitionId: "00000000-0000-4000-8000-000000000203",
          key: "platform.release.channel",
          category: "releases",
          name: "Release channel",
          description: "Default release channel.",
          valueType: "string",
          validation: { allowedValues: ["stable", "beta"] },
          defaultValue: "stable",
          platformOverride: null,
          environmentOverride: null,
          resolvedValue: "stable",
          resolvedFrom: "default",
          recentRevisions: [],
        },
      ],
    });

    const response = await createTestApp(runtime).request(
      "/v1/platform/configuration",
      undefined,
      bindings,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      environment: "development",
      items: [{ key: "platform.release.channel", resolvedFrom: "default" }],
    });
  });

  it("delegates an audited configuration revision with fresh-session proof", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/configuration/platform.release.channel",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "environment",
          value: "beta",
          reason: "Enable beta releases in development.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    expect(runtime.setPlatformConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        key: "platform.release.channel",
        scope: "environment",
        value: "beta",
        correlationId: expect.any(String),
      }),
    );
  });

  it("rejects malformed configuration writes before storage", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/configuration/platform.release.channel",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "workspace", value: "beta" }),
      },
      bindings,
    );

    expect(response.status).toBe(400);
    expect(runtime.setPlatformConfiguration).not.toHaveBeenCalled();
  });

  it("lists secret metadata without exposing provider locators or values", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.listPlatformSecretReferences).mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000301",
        key: "models.openai",
        purpose: "Platform model routing",
        environment: "development",
        provider: "cloudflare_secrets_store",
        status: "active",
        currentVersionNumber: 1,
        createdByOperatorId: "operator-1",
        createdAt: "2026-08-30T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
        revokedAt: null,
        recentVersions: [],
      },
    ]);
    const response = await createTestApp(runtime).request(
      "/v1/platform/secret-references",
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain("models.openai");
    expect(serialized).not.toContain("providerSecretId");
    expect(serialized).not.toContain("providerName");
    expect(serialized).not.toContain("value");
  });

  it("delegates secret creation without returning submitted material", async () => {
    const runtime = createRuntime();
    const secretValue = "development-provider-key";
    const response = await createTestApp(runtime).request(
      "/v1/platform/secret-references",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "models.openai",
          purpose: "Platform model routing",
          value: secretValue,
          reason: "Provision development model access.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.createPlatformSecret).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({ key: "models.openai", value: secretValue }),
    );
    expect(runtime.beginPlatformCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "platform.secret.create",
        safePayload: expect.objectContaining({ value: "[redacted]" }),
      }),
    );
    expect(
      JSON.stringify(vi.mocked(runtime.beginPlatformCommand).mock.calls),
    ).not.toContain(secretValue);
    expect(runtime.completePlatformCommand).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "succeeded", responseStatus: 201 }),
    );
    expect(await response.text()).not.toContain(secretValue);
  });

  it("replays a completed command without executing the domain mutation", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.beginPlatformCommand).mockResolvedValue({
      state: "replayed",
      commandId: "00000000-0000-4000-8000-000000000990",
      result: {
        outcome: "succeeded",
        responseStatus: 200,
        responseBody: {
          outcome: "updated",
          key: "platform.release.channel",
          revisionNumber: 2,
        },
      },
    });
    const response = await createTestApp(runtime).request(
      "/v1/platform/configuration/platform.release.channel",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "release-channel-command-1",
        },
        body: JSON.stringify({
          scope: "environment",
          value: "stable",
          reason: "Promote the development release channel.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "updated",
      revisionNumber: 2,
    });
    expect(runtime.setPlatformConfiguration).not.toHaveBeenCalled();
    expect(runtime.completePlatformCommand).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before secret revocation", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/secret-references/00000000-0000-4000-8000-000000000301/revoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Credential is no longer required." }),
      },
      bindings,
    );
    expect(response.status).toBe(400);
    expect(runtime.revokePlatformSecret).not.toHaveBeenCalled();
  });

  it("fails closed when the secret provider is not configured", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.createPlatformSecret).mockRejectedValue(
      new PlatformSecretProviderError("unconfigured"),
    );
    const response = await createTestApp(runtime).request(
      "/v1/platform/secret-references",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: "models.openai",
          purpose: "Platform model routing",
          value: "never-return-this",
          reason: "Provision development model access.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("never-return-this");
  });

  it("returns an evidence-based model catalogue to model readers", async () => {
    const runtime = createRuntime();
    vi.mocked(runtime.listModelCatalogue).mockResolvedValue({
      environment: "development",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000401",
          key: "openai",
          displayName: "OpenAI",
          adapterKind: "openai",
          baseUrl: "https://api.openai.com/v1",
          credentialReferenceId: "00000000-0000-4000-8000-000000000301",
          credentialReferenceKey: "models.openai",
          regions: ["global"],
          maximumDataClassification: "confidential",
          lifecycle: "active",
          revisionNumber: 1,
          updatedAt: "2026-08-30T00:00:00.000Z",
          health: {
            id: "unknown",
            state: "unknown",
            reportedStatus: null,
            source: null,
            latencyMs: null,
            httpStatusCode: null,
            errorCode: null,
            observedAt: null,
            expiresAt: null,
          },
          models: [],
        },
      ],
    });
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-catalogue",
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      environment: "development",
      items: [{ key: "openai", health: { state: "unknown" } }],
    });
  });

  it("validates and delegates provider revisions", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-providers/openai",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "OpenAI",
          adapterKind: "openai",
          baseUrl: "https://api.openai.com/v1",
          credentialReferenceId: "00000000-0000-4000-8000-000000000301",
          regions: ["global"],
          maximumDataClassification: "confidential",
          lifecycle: "active",
          reason: "Register the development model provider.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.setModelProvider).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        key: "openai",
        credentialReferenceId: "00000000-0000-4000-8000-000000000301",
      }),
    );
  });

  it("validates and delegates model revisions", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-providers/00000000-0000-4000-8000-000000000401/models/gpt-5.6",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "GPT 5.6",
          kind: "generation",
          capabilities: ["reasoning", "tool_use"],
          contextWindowTokens: 400000,
          maximumOutputTokens: 128000,
          inputPriceMicrounitsPerMillion: 2500000,
          outputPriceMicrounitsPerMillion: 15000000,
          regions: ["global"],
          maximumDataClassification: "confidential",
          lifecycle: "active",
          reason: "Publish the verified model metadata.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({ key: "gpt-5.6", kind: "generation" }),
    );
  });

  it("records bounded provider health evidence without requiring step-up", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-providers/00000000-0000-4000-8000-000000000401/health-observations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "degraded",
          latencyMs: 1200,
          httpStatusCode: 429,
          errorCode: "rate_limited",
          reason: "Recorded from an authenticated provider probe.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.recordModelProviderHealth).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "operator-1" }),
      expect.objectContaining({ status: "degraded", httpStatusCode: 429 }),
    );
  });

  it("returns the environment-scoped integration registry to integration readers", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/integrations",
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      environment: "development",
      items: [],
    });
  });

  it("validates and delegates immutable OAuth application revisions", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/integrations/github",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "GitHub",
          protocol: "oauth2",
          connectionMode: "direct",
          capabilities: ["source_control"],
          adapterPackage: "@arth/github",
          adapterVersion: "1.0.0",
          documentationUrl: "https://docs.github.com/apps/oauth-apps",
          authorizationUrl: "https://github.com/login/oauth/authorize",
          tokenUrl: "https://github.com/login/oauth/access_token",
          clientId: "public-client-id",
          clientSecretReferenceId: "00000000-0000-4000-8000-000000000301",
          webhookSecretReferenceId: null,
          callbackUrls: ["https://dev.admin.arth.sh/api/oauth/github/callback"],
          requiredScopes: ["read:user"],
          optionalScopes: ["repo"],
          lifecycle: "active",
          operationalState: "enabled",
          maintenanceExpiresAt: null,
          reason: "Register the development GitHub OAuth application.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.setPlatformIntegration).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        key: "github",
        protocol: "oauth2",
        capabilities: ["source_control"],
      }),
    );
  });

  it("records expiring integration health evidence", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/integrations/00000000-0000-4000-8000-000000000801/health-observations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "degraded",
          latencyMs: 900,
          httpStatusCode: 429,
          errorCode: "rate_limited",
          reason: "Recorded from the authenticated OAuth probe.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.recordPlatformIntegrationHealth).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: "operator-1" }),
      expect.objectContaining({ status: "degraded", httpStatusCode: 429 }),
    );
  });

  it("returns adapter releases to adapter readers", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/adapters",
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      environment: "development",
      items: [],
    });
  });

  it("validates and delegates reviewed adapter release revisions", async () => {
    const runtime = createRuntime();
    const capabilityNames = [
      "detect",
      "understand",
      "modify",
      "validate",
      "preview",
      "deploy",
      "operate",
      "migrate",
    ];
    const response = await createTestApp(runtime).request(
      "/v1/platform/adapters/django/releases/1.2.0",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Django",
          category: "framework",
          packageName: "@arth/django-adapter",
          packageDigestSha256: "a".repeat(64),
          documentationUrl: "https://docs.arth.sh/adapters/django",
          capabilities: capabilityNames.map((name) => ({
            name,
            maturity: name === "detect" ? "stable" : "unsupported",
          })),
          declaredPermissions: ["repository:read"],
          configurationFields: [
            {
              key: "python_version",
              label: "Python version",
              type: "string",
              required: true,
            },
          ],
          commands: [
            {
              key: "detect",
              description: "Detect a Django repository.",
              risk: "read",
            },
          ],
          supportedEnvironments: ["development", "production"],
          compatibilityTags: ["python:3.13", "django:5"],
          requiredSecretPurposes: [],
          healthChecks: [
            {
              key: "doctor",
              command: "arth-adapter doctor",
              timeoutSeconds: 30,
            },
          ],
          releaseChannel: "stable",
          signatureStatus: "verified",
          securityReviewStatus: "approved",
          securityReviewReference: "SEC-2026-0042",
          lifecycle: "active",
          blockReason: null,
          deprecatedAt: null,
          sunsetAt: null,
          reason: "Publish the reviewed Django adapter release.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.setPlatformAdapterRelease).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        key: "django",
        version: "1.2.0",
        capabilities: expect.arrayContaining([
          { name: "detect", maturity: "stable" },
        ]),
      }),
    );
  });

  it("returns model-routing policies and operational controls to model readers", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-routing",
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      environment: "development",
      policies: [],
      controls: [],
    });
  });

  it("validates and delegates versioned routing policies", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-routing/policies/code_generation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Code generation",
          requiredCapabilities: ["code_generation", "tool_use"],
          maximumDataClassification: "confidential",
          allowedRegions: ["global"],
          targets: [
            {
              modelId: "00000000-0000-4000-8000-000000000402",
              rolloutBasisPoints: 10000,
              allowDegraded: false,
            },
          ],
          reason: "Publish the development coding route.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.setModelRoutingPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        key: "code_generation",
        targets: [expect.objectContaining({ rolloutBasisPoints: 10000 })],
      }),
    );
  });

  it("validates and delegates immediate model kill switches", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-routing/controls/model/00000000-0000-4000-8000-000000000402",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: "disabled",
          reason: "Contain the model after a safety incident.",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(201);
    expect(runtime.setModelRoutingControl).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        targetKind: "model",
        state: "disabled",
        maintenanceExpiresAt: null,
      }),
    );
  });

  it("previews routing decisions without mutating catalogue state", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/model-routing/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policyKey: "code_generation",
          stableRoutingKey: "preview-request-1",
          requiredCapabilities: ["reasoning"],
          dataClassification: "internal",
          region: "global",
        }),
      },
      bindings,
    );
    expect(response.status).toBe(200);
    expect(runtime.previewModelRoute).toHaveBeenCalledWith(
      expect.objectContaining({ stableRoutingKey: "preview-request-1" }),
    );
  });

  it("returns the feature flag registry only with its read capability", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/feature-flags",
      undefined,
      bindings,
    );
    expect(response.status).toBe(200);
    expect(runtime.listPlatformFeatureFlags).toHaveBeenCalledOnce();

    const denied = await createTestApp(
      createRuntime({
        operator: {
          operatorId: "operator-2",
          isSuperAdministrator: false,
          effectiveCapabilities: ["platform:overview:read"],
        },
      }),
    ).request("/v1/platform/feature-flags", undefined, bindings);
    expect(denied.status).toBe(403);
  });

  it("accepts typed flag revisions and previews deterministic evaluation", async () => {
    const runtime = createRuntime();
    const body = {
      displayName: "New dashboard",
      purpose: "Stage the new Arth dashboard safely.",
      ownerOperatorId: "00000000-0000-4000-8000-000000000101",
      lifecycle: "active",
      defaultEnabled: false,
      emergencyDisabled: false,
      rules: [
        {
          id: "beta_rollout",
          description: "Enable the beta cohort.",
          enabled: true,
          planKeys: [],
          workspaceIds: [],
          userIds: [],
          regions: [],
          cohorts: ["beta"],
          internalStaff: null,
          minimumAccountAgeDays: null,
          maximumAccountAgeDays: null,
          rolloutBasisPoints: 2500,
        },
      ],
      reviewAt: "2026-09-15T00:00:00.000Z",
      expiresAt: "2026-10-01T00:00:00.000Z",
      reason: "Start the reviewed beta rollout.",
    };
    const update = await createTestApp(runtime).request(
      "/v1/platform/feature-flags/dashboard.new_navigation",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      bindings,
    );
    expect(update.status).toBe(201);
    expect(runtime.setPlatformFeatureFlag).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({
        key: "dashboard.new_navigation",
        rules: [expect.objectContaining({ id: "beta_rollout" })],
      }),
    );

    const evaluation = await createTestApp(runtime).request(
      "/v1/platform/feature-flags/dashboard.new_navigation/evaluate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stableRoutingKey: "workspace-42",
          cohorts: ["beta"],
        }),
      },
      bindings,
    );
    expect(evaluation.status).toBe(200);
    expect(runtime.evaluatePlatformFeatureFlag).toHaveBeenCalledWith(
      "dashboard.new_navigation",
      expect.objectContaining({ stableRoutingKey: "workspace-42" }),
    );
  });

  it("rejects malformed administrative commands before storage", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/operators/invitations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      },
      bindings,
    );

    expect(response.status).toBe(400);
    expect(runtime.createOperatorInvitation).not.toHaveBeenCalled();
  });

  it("uses a newly verified session as short-lived domain-change proof", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/v1/platform/membership-domains",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "engineering.example.com",
          includeSubdomains: false,
          reason: "Approved internal operator organization.",
        }),
      },
      bindings,
    );

    expect(response.status).toBe(201);
    expect(runtime.addMembershipDomain).toHaveBeenCalledWith(
      expect.objectContaining({ stepUpVerifiedAt: expect.any(Date) }),
      expect.objectContaining({ domain: "engineering.example.com" }),
    );
  });

  it("fails closed before OTP handling when email delivery is absent", async () => {
    const runtime = createRuntime({ emailDeliveryConfigured: false });
    const response = await createTestApp(runtime).request(
      "/api/auth/email-otp/send-verification-otp",
      { method: "POST" },
      bindings,
    );

    expect(response.status).toBe(503);
    expect(runtime.handle).not.toHaveBeenCalled();
  });

  it("mounts Better Auth under the isolated auth path", async () => {
    const runtime = createRuntime();
    const response = await createTestApp(runtime).request(
      "/api/auth/get-session",
      undefined,
      bindings,
    );

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe("auth-handler");
  });

  it("returns a structured not-found response", async () => {
    const response = await createTestApp(createRuntime()).request(
      "/missing",
      undefined,
      bindings,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "not_found",
    });
  });
});
