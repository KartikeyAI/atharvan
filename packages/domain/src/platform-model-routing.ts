import type { PlatformConfigurationEnvironment } from "./platform-configuration";
import type {
  ModelCapability,
  ModelCatalogueLifecycle,
  ModelDataClassification,
  ModelProviderAdapterKind,
  ModelProviderHealthState,
} from "./platform-models";

export type ModelRoutingControlState = "enabled" | "maintenance" | "disabled";

export type ModelRoutingControlTargetKind = "provider" | "model";

export type ModelRoutingEffectiveControlState =
  ModelRoutingControlState | "unconfigured";

export interface ModelRoutingPolicyTarget {
  readonly id: string;
  readonly modelId: string;
  readonly modelKey: string;
  readonly modelDisplayName: string;
  readonly providerId: string;
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly priority: number;
  readonly rolloutBasisPoints: number;
  readonly allowDegraded: boolean;
}

export interface ModelRoutingPolicyEntry {
  readonly id: string;
  readonly key: string;
  readonly displayName: string;
  readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly allowedRegions: ReadonlyArray<string>;
  readonly revisionNumber: number;
  readonly updatedAt: string;
  readonly targets: ReadonlyArray<ModelRoutingPolicyTarget>;
}

export interface ModelRoutingOperationalControl {
  readonly id: string;
  readonly targetKind: ModelRoutingControlTargetKind;
  readonly targetId: string;
  readonly targetKey: string;
  readonly targetDisplayName: string;
  readonly providerId: string;
  readonly providerKey: string;
  readonly configuredState: ModelRoutingControlState;
  readonly effectiveState: ModelRoutingEffectiveControlState;
  readonly maintenanceExpiresAt: string | null;
  readonly revisionNumber: number;
  readonly updatedAt: string;
}

export interface ModelRoutingOperations {
  readonly environment: PlatformConfigurationEnvironment;
  readonly policies: ReadonlyArray<ModelRoutingPolicyEntry>;
  readonly controls: ReadonlyArray<ModelRoutingOperationalControl>;
}

export interface ModelRoutingResolutionCandidate {
  readonly targetId: string;
  readonly modelId: string;
  readonly modelKey: string;
  readonly modelDisplayName: string;
  readonly providerId: string;
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly priority: number;
  readonly rolloutBasisPoints: number;
  readonly allowDegraded: boolean;
  readonly modelCapabilities: ReadonlyArray<ModelCapability>;
  readonly modelRegions: ReadonlyArray<string>;
  readonly modelMaximumDataClassification: ModelDataClassification;
  readonly modelLifecycle: ModelCatalogueLifecycle;
  readonly providerRegions: ReadonlyArray<string>;
  readonly providerMaximumDataClassification: ModelDataClassification;
  readonly providerLifecycle: ModelCatalogueLifecycle;
  readonly providerAdapterKind: ModelProviderAdapterKind;
  readonly providerCredentialActive: boolean;
  readonly providerHealthState: ModelProviderHealthState;
  readonly providerControlState: ModelRoutingEffectiveControlState;
  readonly modelControlState: ModelRoutingEffectiveControlState;
}

export interface ModelRoutingResolutionSnapshot {
  readonly policyId: string;
  readonly policyKey: string;
  readonly policyRevisionId: string;
  readonly policyRevisionNumber: number;
  readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly allowedRegions: ReadonlyArray<string>;
  readonly candidates: ReadonlyArray<ModelRoutingResolutionCandidate>;
}

export type ModelRoutingRejectionReason =
  | "outside_rollout"
  | "provider_not_active"
  | "model_not_active"
  | "provider_control_unconfigured"
  | "model_control_unconfigured"
  | "provider_maintenance"
  | "model_maintenance"
  | "provider_disabled"
  | "model_disabled"
  | "provider_health_unacceptable"
  | "provider_credential_unavailable"
  | "capability_incompatible"
  | "region_incompatible"
  | "data_classification_incompatible";

export interface ModelRoutingCandidateEvaluation {
  readonly targetId: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly priority: number;
  readonly rolloutBucket: number;
  readonly accepted: boolean;
  readonly reason: ModelRoutingRejectionReason | null;
}

export type ModelRoutingDecision =
  | {
      readonly outcome: "selected";
      readonly policyId: string;
      readonly policyKey: string;
      readonly policyRevisionNumber: number;
      readonly providerId: string;
      readonly providerKey: string;
      readonly modelId: string;
      readonly modelKey: string;
      readonly evaluations: ReadonlyArray<ModelRoutingCandidateEvaluation>;
    }
  | {
      readonly outcome: "unavailable";
      readonly reason:
        | "policy_not_found"
        | "request_policy_incompatible"
        | "no_eligible_target";
      readonly policyId: string | null;
      readonly policyKey: string;
      readonly policyRevisionNumber: number | null;
      readonly evaluations: ReadonlyArray<ModelRoutingCandidateEvaluation>;
    };
