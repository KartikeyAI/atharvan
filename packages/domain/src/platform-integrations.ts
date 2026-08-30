import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type PlatformIntegrationProtocol =
  "oauth2" | "api_key" | "service_account" | "webhook";

export type PlatformIntegrationConnectionMode =
  "direct" | "managed" | "claimable";

export type PlatformIntegrationLifecycle = "draft" | "active" | "deprecated";

export type PlatformIntegrationOperationalState =
  "enabled" | "maintenance" | "disabled";

export type PlatformIntegrationCapability =
  | "source_control"
  | "deployment"
  | "database"
  | "authentication"
  | "observability"
  | "billing"
  | "notifications"
  | "design";

export type PlatformIntegrationReportedHealth =
  "healthy" | "degraded" | "unavailable";

export type PlatformIntegrationHealthState =
  PlatformIntegrationReportedHealth | "unknown" | "stale";

export interface PlatformIntegrationHealthObservation {
  readonly id: string;
  readonly state: PlatformIntegrationHealthState;
  readonly reportedStatus: PlatformIntegrationReportedHealth | null;
  readonly source: "operator_probe" | null;
  readonly latencyMs: number | null;
  readonly httpStatusCode: number | null;
  readonly errorCode: string | null;
  readonly observedAt: string | null;
  readonly expiresAt: string | null;
}

export interface PlatformIntegrationRegistryEntry {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly protocol: PlatformIntegrationProtocol;
  readonly connectionMode: PlatformIntegrationConnectionMode;
  readonly capabilities: ReadonlyArray<PlatformIntegrationCapability>;
  readonly adapterPackage: string;
  readonly adapterVersion: string;
  readonly documentationUrl: string | null;
  readonly authorizationUrl: string | null;
  readonly tokenUrl: string | null;
  readonly clientId: string | null;
  readonly clientSecretReferenceId: string | null;
  readonly clientSecretReferenceKey: string | null;
  readonly webhookSecretReferenceId: string | null;
  readonly webhookSecretReferenceKey: string | null;
  readonly callbackUrls: ReadonlyArray<string>;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly optionalScopes: ReadonlyArray<string>;
  readonly lifecycle: PlatformIntegrationLifecycle;
  readonly operationalState: PlatformIntegrationOperationalState;
  readonly maintenanceExpiresAt: string | null;
  readonly effectiveOperationalState: "enabled" | "disabled";
  readonly revisionNumber: number;
  readonly updatedAt: string;
  readonly health: PlatformIntegrationHealthObservation;
}

export interface PlatformIntegrationRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly items: ReadonlyArray<PlatformIntegrationRegistryEntry>;
}
