export const platformCapabilityWildcard = "platform:*" as const;

export const customerPrivateCapabilityPrefix = "customer-private:" as const;

export interface AuthenticatedOperator {
  readonly operatorId: string;
  readonly isSuperAdministrator: boolean;
  readonly effectiveCapabilities: ReadonlyArray<string>;
  readonly strongAuthenticatorEnrolled?: boolean;
  readonly stepUpVerifiedAt?: Date;
  readonly breakGlassGrantIds?: ReadonlyArray<string>;
}

export * from "./platform-overview";
export * from "./operational-alerts";

export function isCustomerPrivateCapability(capability: string): boolean {
  return capability.startsWith(customerPrivateCapabilityPrefix);
}

export function platformWildcardMatches(capability: string): boolean {
  return (
    capability.startsWith("platform:") &&
    !isCustomerPrivateCapability(capability)
  );
}

export function capabilityGrantMatches(
  grant: string,
  requestedCapability: string,
): boolean {
  if (
    isCustomerPrivateCapability(grant) ||
    isCustomerPrivateCapability(requestedCapability)
  ) {
    return false;
  }

  if (grant === requestedCapability) {
    return true;
  }

  if (!grant.endsWith(":*")) {
    return false;
  }

  const namespace = grant.slice(0, -1);
  return requestedCapability.startsWith(namespace);
}

export function operatorHasCapability(
  actor: AuthenticatedOperator,
  requestedCapability: string,
): boolean {
  return actor.effectiveCapabilities.some((grant) =>
    capabilityGrantMatches(grant, requestedCapability),
  );
}

export function assertPlatformCommandAuthorized(input: {
  readonly actor: AuthenticatedOperator;
  readonly requestedCapability: string;
  readonly requireSuperAdministrator?: boolean;
  readonly requireRecentStepUp?: boolean;
  readonly now?: Date;
  readonly maximumStepUpAgeMs?: number;
}): void {
  const {
    actor,
    requestedCapability,
    requireSuperAdministrator = false,
    requireRecentStepUp = false,
    now = new Date(),
    maximumStepUpAgeMs = 5 * 60 * 1_000,
  } = input;

  if (
    isCustomerPrivateCapability(requestedCapability) ||
    (requireSuperAdministrator && !actor.isSuperAdministrator) ||
    !operatorHasCapability(actor, requestedCapability)
  ) {
    throw new Error("operator_command_forbidden");
  }

  if (!requireRecentStepUp) {
    return;
  }

  const stepUpTime = actor.stepUpVerifiedAt?.getTime();

  if (
    stepUpTime === undefined ||
    stepUpTime > now.getTime() ||
    now.getTime() - stepUpTime > maximumStepUpAgeMs
  ) {
    throw new Error("recent_step_up_required");
  }
}

export function assertDelegableOperatorCapabilities(
  capabilities: ReadonlyArray<string>,
): void {
  if (
    capabilities.length === 0 ||
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some(
      (capability) =>
        !capability.startsWith("platform:") ||
        capability === platformCapabilityWildcard ||
        isCustomerPrivateCapability(capability),
    )
  ) {
    throw new Error("invalid_operator_capabilities");
  }
}

export * from "./operator-onboarding";
export * from "./operator-authentication";
export * from "./operator-sessions";
export * from "./operator-lifecycle";
export * from "./email-delivery";
export * from "./operational-retention";
export * from "./arth-command-delivery";
export * from "./platform-approvals";
export * from "./customer-directory";
export * from "./platform-administration";
export * from "./platform-adapters";
export * from "./platform-audit";
export * from "./platform-configuration";
export * from "./platform-commercial";
export * from "./platform-feature-flags";
export * from "./platform-health";
export * from "./platform-integrations";
export * from "./platform-model-routing";
export * from "./platform-models";
export * from "./platform-secrets";
