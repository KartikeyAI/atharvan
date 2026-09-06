/** Only explicit, non-secret command shapes may enter the approval registry. */
export type PlatformApprovalScope =
  | {
      readonly kind: "platform_ownership_transfer";
      readonly currentOwnerOperatorId: string;
      readonly successorOperatorId: string;
    }
  | {
      readonly kind: "workspace_ownership_transfer";
      readonly workspaceId: string;
      readonly expectedOwnerUserId: string;
      readonly sourceRevision: string;
      readonly successorUserId: string;
    }
  | {
      readonly kind: "operator_break_glass";
      readonly targetOperatorId: string;
      readonly capabilities: readonly string[];
      readonly durationMinutes: number;
      readonly incidentReference: string;
    };

export type PlatformApprovalStatus =
  "pending" | "approved" | "rejected" | "revoked" | "consumed" | "expired";

export interface PlatformApprovalEntry {
  readonly id: string;
  readonly requesterId: string;
  readonly requesterEmail: string;
  readonly scope: PlatformApprovalScope;
  readonly status: PlatformApprovalStatus;
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly decidedAt: string | null;
  readonly consumedAt: string | null;
  readonly allowedDecisions: readonly ("approved" | "rejected" | "revoked")[];
}

export interface PlatformApprovalPage {
  readonly items: readonly PlatformApprovalEntry[];
  readonly truncated: boolean;
}
