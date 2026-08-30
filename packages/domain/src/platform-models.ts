import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type ModelProviderAdapterKind =
  | "openai"
  | "anthropic"
  | "google"
  | "azure_openai"
  | "openai_compatible"
  | "self_hosted";

export type ModelCatalogueLifecycle = "draft" | "active" | "deprecated";

export type ModelDataClassification =
  "public" | "internal" | "confidential" | "restricted";

export type ModelKind = "generation" | "embedding";

export type ModelCapability =
  | "text_generation"
  | "code_generation"
  | "reasoning"
  | "vision"
  | "tool_use"
  | "structured_output"
  | "embeddings";

export type ModelProviderReportedHealth =
  "healthy" | "degraded" | "unavailable";

export type ModelProviderHealthState =
  ModelProviderReportedHealth | "unknown" | "stale";

export interface ModelProviderHealthObservation {
  readonly id: string;
  readonly state: ModelProviderHealthState;
  readonly reportedStatus: ModelProviderReportedHealth | null;
  readonly source: "operator_probe" | null;
  readonly latencyMs: number | null;
  readonly httpStatusCode: number | null;
  readonly errorCode: string | null;
  readonly observedAt: string | null;
  readonly expiresAt: string | null;
}

export interface ModelCatalogueEntry {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly kind: ModelKind;
  readonly capabilities: ReadonlyArray<ModelCapability>;
  readonly contextWindowTokens: number;
  readonly maximumOutputTokens: number | null;
  readonly inputPriceMicrounitsPerMillion: number;
  readonly outputPriceMicrounitsPerMillion: number;
  readonly currency: "USD";
  readonly regions: ReadonlyArray<string>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly lifecycle: ModelCatalogueLifecycle;
  readonly revisionNumber: number;
  readonly updatedAt: string;
}

export interface ModelProviderCatalogueEntry {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly adapterKind: ModelProviderAdapterKind;
  readonly baseUrl: string | null;
  readonly credentialReferenceId: string | null;
  readonly credentialReferenceKey: string | null;
  readonly regions: ReadonlyArray<string>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly lifecycle: ModelCatalogueLifecycle;
  readonly revisionNumber: number;
  readonly updatedAt: string;
  readonly health: ModelProviderHealthObservation;
  readonly models: ReadonlyArray<ModelCatalogueEntry>;
}

export interface ModelProviderCatalogue {
  readonly environment: PlatformConfigurationEnvironment;
  readonly items: ReadonlyArray<ModelProviderCatalogueEntry>;
}
