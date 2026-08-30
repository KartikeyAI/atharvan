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
  readonly ownerUserId: string | null;
  readonly createdAt: string;
  readonly observedAt: string;
  readonly sourceRevision: string;
}

export type CustomerOperationsTargetType = "user" | "workspace";

export type CustomerInternalNoteCategory =
  "support" | "operations" | "billing" | "security";

export interface CustomerInternalNote {
  readonly id: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly targetType: CustomerOperationsTargetType;
  readonly targetId: string;
  readonly category: CustomerInternalNoteCategory;
  readonly body: string;
  readonly reason: string;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
}

export type CustomerRiskCategory =
  "security" | "abuse" | "billing" | "identity" | "support";

export type CustomerRiskSeverity = "low" | "medium" | "high" | "critical";
export type CustomerRiskState = "active" | "resolved";

export interface CustomerRiskMarker {
  readonly id: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly targetType: CustomerOperationsTargetType;
  readonly targetId: string;
  readonly revisionNumber: number;
  readonly category: CustomerRiskCategory;
  readonly severity: CustomerRiskSeverity;
  readonly state: CustomerRiskState;
  readonly summary: string;
  readonly reason: string;
  readonly changedByOperatorId: string;
  readonly changedAt: string;
}

export type CustomerOwnershipTransferObservedState = "observed" | "failed";
export type CustomerOwnershipTransferReconciliationState =
  "pending" | "applied" | "drifted" | "failed";

export interface CustomerWorkspaceOwnershipTransfer {
  readonly id: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly workspaceId: string;
  readonly revisionNumber: number;
  readonly currentOwnerUserId: string;
  readonly successorUserId: string;
  readonly approvalReference: string;
  readonly reason: string;
  readonly requestedByOperatorId: string;
  readonly requestedAt: string;
  readonly reconciliationState: CustomerOwnershipTransferReconciliationState;
  readonly observedState: CustomerOwnershipTransferObservedState | null;
  readonly observedOwnerUserId: string | null;
  readonly observedSourceRevision: string | null;
  readonly observedAt: string | null;
  readonly reconciliationMessage: string | null;
}

export interface CustomerOperationsContext {
  readonly notes: ReadonlyArray<CustomerInternalNote>;
  readonly riskMarkers: ReadonlyArray<CustomerRiskMarker>;
  readonly ownershipTransfers: ReadonlyArray<CustomerWorkspaceOwnershipTransfer>;
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
  readonly operations: CustomerOperationsContext;
}

export interface CustomerWorkspaceInspection {
  readonly entityType: "workspace";
  readonly status: CustomerDirectoryStatus;
  readonly workspace: CustomerWorkspaceSummary;
  readonly memberships: ReadonlyArray<{
    readonly membership: CustomerWorkspaceMembership;
    readonly user: CustomerUserSummary;
  }>;
  readonly operations: CustomerOperationsContext;
}

export type CustomerDirectoryInspection =
  CustomerUserInspection | CustomerWorkspaceInspection;

export type CustomerRestrictionTargetType = "user" | "workspace";

export type CustomerRestrictionCapability =
  | "login"
  | "new_executions"
  | "provider_mutations"
  | "production_deployments"
  | "integrations"
  | "runner_access"
  | "all_access";

export type CustomerRestrictionDesiredState = "restricted" | "restored";

export type CustomerRestrictionObservedState =
  "restricted" | "restored" | "failed";

export type CustomerRestrictionReconciliationState =
  "pending" | "applied" | "drifted" | "failed";

export interface CustomerRestrictionEntry {
  readonly id: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly targetType: CustomerRestrictionTargetType;
  readonly targetId: string;
  readonly capability: CustomerRestrictionCapability;
  readonly revisionNumber: number;
  readonly desiredState: CustomerRestrictionDesiredState;
  readonly reconciliationState: CustomerRestrictionReconciliationState;
  readonly reason: string;
  readonly requestedByOperatorId: string;
  readonly requestedAt: string;
  readonly observedState: CustomerRestrictionObservedState | null;
  readonly observedSourceRevision: string | null;
  readonly observedAt: string | null;
  readonly reconciliationMessage: string | null;
}

export interface CustomerRestrictionRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly targetType: CustomerRestrictionTargetType;
  readonly targetId: string;
  readonly items: ReadonlyArray<CustomerRestrictionEntry>;
}
