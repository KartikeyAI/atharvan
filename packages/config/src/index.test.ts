import { describe, expect, it } from "vitest";

import { parseAuthenticationRuntimeConfig, parseRuntimeConfig } from "./index";

describe("runtime configuration", () => {
  it("accepts explicit non-secret runtime configuration", () => {
    expect(
      parseRuntimeConfig({
        ATHARVAN_ENVIRONMENT: "development",
        ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.example",
      }),
    ).toEqual({
      ATHARVAN_ENVIRONMENT: "development",
      ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.example",
    });
  });

  it("rejects an invalid origin", () => {
    expect(() =>
      parseRuntimeConfig({
        ATHARVAN_ENVIRONMENT: "production",
        ATHARVAN_PUBLIC_ORIGIN: "not-a-url",
      }),
    ).toThrow();
  });
});

describe("authentication runtime configuration", () => {
  const configured = {
    ATHARVAN_ENVIRONMENT: "development",
    ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.example",
    DATABASE_URL: "postgresql://user:password@database.example/atharvan",
    BETTER_AUTH_SECRET: "b".repeat(32),
    ATHARVAN_VERIFICATION_HMAC_SECRET: "h".repeat(32),
    ATHARVAN_SUPER_ADMIN_EMAIL: "owner@arth.example",
    ATHARVAN_EMAIL_FROM: "Atharvan <operators@arth.example>",
  } as const;

  it("allows email delivery to remain explicitly unconfigured", () => {
    const parsed = parseAuthenticationRuntimeConfig(configured);

    expect(parsed).toMatchObject({
      ATHARVAN_SUPER_ADMIN_EMAIL: "owner@arth.example",
    });
    expect(parsed).not.toHaveProperty("RESEND_API_KEY");
  });

  it("requires all secret-provider boot values together", () => {
    expect(() =>
      parseAuthenticationRuntimeConfig({
        ...configured,
        CLOUDFLARE_SECRETS_STORE_ID: "store-id",
      }),
    ).toThrow("Cloudflare Secrets Store configuration must be complete.");

    expect(
      parseAuthenticationRuntimeConfig({
        ...configured,
        CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID: "account-id",
        CLOUDFLARE_SECRETS_STORE_ID: "store-id",
        CLOUDFLARE_SECRETS_STORE_API_TOKEN: "write-token",
      }),
    ).toMatchObject({ CLOUDFLARE_SECRETS_STORE_ID: "store-id" });
  });

  it("rejects weak authentication secrets and non-PostgreSQL databases", () => {
    expect(() =>
      parseAuthenticationRuntimeConfig({
        ...configured,
        BETTER_AUTH_SECRET: "short",
      }),
    ).toThrow();
    expect(() =>
      parseAuthenticationRuntimeConfig({
        ...configured,
        DATABASE_URL: "https://database.example",
      }),
    ).toThrow();
  });
});
