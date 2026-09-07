import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type EntitlementValueType = "boolean" | "quantity";
export type EntitlementOveragePolicy = "denied" | "metered" | "contract";
export type EntitlementSourceKind = "plan" | "enterprise_grant";
export type EnterpriseEntitlementGrantLifecycle = "active" | "revoked";
export type EnterpriseEntitlementGrantStatus =
  "scheduled" | "active" | "expired" | "revoked";
export type EntitlementReconciliationState = "pending" | "applied" | "failed";

export type EntitlementValue =
  | {
      readonly key: string;
      readonly valueType: "boolean";
      readonly enabled: boolean;
      readonly limit: null;
      readonly unit: null;
      readonly overagePolicy: "denied";
    }
  | {
      readonly key: string;
      readonly valueType: "quantity";
      readonly enabled: null;
      readonly limit: number | null;
      readonly unit: string;
      readonly overagePolicy: EntitlementOveragePolicy;
    };

export interface PlanEntitlementSet {
  readonly id: string;
  readonly planVersionId: string;
  readonly values: ReadonlyArray<EntitlementValue>;
  readonly reason: string;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
}

export type WorkspaceEntitlementLayer = EntitlementValue & {
  readonly sourceKind: EntitlementSourceKind;
  readonly sourceId: string;
  readonly startsAt: string;
  readonly expiresAt: string | null;
};

export type EffectiveWorkspaceEntitlement = EntitlementValue & {
  readonly sourceKind: EntitlementSourceKind;
  readonly sourceId: string;
  readonly expiresAt: string | null;
};

export interface WorkspaceEntitlementSnapshot {
  readonly id: string;
  readonly revisionNumber: number;
  readonly planVersionId: string;
  readonly planKey: string;
  readonly planVersionNumber: number;
  readonly layers: ReadonlyArray<WorkspaceEntitlementLayer>;
  readonly effective: ReadonlyArray<EffectiveWorkspaceEntitlement>;
  readonly reason: string;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
  readonly reconciliationState: EntitlementReconciliationState;
  readonly observedSourceRevision: string | null;
  readonly observedAt: string | null;
  readonly reconciliationMessage: string | null;
}

export interface EnterpriseEntitlementGrant {
  readonly id: string;
  readonly key: string;
  readonly revisionNumber: number;
  readonly value: EntitlementValue;
  readonly lifecycle: EnterpriseEntitlementGrantLifecycle;
  readonly status: EnterpriseEntitlementGrantStatus;
  readonly contractReference: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly createdByOperatorId: string;
  readonly changedAt: string;
}

export interface WorkspaceEntitlementRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceLifecycle: string;
  readonly current: WorkspaceEntitlementSnapshot | null;
  readonly grants: ReadonlyArray<EnterpriseEntitlementGrant>;
  readonly history: ReadonlyArray<WorkspaceEntitlementSnapshot>;
  readonly historyTruncated: boolean;
}
