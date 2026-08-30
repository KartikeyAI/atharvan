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

export interface PlatformAdministrationReader {
  listOperators(): Promise<ReadonlyArray<OperatorDirectoryEntry>>;
  listMembershipDomains(): Promise<ReadonlyArray<MembershipDomainEntry>>;
  listOperatorRoleDefinitions(): Promise<
    ReadonlyArray<OperatorRoleDefinitionEntry>
  >;
  findActiveOperatorRoleDefinition(
    key: string,
  ): Promise<OperatorRoleDefinitionEntry | null>;
}
