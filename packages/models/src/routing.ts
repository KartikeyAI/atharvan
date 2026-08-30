import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type ModelCapability,
  type ModelDataClassification,
  type ModelRoutingControlState,
  type ModelRoutingControlTargetKind,
  type ModelRoutingDecision,
  type ModelRoutingOperations,
  type ModelRoutingRejectionReason,
  type ModelRoutingResolutionCandidate,
  type ModelRoutingResolutionSnapshot,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";

const capabilities = new Set<ModelCapability>([
  "text_generation",
  "code_generation",
  "reasoning",
  "vision",
  "tool_use",
  "structured_output",
  "embeddings",
]);
const dataClassifications = new Set<ModelDataClassification>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const controlStates = new Set<ModelRoutingControlState>([
  "enabled",
  "maintenance",
  "disabled",
]);
const targetKinds = new Set<ModelRoutingControlTargetKind>([
  "provider",
  "model",
]);
const classificationRank: Readonly<Record<ModelDataClassification, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

export type ModelRoutingCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface ModelRoutingStore {
  listOperations(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly now: Date;
  }): Promise<ModelRoutingOperations>;
  setPolicy(input: {
    readonly actorId: string;
    readonly policyId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly key: string;
    readonly displayName: string;
    readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
    readonly maximumDataClassification: ModelDataClassification;
    readonly allowedRegions: ReadonlyArray<string>;
    readonly targets: ReadonlyArray<{
      readonly id: string;
      readonly modelId: string;
      readonly priority: number;
      readonly rolloutBasisPoints: number;
      readonly allowDegraded: boolean;
    }>;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<ModelRoutingCommandResult>;
  setControl(input: {
    readonly actorId: string;
    readonly controlId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly targetKind: ModelRoutingControlTargetKind;
    readonly targetId: string;
    readonly state: ModelRoutingControlState;
    readonly maintenanceExpiresAt: Date | null;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<ModelRoutingCommandResult>;
  getResolutionSnapshot(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly policyKey: string;
    readonly now: Date;
  }): Promise<ModelRoutingResolutionSnapshot | null>;
}

export class ModelRoutingCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("model_routing_command_rejected");
  }
}

export function createModelRoutingService(input: {
  readonly store: ModelRoutingStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  function authorize(actor: AuthenticatedOperator, commandTime: Date) {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:models:write",
      requireRecentStepUp: true,
      now: commandTime,
    });
  }

  return {
    listOperations: () =>
      input.store.listOperations({
        environment: input.environment,
        now: now(),
      }),

    async setPolicy(command: {
      readonly actor: AuthenticatedOperator;
      readonly key: string;
      readonly displayName: string;
      readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
      readonly maximumDataClassification: ModelDataClassification;
      readonly allowedRegions: ReadonlyArray<string>;
      readonly targets: ReadonlyArray<{
        readonly modelId: string;
        readonly rolloutBasisPoints: number;
        readonly allowDegraded?: boolean;
      }>;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime);
      const normalizedTargets = requireTargets(command.targets, randomId);
      const result = await input.store.setPolicy({
        actorId: command.actor.operatorId,
        policyId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        key: requirePolicyKey(command.key),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "routing_policy_name_required",
        ),
        requiredCapabilities: requireCapabilities(
          command.requiredCapabilities,
          false,
        ),
        maximumDataClassification: requireOneOf(
          command.maximumDataClassification,
          dataClassifications,
          "data_classification_invalid",
        ),
        allowedRegions: requireRegions(command.allowedRegions),
        targets: normalizedTargets,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      return unwrap(result);
    },

    async setControl(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetKind: ModelRoutingControlTargetKind;
      readonly targetId: string;
      readonly state: ModelRoutingControlState;
      readonly maintenanceExpiresAt?: string | null;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime);
      const state = requireOneOf(
        command.state,
        controlStates,
        "routing_control_state_invalid",
      );
      const maintenanceExpiresAt = requireMaintenanceExpiry(
        state,
        command.maintenanceExpiresAt ?? null,
        commandTime,
      );
      const result = await input.store.setControl({
        actorId: command.actor.operatorId,
        controlId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        targetKind: requireOneOf(
          command.targetKind,
          targetKinds,
          "routing_control_target_invalid",
        ),
        targetId: requireUuid(command.targetId, "routing_target_id_invalid"),
        state,
        maintenanceExpiresAt,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      return unwrap(result);
    },

    async previewRoute(command: {
      readonly policyKey: string;
      readonly stableRoutingKey: string;
      readonly requiredCapabilities?: ReadonlyArray<ModelCapability>;
      readonly dataClassification: ModelDataClassification;
      readonly region: string;
    }): Promise<ModelRoutingDecision> {
      const commandTime = now();
      const policyKey = requirePolicyKey(command.policyKey);
      const stableRoutingKey = requireText(
        command.stableRoutingKey,
        1,
        256,
        "stable_routing_key_invalid",
      );
      const requestedCapabilities = requireCapabilities(
        command.requiredCapabilities ?? [],
        true,
      );
      const dataClassification = requireOneOf(
        command.dataClassification,
        dataClassifications,
        "data_classification_invalid",
      );
      const region = requireRegion(command.region);
      const snapshot = await input.store.getResolutionSnapshot({
        environment: input.environment,
        policyKey,
        now: commandTime,
      });
      if (snapshot === null) {
        return {
          outcome: "unavailable",
          reason: "policy_not_found",
          policyId: null,
          policyKey,
          policyRevisionNumber: null,
          evaluations: [],
        };
      }
      if (
        classificationRank[dataClassification] >
          classificationRank[snapshot.maximumDataClassification] ||
        !regionMatches(snapshot.allowedRegions, region)
      ) {
        return {
          outcome: "unavailable",
          reason: "request_policy_incompatible",
          policyId: snapshot.policyId,
          policyKey,
          policyRevisionNumber: snapshot.policyRevisionNumber,
          evaluations: [],
        };
      }

      const effectiveCapabilities = [
        ...new Set([
          ...snapshot.requiredCapabilities,
          ...requestedCapabilities,
        ]),
      ].sort() as ModelCapability[];
      const evaluations = [];
      for (const candidate of snapshot.candidates) {
        const rolloutBucket = await calculateRolloutBucket(
          snapshot.policyRevisionId,
          candidate.targetId,
          stableRoutingKey,
        );
        const reason = evaluateCandidate({
          candidate,
          rolloutBucket,
          requiredCapabilities: effectiveCapabilities,
          dataClassification,
          region,
        });
        const evaluation = {
          targetId: candidate.targetId,
          modelId: candidate.modelId,
          providerId: candidate.providerId,
          priority: candidate.priority,
          rolloutBucket,
          accepted: reason === null,
          reason,
        };
        evaluations.push(evaluation);
        if (reason === null) {
          return {
            outcome: "selected",
            policyId: snapshot.policyId,
            policyKey,
            policyRevisionNumber: snapshot.policyRevisionNumber,
            providerId: candidate.providerId,
            providerKey: candidate.providerKey,
            modelId: candidate.modelId,
            modelKey: candidate.modelKey,
            evaluations,
          };
        }
      }
      return {
        outcome: "unavailable",
        reason: "no_eligible_target",
        policyId: snapshot.policyId,
        policyKey,
        policyRevisionNumber: snapshot.policyRevisionNumber,
        evaluations,
      };
    },
  };
}

function evaluateCandidate(input: {
  readonly candidate: ModelRoutingResolutionCandidate;
  readonly rolloutBucket: number;
  readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
  readonly dataClassification: ModelDataClassification;
  readonly region: string;
}): ModelRoutingRejectionReason | null {
  const candidate = input.candidate;
  if (candidate.providerLifecycle !== "active") return "provider_not_active";
  if (candidate.modelLifecycle !== "active") return "model_not_active";
  const providerControlReason = controlRejectionReason(
    "provider",
    candidate.providerControlState,
  );
  if (providerControlReason !== null) return providerControlReason;
  const modelControlReason = controlRejectionReason(
    "model",
    candidate.modelControlState,
  );
  if (modelControlReason !== null) return modelControlReason;
  if (
    candidate.providerHealthState !== "healthy" &&
    !(candidate.allowDegraded && candidate.providerHealthState === "degraded")
  ) {
    return "provider_health_unacceptable";
  }
  if (
    candidate.providerAdapterKind !== "self_hosted" &&
    !candidate.providerCredentialActive
  ) {
    return "provider_credential_unavailable";
  }
  if (
    input.requiredCapabilities.some(
      (capability) => !candidate.modelCapabilities.includes(capability),
    )
  ) {
    return "capability_incompatible";
  }
  if (
    !regionMatches(candidate.providerRegions, input.region) ||
    !regionMatches(candidate.modelRegions, input.region)
  ) {
    return "region_incompatible";
  }
  if (
    classificationRank[input.dataClassification] >
      classificationRank[candidate.providerMaximumDataClassification] ||
    classificationRank[input.dataClassification] >
      classificationRank[candidate.modelMaximumDataClassification]
  ) {
    return "data_classification_incompatible";
  }
  if (input.rolloutBucket >= candidate.rolloutBasisPoints) {
    return "outside_rollout";
  }
  return null;
}

function controlRejectionReason(
  targetKind: ModelRoutingControlTargetKind,
  state: ModelRoutingResolutionCandidate[`${ModelRoutingControlTargetKind}ControlState`],
): ModelRoutingRejectionReason | null {
  if (state === "enabled") return null;
  if (state === "unconfigured") return `${targetKind}_control_unconfigured`;
  return `${targetKind}_${state}`;
}

async function calculateRolloutBucket(
  policyRevisionId: string,
  targetId: string,
  stableRoutingKey: string,
) {
  const bytes = new TextEncoder().encode(
    `${policyRevisionId}:${targetId}:${stableRoutingKey}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const value =
    ((digest[0] ?? 0) * 0x1_000000 +
      (digest[1] ?? 0) * 0x1_0000 +
      (digest[2] ?? 0) * 0x100 +
      (digest[3] ?? 0)) >>>
    0;
  return value % 10_000;
}

function requireTargets(
  values: ReadonlyArray<{
    readonly modelId: string;
    readonly rolloutBasisPoints: number;
    readonly allowDegraded?: boolean;
  }>,
  randomId: () => string,
) {
  if (values.length === 0 || values.length > 16) {
    throw new ModelRoutingCommandRejectedError("routing_targets_invalid");
  }
  const modelIds = values.map((target) =>
    requireUuid(target.modelId, "routing_target_model_invalid"),
  );
  if (new Set(modelIds).size !== modelIds.length) {
    throw new ModelRoutingCommandRejectedError("routing_targets_duplicate");
  }
  return values.map((target, index) => ({
    id: randomId(),
    modelId: modelIds[index]!,
    priority: index + 1,
    rolloutBasisPoints: requireInteger(
      target.rolloutBasisPoints,
      1,
      10_000,
      "routing_rollout_invalid",
    ),
    allowDegraded: target.allowDegraded ?? false,
  }));
}

function requireMaintenanceExpiry(
  state: ModelRoutingControlState,
  value: string | null,
  now: Date,
) {
  if (state !== "maintenance") {
    if (value !== null && value.trim() !== "") {
      throw new ModelRoutingCommandRejectedError(
        "maintenance_expiry_forbidden",
      );
    }
    return null;
  }
  if (value === null || value.trim() === "") {
    throw new ModelRoutingCommandRejectedError("maintenance_expiry_required");
  }
  const expiresAt = new Date(value);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= now.getTime() ||
    expiresAt.getTime() > now.getTime() + 90 * 24 * 60 * 60_000
  ) {
    throw new ModelRoutingCommandRejectedError("maintenance_expiry_invalid");
  }
  return expiresAt;
}

function unwrap(result: ModelRoutingCommandResult) {
  if (result.outcome === "rejected") {
    throw new ModelRoutingCommandRejectedError(result.reason);
  }
  return result;
}

function requirePolicyKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(normalized)) {
    throw new ModelRoutingCommandRejectedError("routing_policy_key_invalid");
  }
  return normalized;
}

function requireCapabilities(
  values: ReadonlyArray<ModelCapability>,
  allowEmpty: boolean,
) {
  const normalized = [...new Set(values)].sort() as ModelCapability[];
  if (
    (!allowEmpty && normalized.length === 0) ||
    normalized.some((capability) => !capabilities.has(capability))
  ) {
    throw new ModelRoutingCommandRejectedError("routing_capabilities_invalid");
  }
  return normalized;
}

function requireRegions(values: ReadonlyArray<string>) {
  const regions = [...new Set(values.map(requireRegion))].sort();
  if (regions.length === 0 || regions.length > 32) {
    throw new ModelRoutingCommandRejectedError("routing_regions_invalid");
  }
  return regions;
}

function requireRegion(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(normalized)) {
    throw new ModelRoutingCommandRejectedError("routing_region_invalid");
  }
  return normalized;
}

function regionMatches(allowedRegions: ReadonlyArray<string>, region: string) {
  return allowedRegions.includes("global") || allowedRegions.includes(region);
}

function requireOneOf<Value extends string>(
  value: Value,
  allowed: ReadonlySet<Value>,
  reason: string,
): Value {
  if (!allowed.has(value)) {
    throw new ModelRoutingCommandRejectedError(reason);
  }
  return value;
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(normalized)) {
    throw new ModelRoutingCommandRejectedError(reason);
  }
  return normalized;
}

function requireInteger(
  value: number,
  minimum: number,
  maximum: number,
  reason: string,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ModelRoutingCommandRejectedError(reason);
  }
  return value;
}

function requireText(
  value: string,
  minimumLength: number,
  maximumLength: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimumLength || normalized.length > maximumLength) {
    throw new ModelRoutingCommandRejectedError(reason);
  }
  return normalized;
}

function requireReason(value: string) {
  return requireText(value, 8, 500, "command_reason_required");
}
