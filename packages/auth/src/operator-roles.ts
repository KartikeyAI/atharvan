import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
} from "@atharvan/domain";

import { OnboardingCommandRejectedError } from "./errors";

export type OperatorRoleCommandResult =
  | { readonly outcome: "updated"; readonly operatorId: string }
  | { readonly outcome: "unchanged"; readonly operatorId: string }
  | {
      readonly outcome: "rejected";
      readonly reason:
        | "operator_not_found"
        | "super_administrator_roles_immutable"
        | "role_not_found"
        | "at_least_one_role_required";
    };

export interface OperatorRoleAdministrationStore {
  replaceOperatorRoles(input: {
    readonly actorId: string;
    readonly targetOperatorId: string;
    readonly roleKeys: ReadonlyArray<string>;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<OperatorRoleCommandResult>;
}

export function createOperatorRoleAdministrationService(input: {
  readonly store: OperatorRoleAdministrationStore;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());

  return {
    async replaceOperatorRoles(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetOperatorId: string;
      readonly roleKeys: ReadonlyArray<string>;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:operators:roles:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: commandTime,
      });

      const roleKeys = [...new Set(command.roleKeys.map(normalizeRoleKey))];

      if (roleKeys.length === 0) {
        throw new OnboardingCommandRejectedError("at_least_one_role_required");
      }

      const result = await input.store.replaceOperatorRoles({
        actorId: command.actor.operatorId,
        targetOperatorId: requireUuidLike(
          command.targetOperatorId,
          "target_operator_id_required",
        ),
        roleKeys,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? crypto.randomUUID(),
        now: commandTime,
      });

      if (result.outcome === "rejected") {
        throw new OnboardingCommandRejectedError(result.reason);
      }

      return result;
    },
  };
}

function normalizeRoleKey(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-z][a-z0-9_]{2,63}$/.test(normalized)) {
    throw new OnboardingCommandRejectedError("role_not_found");
  }

  return normalized;
}

function requireReason(value: string): string {
  const reason = value.trim();

  if (reason.length < 8 || reason.length > 500) {
    throw new OnboardingCommandRejectedError("command_reason_required");
  }

  return reason;
}

function requireUuidLike(value: string, reason: string): string {
  const normalized = value.trim();

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(normalized)) {
    throw new OnboardingCommandRejectedError(reason);
  }

  return normalized;
}
