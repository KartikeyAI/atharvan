import type { OperatorLifecycleStatus } from "./operator-onboarding";

export type OperatorLifecycleAction = "suspend" | "restore" | "deactivate";

export interface TransferPlatformOwnershipCommand {
  /** Accepted command envelope; supplied by the server, never the request body. */
  readonly commandId: string;
  readonly successorOperatorId: string;
  readonly approvalId: string;
  readonly confirmation: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly sessionId: string;
}

export interface ChangeOperatorStatusCommand {
  readonly commandId: string;
  readonly targetOperatorId: string;
  readonly action: OperatorLifecycleAction;
  readonly expectedStatus: OperatorLifecycleStatus;
  readonly confirmation: string;
  readonly reason: string;
  readonly correlationId: string;
  /** Bound by middleware to the authenticated session, never read from the body. */
  readonly sessionId: string;
}

export interface OperatorLifecycleResult {
  readonly outcome: "updated";
  readonly operatorId: string;
  readonly status: "active" | "suspended" | "deactivated";
  readonly revokedSessionCount: number;
}
