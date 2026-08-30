import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

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
    if (!response.ok) return { authenticated: false };
    const body: unknown = await response.json().catch(() => null);
    return { authenticated: isSessionBody(body) };
  },
);

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
