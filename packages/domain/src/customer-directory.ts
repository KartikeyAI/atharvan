import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type CustomerDirectoryFreshness = "unknown" | "current" | "stale";

export type CustomerUserLifecycle =
  "active" | "restricted" | "suspended" | "deactivated";

export type CustomerVerificationStatus = "unverified" | "pending" | "verified";

export type CustomerWorkspaceLifecycle =
  "active" | "restricted" | "suspended" | "archived";

export type CustomerMembershipLifecycle =
  "invited" | "active" | "suspended" | "removed";

export interface CustomerDirectoryStatus {
  readonly environment: PlatformConfigurationEnvironment;
  readonly source: "arth";
  readonly freshness: CustomerDirectoryFreshness;
  readonly sourceRevision: string | null;
  readonly observedAt: string | null;
  readonly synchronizedAt: string | null;
}

export interface CustomerUserSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly lifecycle: CustomerUserLifecycle;
  readonly verificationStatus: CustomerVerificationStatus;
  readonly createdAt: string;
  readonly observedAt: string;
  readonly sourceRevision: string;
}

export interface CustomerWorkspaceSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string | null;
  readonly lifecycle: CustomerWorkspaceLifecycle;
  readonly createdAt: string;
  readonly observedAt: string;
  readonly sourceRevision: string;
}

export interface CustomerWorkspaceMembership {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: string;
  readonly lifecycle: CustomerMembershipLifecycle;
  readonly grantedPermissions: ReadonlyArray<string>;
  readonly deniedPermissions: ReadonlyArray<string>;
  readonly effectivePermissions: ReadonlyArray<string>;
  readonly observedAt: string;
  readonly sourceRevision: string;
}

export interface CustomerDirectorySearchResult {
  readonly status: CustomerDirectoryStatus;
  readonly queryFingerprint: string;
  readonly users: ReadonlyArray<CustomerUserSummary>;
  readonly workspaces: ReadonlyArray<CustomerWorkspaceSummary>;
}

export interface CustomerUserInspection {
  readonly entityType: "user";
  readonly status: CustomerDirectoryStatus;
  readonly user: CustomerUserSummary;
  readonly memberships: ReadonlyArray<{
    readonly membership: CustomerWorkspaceMembership;
    readonly workspace: CustomerWorkspaceSummary;
  }>;
}

export interface CustomerWorkspaceInspection {
  readonly entityType: "workspace";
  readonly status: CustomerDirectoryStatus;
  readonly workspace: CustomerWorkspaceSummary;
  readonly memberships: ReadonlyArray<{
    readonly membership: CustomerWorkspaceMembership;
    readonly user: CustomerUserSummary;
  }>;
}

export type CustomerDirectoryInspection =
  CustomerUserInspection | CustomerWorkspaceInspection;
