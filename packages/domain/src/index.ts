export const platformCapabilityWildcard = "platform:*" as const;

export const customerPrivateCapabilityPrefix = "customer-private:" as const;

export type PlatformHealthStatus =
  "healthy" | "degraded" | "action-required" | "unknown";

export interface PlatformOverview {
  readonly status: PlatformHealthStatus;
  readonly observedAt: string | null;
  readonly evidence: ReadonlyArray<never>;
}

export const unknownPlatformOverview: PlatformOverview = Object.freeze({
  status: "unknown",
  observedAt: null,
  evidence: [],
});

export function isCustomerPrivateCapability(capability: string): boolean {
  return capability.startsWith(customerPrivateCapabilityPrefix);
}

export function platformWildcardMatches(capability: string): boolean {
  return (
    capability.startsWith("platform:") &&
    !isCustomerPrivateCapability(capability)
  );
}

export * from "./operator-onboarding";
