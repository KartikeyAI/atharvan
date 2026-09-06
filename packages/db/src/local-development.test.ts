import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";

import {
  localChildEnvironment,
  parseLocalEnvironment,
  serializeWorkerBindings,
} from "../../../scripts/local-environment";

const valid = [
  "ATHARVAN_ENVIRONMENT=development",
  "ATHARVAN_PUBLIC_ORIGIN=http://localhost:3000",
  "DATABASE_URL=postgresql://operator:fixture-password@database.example/atharvan?sslmode=require",
  `BETTER_AUTH_SECRET=${"a".repeat(32)}`,
  `ATHARVAN_VERIFICATION_HMAC_SECRET=${"b".repeat(32)}`,
  "ATHARVAN_SUPER_ADMIN_EMAIL=operator@example.com",
  'ATHARVAN_EMAIL_FROM="Atharvan <login@example.com>"',
].join("\n");

describe("local development settings", () => {
  it("allows deferred providers, including blank optional values", () => {
    expect(
      parseLocalEnvironment(
        valid + "\nRESEND_API_KEY=\nCLOUDFLARE_SECRETS_STORE_ID=",
      ).RESEND_API_KEY,
    ).toBeUndefined();
  });
  it("rejects partial Secret Store configuration without exposing its value", () => {
    const secret = "private-store-token";
    let message = "";
    try {
      parseLocalEnvironment(
        valid + `\nCLOUDFLARE_SECRETS_STORE_API_TOKEN=${secret}`,
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Secrets Store configuration");
    expect(message).not.toContain(secret);
  });
  it.each([
    "https://hosted.example",
    "http://0.0.0.0:3000",
    "http://localhost:8787",
    "http://localhost:3000/login",
    "http://localhost:3000?token=private",
    "http://user:private@localhost:3000",
    "http://localhost",
  ])("rejects unsafe or inconsistent public origin %s", (origin) => {
    expect(() =>
      parseLocalEnvironment(valid.replace("http://localhost:3000", origin)),
    ).toThrow("ATHARVAN_PUBLIC_ORIGIN");
  });
  it("rejects production mode", () => {
    expect(() =>
      parseLocalEnvironment(valid.replace("=development", "=production")),
    ).toThrow("development");
  });
  it("rejects missing settings and malformed database URLs without values", () => {
    expect(() =>
      parseLocalEnvironment(
        valid.replace(
          /DATABASE_URL=.*/,
          "DATABASE_URL=postgresql://private-value",
        ),
      ),
    ).toThrow("DATABASE_URL");
    expect(() =>
      parseLocalEnvironment(
        valid.replace(/BETTER_AUTH_SECRET=.*/, "BETTER_AUTH_SECRET=short"),
      ),
    ).toThrow("BETTER_AUTH_SECRET");
  });
  it("passes only schema bindings to Wrangler and round-trips special characters", () => {
    const config = parseLocalEnvironment(
      valid +
        '\nVITE_UNSAFE_SECRET=must-not-pass\nNODE_OPTIONS=must-not-pass\nRESEND_API_KEY="value#with=symbols"',
    );
    expect(parseEnv(serializeWorkerBindings(config))).toEqual(config);
    expect(serializeWorkerBindings(config)).not.toContain("must-not-pass");
  });
  it("does not inherit application, Vite, Node options, or cloud credentials into either child", () => {
    const env = localChildEnvironment({
      Path: "system-path",
      SystemRoot: "windows",
      HOME: "home",
      DATABASE_URL: "private",
      VITE_SECRET: "private",
      CLOUDFLARE_API_TOKEN: "private",
      NODE_OPTIONS: "private",
      CLOUDFLARE_ENV: "production",
      CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    });
    expect(env.Path).toBe("system-path");
    expect(env.CLOUDFLARE_ENV).toBe("dev");
    expect(env.CLOUDFLARE_INCLUDE_PROCESS_ENV).toBe("false");
    expect(JSON.stringify(env)).not.toContain("private");
  });

  it.each([
    String.raw`secret\nwith\slashes#and="quotes"`,
    "secret'with\nnewlines",
    "secret'with`quotes",
  ])("preserves literal credential characters", (secret) => {
    const config = { ...parseLocalEnvironment(valid), RESEND_API_KEY: secret };
    expect(parseEnv(serializeWorkerBindings(config)).RESEND_API_KEY).toBe(
      secret,
    );
  });
});
