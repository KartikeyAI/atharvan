import {
  assertDelegableOperatorCapabilities,
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type OperatorBreakGlassReviewOutcome,
} from "@atharvan/domain";

import { OnboardingCommandRejectedError } from "./errors";

const minimumGrantLifetimeMinutes = 5;
const maximumGrantLifetimeMinutes = 60;

type OperatorBreakGlassRejectedResult = {
  readonly outcome: "rejected";
  readonly reason:
    | "operator_not_found"
    | "super_administrator_elevation_forbidden"
    | "active_break_glass_grant_exists"
    | "break_glass_grant_not_found"
    | "break_glass_grant_not_active"
    | "break_glass_review_requires_terminal_grant"
    | "break_glass_grant_already_reviewed"
    | "break_glass_self_review_forbidden";
};

export type OperatorBreakGlassCommandResult =
  | { readonly outcome: "created"; readonly id: string }
  | { readonly outcome: "updated"; readonly id: string }
  | OperatorBreakGlassRejectedResult;

export interface OperatorBreakGlassAdministrationStore {
  createGrant(input: {
    readonly id: string;
    readonly actorId: string;
    readonly targetOperatorId: string;
    readonly capabilities: ReadonlyArray<string>;
    readonly reason: string;
    readonly incidentReference: string;
    readonly approvalReference: string;
    readonly correlationId: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "created"; readonly id: string }
    | OperatorBreakGlassRejectedResult
  >;
  revokeGrant(input: {
    readonly actorId: string;
    readonly grantId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "updated"; readonly id: string }
    | OperatorBreakGlassRejectedResult
  >;
  reviewGrant(input: {
    readonly id: string;
    readonly actorId: string;
    readonly grantId: string;
    readonly outcome: OperatorBreakGlassReviewOutcome;
    readonly summary: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "created"; readonly id: string }
    | OperatorBreakGlassRejectedResult
  >;
}

export function createOperatorBreakGlassAdministrationService(input: {
  readonly store: OperatorBreakGlassAdministrationStore;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());

  return {
    async createGrant(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetOperatorId: string;
      readonly capabilities: ReadonlyArray<string>;
      readonly durationMinutes: number;
      readonly reason: string;
      readonly incidentReference: string;
      readonly approvalReference: string;
      readonly confirmation: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorizeBreakGlassAdministration(command.actor, commandTime);
      const targetOperatorId = requireUuid(
        command.targetOperatorId,
        "target_operator_id_required",
      );
      const capabilities = [
        ...new Set(command.capabilities.map((value) => value.trim())),
      ].sort();
      assertDelegableOperatorCapabilities(capabilities);
      const durationMinutes = requireGrantLifetime(command.durationMinutes);
      const confirmation = `GRANT BREAK-GLASS TO ${targetOperatorId}`;

      if (command.confirmation.trim() !== confirmation) {
        throw new OnboardingCommandRejectedError(
          "break_glass_confirmation_mismatch",
        );
      }

      const result = await input.store.createGrant({
        id: crypto.randomUUID(),
        actorId: command.actor.operatorId,
        targetOperatorId,
        capabilities,
        reason: requireText(command.reason, 8, 500, "command_reason_required"),
        incidentReference: requireText(
          command.incidentReference,
          3,
          128,
          "break_glass_incident_reference_required",
        ),
        approvalReference: requireText(
          command.approvalReference,
          3,
          256,
          "break_glass_approval_reference_required",
        ),
        correlationId: command.correlationId ?? crypto.randomUUID(),
        expiresAt: new Date(
          commandTime.getTime() + durationMinutes * 60 * 1_000,
        ),
        now: commandTime,
      });

      return requireAccepted(result);
    },

    async revokeGrant(command: {
      readonly actor: AuthenticatedOperator;
      readonly grantId: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorizeBreakGlassAdministration(command.actor, commandTime);
      return requireAccepted(
        await input.store.revokeGrant({
          actorId: command.actor.operatorId,
          grantId: requireUuid(command.grantId, "break_glass_grant_not_found"),
          reason: requireText(
            command.reason,
            8,
            500,
            "command_reason_required",
          ),
          correlationId: command.correlationId ?? crypto.randomUUID(),
          now: commandTime,
        }),
      );
    },

    async reviewGrant(command: {
      readonly actor: AuthenticatedOperator;
      readonly grantId: string;
      readonly outcome: OperatorBreakGlassReviewOutcome;
      readonly summary: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:operators:break-glass:review",
        requireRecentStepUp: true,
        now: commandTime,
      });

      if (command.outcome !== "approved" && command.outcome !== "concerns") {
        throw new OnboardingCommandRejectedError(
          "break_glass_review_outcome_invalid",
        );
      }

      return requireAccepted(
        await input.store.reviewGrant({
          id: crypto.randomUUID(),
          actorId: command.actor.operatorId,
          grantId: requireUuid(command.grantId, "break_glass_grant_not_found"),
          outcome: command.outcome,
          summary: requireText(
            command.summary,
            8,
            1_000,
            "break_glass_review_summary_required",
          ),
          correlationId: command.correlationId ?? crypto.randomUUID(),
          now: commandTime,
        }),
      );
    },
  };
}

function authorizeBreakGlassAdministration(
  actor: AuthenticatedOperator,
  now: Date,
) {
  assertPlatformCommandAuthorized({
    actor,
    requestedCapability: "platform:operators:break-glass:write",
    requireSuperAdministrator: true,
    requireRecentStepUp: true,
    now,
  });
}

function requireGrantLifetime(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < minimumGrantLifetimeMinutes ||
    value > maximumGrantLifetimeMinutes
  ) {
    throw new OnboardingCommandRejectedError(
      "break_glass_duration_out_of_range",
    );
  }

  return value;
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OnboardingCommandRejectedError(reason);
  }
  return normalized;
}

function requireUuid(value: string, reason: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(normalized)) {
    throw new OnboardingCommandRejectedError(reason);
  }
  return normalized;
}

function requireAccepted<
  Result extends Exclude<
    OperatorBreakGlassCommandResult,
    OperatorBreakGlassRejectedResult
  >,
>(result: Result | OperatorBreakGlassRejectedResult): Result {
  if (result.outcome === "rejected") {
    throw new OnboardingCommandRejectedError(result.reason);
  }
  return result;
}
