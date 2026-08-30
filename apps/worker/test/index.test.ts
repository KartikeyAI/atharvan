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
        : { userId: input?.userId ?? "auth-user-1" },
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
