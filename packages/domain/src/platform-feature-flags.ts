import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type PlatformFeatureFlagLifecycle = "draft" | "active" | "archived";

export type PlatformFeatureFlagFreshness = "current" | "review_due" | "expired";

export interface PlatformFeatureFlagRule {
  readonly id: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly planKeys: ReadonlyArray<string>;
  readonly workspaceIds: ReadonlyArray<string>;
  readonly userIds: ReadonlyArray<string>;
  readonly regions: ReadonlyArray<string>;
  readonly cohorts: ReadonlyArray<string>;
  readonly internalStaff: boolean | null;
  readonly minimumAccountAgeDays: number | null;
  readonly maximumAccountAgeDays: number | null;
  readonly rolloutBasisPoints: number;
}

export interface PlatformFeatureFlagRevisionEntry {
  readonly revisionNumber: number;
  readonly displayName: string;
  readonly purpose: string;
  readonly ownerOperatorId: string;
  readonly ownerEmail: string;
  readonly lifecycle: PlatformFeatureFlagLifecycle;
  readonly defaultEnabled: boolean;
  readonly emergencyDisabled: boolean;
  readonly rules: ReadonlyArray<PlatformFeatureFlagRule>;
  readonly reviewAt: string;
  readonly expiresAt: string | null;
  readonly reason: string;
  readonly correlationId: string;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
}

export interface PlatformFeatureFlagEntry {
  readonly id: string;
  readonly key: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly freshness: PlatformFeatureFlagFreshness;
  readonly current: PlatformFeatureFlagRevisionEntry;
  readonly recentRevisions: ReadonlyArray<PlatformFeatureFlagRevisionEntry>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlatformFeatureFlagRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly items: ReadonlyArray<PlatformFeatureFlagEntry>;
}

export interface PlatformFeatureFlagEvaluationContext {
  readonly stableRoutingKey: string;
  readonly planKey?: string;
  readonly workspaceId?: string;
  readonly userId?: string;
  readonly region?: string;
  readonly cohorts?: ReadonlyArray<string>;
  readonly internalStaff?: boolean;
  readonly accountAgeDays?: number;
}

export type PlatformFeatureFlagEvaluationReason =
  | "flag_not_found"
  | "flag_not_active"
  | "flag_expired"
  | "emergency_disabled"
  | "targeting_rule"
  | "default";

export interface PlatformFeatureFlagEvaluation {
  readonly key: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly enabled: boolean;
  readonly reason: PlatformFeatureFlagEvaluationReason;
  readonly revisionNumber: number | null;
  readonly matchedRuleId: string | null;
  readonly rolloutBucket: number | null;
  readonly evaluatedAt: string;
}
