import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type CommercialLifecycle = "draft" | "active" | "retired";
export type CommercialPlanAudience = "public" | "private" | "grandfathered";
export type CommercialPricingModel = "free" | "fixed" | "contract";
export type CommercialBillingInterval = "month" | "year" | null;
export type CommercialTaxBehavior = "exclusive" | "inclusive" | "unspecified";

export interface CommercialPlanVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly displayName: string;
  readonly description: string;
  readonly audience: CommercialPlanAudience;
  readonly pricingModel: CommercialPricingModel;
  readonly billingInterval: CommercialBillingInterval;
  readonly currency: string;
  readonly amountMinor: number;
  readonly taxBehavior: CommercialTaxBehavior;
  readonly trialDays: number;
  readonly providerPriceReference: string | null;
  readonly lifecycle: CommercialLifecycle;
  readonly effectiveFrom: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface CommercialPlanEntry {
  readonly id: string;
  readonly key: string;
  readonly currentVersionNumber: number;
  readonly updatedAt: string;
  readonly current: CommercialPlanVersion;
  readonly versions: ReadonlyArray<CommercialPlanVersion>;
  readonly historyTruncated: boolean;
}

export interface CommercialProductEntry {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly lifecycle: CommercialLifecycle;
  readonly revisionNumber: number;
  readonly updatedAt: string;
  readonly plans: ReadonlyArray<CommercialPlanEntry>;
}

export interface CommercialCatalogue {
  readonly environment: PlatformConfigurationEnvironment;
  readonly items: ReadonlyArray<CommercialProductEntry>;
  readonly truncated: boolean;
}
