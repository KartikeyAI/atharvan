import { describe, expect, it } from "vitest";

import { app } from "../src/index";

const bindings: Cloudflare.DevEnv = {
  ATHARVAN_ENVIRONMENT: "development",
  ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.invalid",
};

describe("Atharvan control-plane worker", () => {
  it("reports liveness without claiming dependency readiness", async () => {
    const response = await app.request("/health/live", undefined, bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "atharvan-control-plane",
      status: "alive",
    });
  });

  it("validates runtime configuration before reporting readiness", async () => {
    const response = await app.request("/health/ready", undefined, bindings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "atharvan-control-plane",
      status: "ready",
      environment: "development",
    });
  });

  it("returns an explicit unknown overview until evidence exists", async () => {
    const response = await app.request(
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

  it("returns a structured not-found response", async () => {
    const response = await app.request("/missing", undefined, bindings);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "not_found",
    });
  });
});
