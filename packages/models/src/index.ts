import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type ModelCapability,
  type ModelCatalogueLifecycle,
  type ModelDataClassification,
  type ModelKind,
  type ModelProviderAdapterKind,
  type ModelProviderCatalogue,
  type ModelProviderReportedHealth,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";

const adapterKinds = new Set<ModelProviderAdapterKind>([
  "openai",
  "anthropic",
  "google",
  "azure_openai",
  "openai_compatible",
  "self_hosted",
]);
const lifecycles = new Set<ModelCatalogueLifecycle>([
  "draft",
  "active",
  "deprecated",
]);
const dataClassifications = new Set<ModelDataClassification>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const modelKinds = new Set<ModelKind>(["generation", "embedding"]);
const modelCapabilities = new Set<ModelCapability>([
  "text_generation",
  "code_generation",
  "reasoning",
  "vision",
  "tool_use",
  "structured_output",
  "embeddings",
]);
const healthStatuses = new Set<ModelProviderReportedHealth>([
  "healthy",
  "degraded",
  "unavailable",
]);

export type ModelCatalogueCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
    }
  | {
      readonly outcome: "rejected";
      readonly reason: string;
    };

export interface ModelCatalogueStore {
  listCatalogue(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly now: Date;
  }): Promise<ModelProviderCatalogue>;
  setProvider(input: {
    readonly actorId: string;
    readonly providerId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly key: string;
    readonly displayName: string;
    readonly adapterKind: ModelProviderAdapterKind;
    readonly baseUrl: string | null;
    readonly credentialReferenceId: string | null | undefined;
    readonly regions: ReadonlyArray<string>;
    readonly maximumDataClassification: ModelDataClassification;
    readonly lifecycle: ModelCatalogueLifecycle;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<ModelCatalogueCommandResult>;
  setModel(input: {
    readonly actorId: string;
    readonly modelId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly providerId: string;
    readonly key: string;
    readonly displayName: string;
    readonly kind: ModelKind;
    readonly capabilities: ReadonlyArray<ModelCapability>;
    readonly contextWindowTokens: number;
    readonly maximumOutputTokens: number | null;
    readonly inputPriceMicrounitsPerMillion: number;
    readonly outputPriceMicrounitsPerMillion: number;
    readonly regions: ReadonlyArray<string>;
    readonly maximumDataClassification: ModelDataClassification;
    readonly lifecycle: ModelCatalogueLifecycle;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<ModelCatalogueCommandResult>;
  recordHealthObservation(input: {
    readonly actorId: string;
    readonly observationId: string;
    readonly providerId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly status: ModelProviderReportedHealth;
    readonly source: "operator_probe";
    readonly latencyMs: number | null;
    readonly httpStatusCode: number | null;
    readonly errorCode: string | null;
    readonly reason: string;
    readonly correlationId: string;
    readonly observedAt: Date;
    readonly expiresAt: Date;
  }): Promise<
    | { readonly outcome: "created"; readonly id: string }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
}

export class ModelCatalogueCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("model_catalogue_command_rejected");
  }
}

export function createModelCatalogueService(input: {
  readonly store: ModelCatalogueStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  function authorize(
    actor: AuthenticatedOperator,
    commandTime: Date,
    requireRecentStepUp: boolean,
  ) {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:models:write",
      requireRecentStepUp,
      now: commandTime,
    });
  }

  return {
    listCatalogue: () =>
      input.store.listCatalogue({ environment: input.environment, now: now() }),

    async setProvider(command: {
      readonly actor: AuthenticatedOperator;
      readonly key: string;
      readonly displayName: string;
      readonly adapterKind: ModelProviderAdapterKind;
      readonly baseUrl?: string | null;
      readonly credentialReferenceId?: string | null;
      readonly regions: ReadonlyArray<string>;
      readonly maximumDataClassification: ModelDataClassification;
      readonly lifecycle: ModelCatalogueLifecycle;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime, true);
      const result = await input.store.setProvider({
        actorId: command.actor.operatorId,
        providerId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        key: requireProviderKey(command.key),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "provider_name_required",
        ),
        adapterKind: requireOneOf(
          command.adapterKind,
          adapterKinds,
          "provider_adapter_invalid",
        ),
        baseUrl: requireBaseUrl(command.baseUrl ?? null),
        credentialReferenceId:
          command.credentialReferenceId === undefined
            ? undefined
            : requireOptionalUuid(command.credentialReferenceId),
        regions: requireRegions(command.regions),
        maximumDataClassification: requireOneOf(
          command.maximumDataClassification,
          dataClassifications,
          "data_classification_invalid",
        ),
        lifecycle: requireOneOf(
          command.lifecycle,
          lifecycles,
          "provider_lifecycle_invalid",
        ),
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      return unwrap(result);
    },

    async setModel(command: {
      readonly actor: AuthenticatedOperator;
      readonly providerId: string;
      readonly key: string;
      readonly displayName: string;
      readonly kind: ModelKind;
      readonly capabilities: ReadonlyArray<ModelCapability>;
      readonly contextWindowTokens: number;
      readonly maximumOutputTokens?: number | null;
      readonly inputPriceMicrounitsPerMillion: number;
      readonly outputPriceMicrounitsPerMillion: number;
      readonly regions: ReadonlyArray<string>;
      readonly maximumDataClassification: ModelDataClassification;
      readonly lifecycle: ModelCatalogueLifecycle;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime, true);
      const kind = requireOneOf(command.kind, modelKinds, "model_kind_invalid");
      const capabilities = requireCapabilities(command.capabilities, kind);
      const maximumOutputTokens =
        command.maximumOutputTokens === null ||
        command.maximumOutputTokens === undefined
          ? null
          : requireInteger(
              command.maximumOutputTokens,
              1,
              10_000_000,
              "maximum_output_tokens_invalid",
            );
      if (kind === "generation" && maximumOutputTokens === null) {
        throw new ModelCatalogueCommandRejectedError(
          "maximum_output_tokens_required",
        );
      }
      if (kind === "embedding" && maximumOutputTokens !== null) {
        throw new ModelCatalogueCommandRejectedError(
          "embedding_output_tokens_forbidden",
        );
      }

      const result = await input.store.setModel({
        actorId: command.actor.operatorId,
        modelId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        providerId: requireUuid(command.providerId, "provider_id_invalid"),
        key: requireModelKey(command.key),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "model_name_required",
        ),
        kind,
        capabilities,
        contextWindowTokens: requireInteger(
          command.contextWindowTokens,
          1,
          100_000_000,
          "context_window_invalid",
        ),
        maximumOutputTokens,
        inputPriceMicrounitsPerMillion: requireInteger(
          command.inputPriceMicrounitsPerMillion,
          0,
          1_000_000_000_000,
          "input_price_invalid",
        ),
        outputPriceMicrounitsPerMillion: requireInteger(
          command.outputPriceMicrounitsPerMillion,
          0,
          1_000_000_000_000,
          "output_price_invalid",
        ),
        regions: requireRegions(command.regions),
        maximumDataClassification: requireOneOf(
          command.maximumDataClassification,
          dataClassifications,
          "data_classification_invalid",
        ),
        lifecycle: requireOneOf(
          command.lifecycle,
          lifecycles,
          "model_lifecycle_invalid",
        ),
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      return unwrap(result);
    },

    async recordHealthObservation(command: {
      readonly actor: AuthenticatedOperator;
      readonly providerId: string;
      readonly status: ModelProviderReportedHealth;
      readonly latencyMs?: number | null;
      readonly httpStatusCode?: number | null;
      readonly errorCode?: string | null;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime, false);
      const status = requireOneOf(
        command.status,
        healthStatuses,
        "health_status_invalid",
      );
      const latencyMs = requireOptionalInteger(
        command.latencyMs ?? null,
        0,
        120_000,
        "latency_invalid",
      );
      const httpStatusCode = requireOptionalInteger(
        command.httpStatusCode ?? null,
        100,
        599,
        "http_status_invalid",
      );
      const errorCode = requireOptionalErrorCode(command.errorCode ?? null);
      if (status === "healthy" && errorCode !== null) {
        throw new ModelCatalogueCommandRejectedError(
          "healthy_observation_error_forbidden",
        );
      }
      const result = await input.store.recordHealthObservation({
        actorId: command.actor.operatorId,
        observationId: randomId(),
        providerId: requireUuid(command.providerId, "provider_id_invalid"),
        environment: input.environment,
        status,
        source: "operator_probe",
        latencyMs,
        httpStatusCode,
        errorCode,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        observedAt: commandTime,
        expiresAt: new Date(commandTime.getTime() + 5 * 60_000),
      });
      if (result.outcome === "rejected") {
        throw new ModelCatalogueCommandRejectedError(result.reason);
      }
      return result;
    },
  };
}

function unwrap(result: ModelCatalogueCommandResult) {
  if (result.outcome === "rejected") {
    throw new ModelCatalogueCommandRejectedError(result.reason);
  }
  return result;
}

function requireProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(normalized)) {
    throw new ModelCatalogueCommandRejectedError("provider_key_invalid");
  }
  return normalized;
}

function requireModelKey(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(normalized)) {
    throw new ModelCatalogueCommandRejectedError("model_key_invalid");
  }
  return normalized;
}

function requireBaseUrl(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("invalid");
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new ModelCatalogueCommandRejectedError("provider_base_url_invalid");
  }
}

function requireRegions(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const regions = [
    ...new Set(values.map((value) => value.trim().toLowerCase())),
  ].sort();
  if (
    regions.length === 0 ||
    regions.length > 32 ||
    regions.some((region) => !/^[a-z0-9][a-z0-9-]{1,31}$/.test(region))
  ) {
    throw new ModelCatalogueCommandRejectedError("regions_invalid");
  }
  return regions;
}

function requireCapabilities(
  values: ReadonlyArray<ModelCapability>,
  kind: ModelKind,
): ReadonlyArray<ModelCapability> {
  const capabilities = [...new Set(values)].sort() as ModelCapability[];
  if (
    capabilities.length === 0 ||
    capabilities.some((capability) => !modelCapabilities.has(capability)) ||
    (kind === "embedding") !== capabilities.includes("embeddings") ||
    (kind === "embedding" && capabilities.length !== 1)
  ) {
    throw new ModelCatalogueCommandRejectedError("model_capabilities_invalid");
  }
  return capabilities;
}

function requireOneOf<Value extends string>(
  value: Value,
  allowed: ReadonlySet<Value>,
  reason: string,
): Value {
  if (!allowed.has(value)) {
    throw new ModelCatalogueCommandRejectedError(reason);
  }
  return value;
}

function requireText(
  value: string,
  minimumLength: number,
  maximumLength: number,
  reason: string,
): string {
  const normalized = value.trim();
  if (normalized.length < minimumLength || normalized.length > maximumLength) {
    throw new ModelCatalogueCommandRejectedError(reason);
  }
  return normalized;
}

function requireReason(value: string) {
  return requireText(value, 8, 500, "command_reason_required");
}

function requireOptionalUuid(value: string | null): string | null {
  return value === null
    ? null
    : requireUuid(value, "credential_reference_invalid");
}

function requireUuid(value: string, reason: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(normalized)) {
    throw new ModelCatalogueCommandRejectedError(reason);
  }
  return normalized;
}

function requireInteger(
  value: number,
  minimum: number,
  maximum: number,
  reason: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ModelCatalogueCommandRejectedError(reason);
  }
  return value;
}

function requireOptionalInteger(
  value: number | null,
  minimum: number,
  maximum: number,
  reason: string,
): number | null {
  return value === null
    ? null
    : requireInteger(value, minimum, maximum, reason);
}

function requireOptionalErrorCode(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(normalized)) {
    throw new ModelCatalogueCommandRejectedError("health_error_code_invalid");
  }
  return normalized;
}

export * from "./routing";

export * from "./routing";
