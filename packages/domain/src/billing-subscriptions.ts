import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type BillingProvider = "stripe";

export type BillingCheckoutState =
  "pending" | "ready" | "completed" | "expired" | "failed";

export type BillingSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type BillingReconciliationState = "matched" | "drift" | "failed";

export interface BillingCheckoutRequestEntry {
  readonly id: string;
  readonly planVersionId: string;
  readonly planDisplayName: string;
  readonly provider: BillingProvider;
  readonly state: BillingCheckoutState;
  readonly checkoutUrl: string | null;
  readonly expiresAt: string | null;
  readonly failures: number;
  readonly lastErrorCode: string | null;
  readonly requestedByOperatorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BillingSubscriptionRevision {
  readonly id: string;
  readonly revisionNumber: number;
  readonly planVersionId: string;
  readonly planDisplayName: string;
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly status: BillingSubscriptionStatus;
  readonly quantity: number;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly trialEnd: string | null;
  readonly providerCreatedAt: string;
  readonly observedAt: string;
}

export interface BillingSubscriptionObservation {
  readonly id: string;
  readonly subscriptionRevisionNumber: number;
  readonly state: BillingReconciliationState;
  readonly reasonCode: string | null;
  readonly providerRequestId: string | null;
  readonly observedAt: string;
  readonly createdAt: string;
}

export interface WorkspaceBillingSubscription {
  readonly id: string;
  readonly provider: BillingProvider;
  readonly current: BillingSubscriptionRevision;
  readonly history: ReadonlyArray<BillingSubscriptionRevision>;
  readonly historyTruncated: boolean;
  readonly reconciliationState: "pending" | BillingReconciliationState;
  readonly reconciliationReasonCode: string | null;
  readonly lastReconciledAt: string | null;
  readonly nextReconciliationAt: string | null;
  readonly observations: ReadonlyArray<BillingSubscriptionObservation>;
  readonly observationsTruncated: boolean;
}

export interface WorkspaceBillingRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly provider: BillingProvider;
  readonly providerConfigured: boolean;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceLifecycle:
    "active" | "restricted" | "suspended" | "archived";
  readonly checkoutRequests: ReadonlyArray<BillingCheckoutRequestEntry>;
  readonly checkoutRequestsTruncated: boolean;
  readonly subscription: WorkspaceBillingSubscription | null;
}
