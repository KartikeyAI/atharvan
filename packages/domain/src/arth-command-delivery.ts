import type { PlatformConfigurationEnvironment } from "./platform-configuration";

export type ArthCommandKind =
  | "customer_restriction"
  | "workspace_ownership_transfer"
  | "model_routing_control"
  | "platform_integration_control"
  | "platform_adapter_release_control";

export type ArthCommandDeliveryState =
  "pending" | "leased" | "applied" | "rejected" | "dead_letter";

export interface CustomerRestrictionArthCommand {
  readonly kind: "customer_restriction";
  readonly restrictionId: string;
  readonly revisionNumber: number;
  readonly targetType: "user" | "workspace";
  readonly targetId: string;
  readonly capability:
    | "login"
    | "new_executions"
    | "provider_mutations"
    | "production_deployments"
    | "integrations"
    | "runner_access"
    | "all_access";
  readonly desiredState: "restricted" | "restored";
  readonly requestedAt: string;
}

export interface WorkspaceOwnershipArthCommand {
  readonly kind: "workspace_ownership_transfer";
  readonly transferId: string;
  readonly revisionNumber: number;
  readonly workspaceId: string;
  readonly currentOwnerUserId: string;
  readonly successorUserId: string;
  readonly requestedAt: string;
}

export interface ModelRoutingControlArthCommand {
  readonly kind: "model_routing_control";
  readonly controlId: string;
  readonly revisionNumber: number;
  readonly targetKind: "provider" | "model";
  readonly targetId: string;
  readonly providerKey: string;
  readonly targetKey: string;
  readonly state: "enabled" | "maintenance" | "disabled";
  readonly maintenanceExpiresAt: string | null;
  readonly requestedAt: string;
}

export interface PlatformIntegrationControlArthCommand {
  readonly kind: "platform_integration_control";
  readonly integrationId: string;
  readonly integrationKey: string;
  readonly revisionNumber: number;
  readonly lifecycle: "draft" | "active" | "deprecated";
  readonly operationalState: "enabled" | "maintenance" | "disabled";
  readonly maintenanceExpiresAt: string | null;
  readonly requestedAt: string;
}

export interface PlatformAdapterReleaseControlArthCommand {
  readonly kind: "platform_adapter_release_control";
  readonly releaseId: string;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly revisionNumber: number;
  readonly lifecycle: "draft" | "active" | "blocked" | "deprecated";
  readonly releaseChannel: "internal" | "canary" | "beta" | "stable";
  readonly signatureStatus: "unverified" | "verified" | "invalid";
  readonly securityReviewStatus:
    "pending" | "approved" | "changes_required" | "rejected";
  readonly requestedAt: string;
}

export type ArthCommandPayload =
  | CustomerRestrictionArthCommand
  | WorkspaceOwnershipArthCommand
  | ModelRoutingControlArthCommand
  | PlatformIntegrationControlArthCommand
  | PlatformAdapterReleaseControlArthCommand;

export interface LeasedArthCommand {
  readonly commandId: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly payload: ArthCommandPayload;
  readonly payloadSha256: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly attempt: number;
}

export interface ArthCommandAcknowledgement {
  readonly commandId: string;
  readonly leaseToken: string;
  readonly outcome: "applied" | "rejected" | "retryable_failure";
  readonly sourceRevision: string;
  readonly observedAt: string;
  readonly message?: string | null;
}
