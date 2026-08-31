import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { OperatorAuthenticationAssurance } from "@atharvan/domain";

export const resolveConsoleSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = getRequest();
    if (env.CONTROL_PLANE === undefined) return { authenticated: false };
    const url = new URL("/api/auth/get-session", request.url);
    const response = await env.CONTROL_PLANE.fetch(
      new Request(url, {
        method: "GET",
        headers: request.headers,
      }),
    );
    if (!response.ok) return { authenticated: false } as const;
    const body: unknown = await response.json().catch(() => null);
    if (!isSessionBody(body)) return { authenticated: false } as const;

    const assuranceUrl = new URL(
      "/v1/platform/authentication/assurance",
      request.url,
    );
    const assuranceResponse = await env.CONTROL_PLANE.fetch(
      new Request(assuranceUrl, {
        method: "GET",
        headers: request.headers,
      }),
    );
    if (!assuranceResponse.ok) return { authenticated: false } as const;
    const assurance: unknown = await assuranceResponse.json().catch(() => null);
    return !isAuthenticationAssurance(assurance)
      ? ({ authenticated: false } as const)
      : ({ authenticated: true, assurance } as const);
  },
);

export function isAuthenticationAssurance(
  value: unknown,
): value is OperatorAuthenticationAssurance {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.mode === "enrollment_required" ||
      candidate.mode === "passkey_verification_required" ||
      candidate.mode === "verified") &&
    typeof candidate.strongAuthenticatorEnrolled === "boolean" &&
    (candidate.authenticationMethod === "email_otp" ||
      candidate.authenticationMethod === "passkey") &&
    (candidate.strongAuthenticationAt === null ||
      typeof candidate.strongAuthenticationAt === "string") &&
    typeof candidate.recentStepUp === "boolean"
  );
}

export function isSessionBody(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "session" in value &&
    typeof value.session === "object" &&
    value.session !== null &&
    "user" in value &&
    typeof value.user === "object" &&
    value.user !== null
  );
}

export function sanitizeReturnTo(value: unknown): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/api/") &&
    value !== "/login"
    ? value
    : "/";
}
