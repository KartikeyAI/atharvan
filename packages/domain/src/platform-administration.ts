import type {
  OperatorInvitationStatus,
  OperatorLifecycleStatus,
} from "./operator-onboarding";

export const delegablePlatformCapabilities = [
  "platform:overview:read",
  "platform:operators:read",
  "platform:operators:invite",
  "platform:membership-domains:read",
] as const;

export type DelegablePlatformCapability =
  (typeof delegablePlatformCapabilities)[number];

export interface OperatorDirectoryEntry {
  readonly id: string;
  readonly email: string;
  readonly emailDomain: string;
  readonly status: OperatorLifecycleStatus;
  readonly isSuperAdministrator: boolean;
  readonly effectiveCapabilities: ReadonlyArray<string>;
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
}
