import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type ChangeOperatorStatusCommand,
  type OperatorLifecycleResult,
  type TransferPlatformOwnershipCommand,
} from "@atharvan/domain";
import { OnboardingCommandRejectedError } from "./errors";

export interface OperatorLifecycleStore {
  transferOwnership(
    input: TransferPlatformOwnershipCommand & {
      readonly actorId: string;
      readonly now: Date;
    },
  ): Promise<{ outcome: "updated"; operatorId: string }>;
  changeStatus(
    input: ChangeOperatorStatusCommand & {
      readonly actorId: string;
      readonly now: Date;
    },
  ): Promise<OperatorLifecycleResult>;
}

/** Status changes are privileged commands; the store repeats live identity checks atomically. */
export function createOperatorLifecycleService(store: OperatorLifecycleStore) {
  return {
    async transferOwnership(
      actor: AuthenticatedOperator,
      command: TransferPlatformOwnershipCommand,
    ) {
      const now = new Date();
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:operators:ownership:transfer",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now,
      });
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          command.successorOperatorId,
        ) ||
        command.reason.trim().length < 8 ||
        command.reason.trim().length > 500
      )
        throw new OnboardingCommandRejectedError("ownership_transfer_invalid");
      return store.transferOwnership({
        ...command,
        reason: command.reason.trim(),
        actorId: actor.operatorId,
        now,
      });
    },
    async changeStatus(
      actor: AuthenticatedOperator,
      command: ChangeOperatorStatusCommand,
    ): Promise<OperatorLifecycleResult> {
      const now = new Date();
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:operators:lifecycle:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now,
      });
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          command.targetOperatorId,
        ) ||
        !["suspend", "restore", "deactivate"].includes(command.action)
      ) {
        throw new OnboardingCommandRejectedError("operator_lifecycle_invalid");
      }
      const reason = command.reason.trim();
      if (reason.length < 8 || reason.length > 500)
        throw new OnboardingCommandRejectedError("command_reason_required");
      return store.changeStatus({
        ...command,
        reason,
        actorId: actor.operatorId,
        now,
      });
    },
  };
}
