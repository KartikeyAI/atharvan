import type {
  OperatorInvitationStatus,
  OperatorLifecycleStatus,
} from "./operator-onboarding";

export interface OperatorRoleSummary {
  readonly definitionId: string;
  readonly key: string;
  readonly name: string;
  readonly version: number;
}

export interface OperatorRoleDefinitionEntry extends OperatorRoleSummary {
  readonly description: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly isActive: boolean;
  readonly isSystem: boolean;
}

export interface OperatorDirectoryEntry {
  readonly id: string;
  readonly email: string;
  readonly emailDomain: string;
  readonly status: OperatorLifecycleStatus;
  readonly isSuperAdministrator: boolean;
  readonly effectiveCapabilities: ReadonlyArray<string>;
  readonly assignedRoles: ReadonlyArray<OperatorRoleSummary>;
  readonly invitationStatus: OperatorInvitationStatus | null;
  readonly invitedAt: string;
  readonly activatedAt: string | null;
}

export interface MembershipDomainEntry {
  readonly id: string;
  readonly domain: string;
  readonly includeSubdomains: boolean;
  readonly isActive: boolean;
  readonly reason: string;
  readonly createdAt: string;
  readonly disabledAt: string | null;
}

export type OperatorBreakGlassGrantStatus = "active" | "expired" | "revoked";

export type OperatorBreakGlassReviewOutcome = "approved" | "concerns";

export interface OperatorBreakGlassReviewEntry {
  readonly id: string;
  readonly reviewerOperatorId: string;
  readonly reviewerEmail: string;
  readonly outcome: OperatorBreakGlassReviewOutcome;
  readonly summary: string;
  readonly reviewedAt: string;
}

export interface OperatorBreakGlassGrantEntry {
  readonly id: string;
  readonly operatorId: string;
  readonly operatorEmail: string;
  readonly capabilities: ReadonlyArray<string>;
  readonly reason: string;
  readonly incidentReference: string;
  readonly approvalReference: string;
  readonly grantedByOperatorId: string;
  readonly grantedByEmail: string;
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedByOperatorId: string | null;
  readonly revokedReason: string | null;
  readonly status: OperatorBreakGlassGrantStatus;
  readonly review: OperatorBreakGlassReviewEntry | null;
}

export interface PlatformAdministrationReader {
  listOperators(): Promise<ReadonlyArray<OperatorDirectoryEntry>>;
  listMembershipDomains(): Promise<ReadonlyArray<MembershipDomainEntry>>;
  listOperatorRoleDefinitions(): Promise<
    ReadonlyArray<OperatorRoleDefinitionEntry>
  >;
  listOperatorBreakGlassGrants(): Promise<
    ReadonlyArray<OperatorBreakGlassGrantEntry>
  >;
  findActiveOperatorRoleDefinition(
    key: string,
  ): Promise<OperatorRoleDefinitionEntry | null>;
}
