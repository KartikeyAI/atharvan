import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type PlatformAdapterCategory =
  | "language"
  | "framework"
  | "package_manager"
  | "build"
  | "test"
  | "database"
  | "deployment"
  | "cloud"
  | "source_control"
  | "observability"
  | "security"
  | "model"
  | "design_system"
  | "private_enterprise";

export type PlatformAdapterCapabilityName =
  | "detect"
  | "understand"
  | "modify"
  | "validate"
  | "preview"
  | "deploy"
  | "operate"
  | "migrate";

export type PlatformAdapterCapabilityMaturity =
  "unsupported" | "experimental" | "alpha" | "beta" | "stable" | "deprecated";

export type PlatformAdapterLifecycle =
  "draft" | "active" | "deprecated" | "blocked";

export type PlatformAdapterReleaseChannel =
  "internal" | "canary" | "beta" | "stable";

export type PlatformAdapterSignatureStatus =
  "unverified" | "verified" | "invalid";

export type PlatformAdapterSecurityReviewStatus =
  "pending" | "approved" | "changes_required" | "rejected";

export interface PlatformAdapterCapabilityDeclaration {
  readonly name: PlatformAdapterCapabilityName;
  readonly maturity: PlatformAdapterCapabilityMaturity;
}

export type PlatformAdapterConfigurationFieldType =
  "string" | "boolean" | "integer" | "string_list" | "secret_reference";

export interface PlatformAdapterConfigurationField {
  readonly key: string;
  readonly label: string;
  readonly type: PlatformAdapterConfigurationFieldType;
  readonly required: boolean;
}

export type PlatformAdapterCommandRisk = "read" | "write" | "destructive";

export interface PlatformAdapterCommandDeclaration {
  readonly key: string;
  readonly description: string;
  readonly risk: PlatformAdapterCommandRisk;
}

export interface PlatformAdapterHealthCheckDeclaration {
  readonly key: string;
  readonly command: string;
  readonly timeoutSeconds: number;
}

export interface PlatformAdapterReleaseEntry {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly category: PlatformAdapterCategory;
  readonly packageName: string;
  readonly version: string;
  readonly packageDigestSha256: string;
  readonly documentationUrl: string | null;
  readonly capabilities: ReadonlyArray<PlatformAdapterCapabilityDeclaration>;
  readonly declaredPermissions: ReadonlyArray<string>;
  readonly configurationFields: ReadonlyArray<PlatformAdapterConfigurationField>;
  readonly commands: ReadonlyArray<PlatformAdapterCommandDeclaration>;
  readonly supportedEnvironments: ReadonlyArray<string>;
  readonly compatibilityTags: ReadonlyArray<string>;
  readonly requiredSecretPurposes: ReadonlyArray<string>;
  readonly healthChecks: ReadonlyArray<PlatformAdapterHealthCheckDeclaration>;
  readonly releaseChannel: PlatformAdapterReleaseChannel;
  readonly signatureStatus: PlatformAdapterSignatureStatus;
  readonly securityReviewStatus: PlatformAdapterSecurityReviewStatus;
  readonly securityReviewReference: string | null;
  readonly lifecycle: PlatformAdapterLifecycle;
  readonly blockReason: string | null;
  readonly deprecatedAt: string | null;
  readonly sunsetAt: string | null;
  readonly revisionNumber: number;
  readonly updatedAt: string;
}

export interface PlatformAdapterRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly items: ReadonlyArray<PlatformAdapterReleaseEntry>;
}
