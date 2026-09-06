import {
  assertDelegableOperatorCapabilities,
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformApprovalScope,
  type PlatformApprovalPage,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";
import { PlatformCommandRejectedError } from "./errors";

export interface ApprovalActorContext {
  readonly commandId: string;
  readonly actor: AuthenticatedOperator;
  readonly sessionId: string;
  readonly correlationId: string;
}
export interface PlatformApprovalStore {
  list(input: {
    actorId: string;
    correlationId: string;
    environment: PlatformConfigurationEnvironment;
  }): Promise<PlatformApprovalPage>;
  request(input: {
    commandId: string;
    actorId: string;
    sessionId: string;
    environment: PlatformConfigurationEnvironment;
    correlationId: string;
    scope: PlatformApprovalScope;
    reason: string;
    now: Date;
    expiresAt: Date;
  }): Promise<{ outcome: "created"; id: string }>;
  decide(input: {
    commandId: string;
    actorId: string;
    sessionId: string;
    environment: PlatformConfigurationEnvironment;
    correlationId: string;
    approvalId: string;
    decision: "approved" | "rejected" | "revoked";
    reason: string;
    now: Date;
  }): Promise<{ outcome: "updated" | "unchanged"; id: string }>;
}

/** Parse a closed set of approval intents. Extra fields and secret-bearing shapes never persist. */
export function parseApprovalScope(
  value: unknown,
): PlatformApprovalScope | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string, max = 200) =>
    typeof raw[key] === "string" &&
    raw[key].trim().length > 0 &&
    raw[key].length <= max
      ? raw[key].trim()
      : null;
  if (raw.kind === "platform_ownership_transfer") {
    const currentOwnerOperatorId = text("currentOwnerOperatorId", 36),
      successorOperatorId = text("successorOperatorId", 36);
    return currentOwnerOperatorId &&
      successorOperatorId &&
      isUuid(currentOwnerOperatorId) &&
      isUuid(successorOperatorId) &&
      currentOwnerOperatorId !== successorOperatorId
      ? { kind: raw.kind, currentOwnerOperatorId, successorOperatorId }
      : null;
  }
  if (raw.kind === "workspace_ownership_transfer") {
    const workspaceId = text("workspaceId"),
      expectedOwnerUserId = text("expectedOwnerUserId"),
      sourceRevision = text("sourceRevision", 19),
      successorUserId = text("successorUserId");
    if (
      !workspaceId ||
      !expectedOwnerUserId ||
      !successorUserId ||
      !sourceRevision ||
      !/^[1-9][0-9]{0,18}$/.test(sourceRevision) ||
      BigInt(sourceRevision) > 9223372036854775807n ||
      expectedOwnerUserId === successorUserId
    )
      return null;
    return {
      kind: raw.kind,
      workspaceId,
      expectedOwnerUserId,
      sourceRevision,
      successorUserId,
    };
  }
  if (raw.kind === "operator_break_glass") {
    const targetOperatorId = text("targetOperatorId", 36),
      incidentReference = text("incidentReference", 128);
    if (
      !targetOperatorId ||
      !isUuid(targetOperatorId) ||
      !incidentReference ||
      incidentReference.length < 3 ||
      typeof raw.durationMinutes !== "number" ||
      !Number.isInteger(raw.durationMinutes) ||
      raw.durationMinutes < 5 ||
      raw.durationMinutes > 60 ||
      !Array.isArray(raw.capabilities) ||
      raw.capabilities.length > 100 ||
      raw.capabilities.some(
        (capability: unknown) =>
          typeof capability !== "string" || capability.length > 128,
      )
    )
      return null;
    const capabilities = [...new Set(raw.capabilities as string[])].sort();
    try {
      assertDelegableOperatorCapabilities(capabilities);
    } catch {
      return null;
    }
    return {
      kind: raw.kind,
      targetOperatorId,
      capabilities,
      durationMinutes: raw.durationMinutes,
      incidentReference,
    };
  }
  return null;
}

export function approvalCapability(scope: PlatformApprovalScope): string {
  if (scope.kind === "platform_ownership_transfer")
    return "platform:operators:ownership:transfer";
  return scope.kind === "operator_break_glass"
    ? "platform:operators:break-glass:write"
    : "platform:workspaces:transfer";
}

/** Canonical scope is the signed-off intent, independent of UI field order. */
export function approvalScopeIdentity(scope: PlatformApprovalScope): string {
  const normalized = parseApprovalScope(scope);
  if (!normalized)
    throw new PlatformCommandRejectedError("approval_scope_invalid");
  return JSON.stringify(normalized);
}

export function createPlatformApprovalService(
  store: PlatformApprovalStore,
  environment: PlatformConfigurationEnvironment,
) {
  return {
    list(actor: AuthenticatedOperator, correlationId: string) {
      return store.list({
        actorId: actor.operatorId,
        environment,
        correlationId,
      });
    },
    request(
      context: ApprovalActorContext,
      scope: PlatformApprovalScope,
      reason: string,
    ) {
      const now = new Date();
      assertPlatformCommandAuthorized({
        actor: context.actor,
        requestedCapability: approvalCapability(scope),
        requireSuperAdministrator:
          scope.kind !== "workspace_ownership_transfer",
        requireRecentStepUp: true,
        now,
      });
      const normalized = parseApprovalScope(scope);
      if (!normalized)
        throw new PlatformCommandRejectedError("approval_scope_invalid");
      return store.request({
        commandId: context.commandId,
        actorId: context.actor.operatorId,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        environment,
        scope: normalized,
        reason: requireReason(reason),
        now,
        expiresAt: new Date(now.getTime() + 30 * 60_000),
      });
    },
    decide(
      context: ApprovalActorContext,
      approvalId: string,
      decision: "approved" | "rejected" | "revoked",
      reason: string,
    ) {
      const now = new Date();
      if (!isUuid(approvalId))
        throw new PlatformCommandRejectedError("approval_not_found");
      assertPlatformCommandAuthorized({
        actor: context.actor,
        requestedCapability:
          decision === "revoked"
            ? "platform:authentication:sessions:self"
            : "platform:security:write",
        requireRecentStepUp: true,
        now,
      });
      return store.decide({
        commandId: context.commandId,
        actorId: context.actor.operatorId,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        environment,
        approvalId,
        decision,
        reason: requireReason(reason),
        now,
      });
    },
  };
}

function requireReason(value: string) {
  const reason = value.trim();
  if (reason.length < 8 || reason.length > 500)
    throw new PlatformCommandRejectedError("command_reason_required");
  return reason;
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
