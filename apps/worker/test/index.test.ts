import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

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
          intendedCapabilities: ["platform:operators:read"],
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
        correlationId: expect.any(String),
      }),
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
