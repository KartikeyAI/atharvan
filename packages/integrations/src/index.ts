import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformConfigurationEnvironment,
  type PlatformIntegrationCapability,
  type PlatformIntegrationConnectionMode,
  type PlatformIntegrationLifecycle,
  type PlatformIntegrationOperationalState,
  type PlatformIntegrationProtocol,
  type PlatformIntegrationRegistry,
  type PlatformIntegrationReportedHealth,
} from "@atharvan/domain";

const protocols = new Set<PlatformIntegrationProtocol>([
  "oauth2",
  "api_key",
  "service_account",
  "webhook",
]);
const connectionModes = new Set<PlatformIntegrationConnectionMode>([
  "direct",
  "managed",
  "claimable",
]);
const lifecycles = new Set<PlatformIntegrationLifecycle>([
  "draft",
  "active",
  "deprecated",
]);
const operationalStates = new Set<PlatformIntegrationOperationalState>([
  "enabled",
  "maintenance",
  "disabled",
]);
const capabilities = new Set<PlatformIntegrationCapability>([
  "source_control",
  "deployment",
  "database",
  "authentication",
  "observability",
  "billing",
  "notifications",
  "design",
]);
const healthStatuses = new Set<PlatformIntegrationReportedHealth>([
  "healthy",
  "degraded",
  "unavailable",
]);

export type IntegrationRegistryCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface PlatformIntegrationRegistryStore {
  listRegistry(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly now: Date;
  }): Promise<PlatformIntegrationRegistry>;
  setIntegration(input: {
    readonly actorId: string;
    readonly integrationId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
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
    readonly clientSecretReferenceId: string | null | undefined;
    readonly webhookSecretReferenceId: string | null | undefined;
    readonly callbackUrls: ReadonlyArray<string>;
    readonly requiredScopes: ReadonlyArray<string>;
    readonly optionalScopes: ReadonlyArray<string>;
    readonly lifecycle: PlatformIntegrationLifecycle;
    readonly operationalState: PlatformIntegrationOperationalState;
    readonly maintenanceExpiresAt: Date | null;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<IntegrationRegistryCommandResult>;
  recordHealthObservation(input: {
    readonly actorId: string;
    readonly observationId: string;
    readonly integrationId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly status: PlatformIntegrationReportedHealth;
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

export class PlatformIntegrationCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("platform_integration_command_rejected");
  }
}

export function createPlatformIntegrationRegistryService(input: {
  readonly store: PlatformIntegrationRegistryStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  return {
    listRegistry: () =>
      input.store.listRegistry({ environment: input.environment, now: now() }),

    async setIntegration(command: SetPlatformIntegrationCommand) {
      const commandTime = now();
      authorize(command.actor, commandTime, true);
      const protocol = requireOneOf(
        command.protocol,
        protocols,
        "integration_protocol_invalid",
      );
      const requiredScopes = requireScopes(command.requiredScopes);
      const optionalScopes = requireScopes(command.optionalScopes);
      if (requiredScopes.some((scope) => optionalScopes.includes(scope))) {
        reject("integration_scope_overlap");
      }
      const authorizationUrl = requireOptionalHttpsUrl(
        command.authorizationUrl ?? null,
        "authorization_url_invalid",
      );
      const tokenUrl = requireOptionalHttpsUrl(
        command.tokenUrl ?? null,
        "token_url_invalid",
      );
      const clientId = requireOptionalText(
        command.clientId ?? null,
        1,
        255,
        "client_id_invalid",
      );
      const callbackUrls = requireCallbackUrls(command.callbackUrls);
      const clientSecretReferenceId = requireOptionalReference(
        command.clientSecretReferenceId,
      );
      const webhookSecretReferenceId = requireOptionalReference(
        command.webhookSecretReferenceId,
      );

      if (
        protocol === "oauth2" &&
        (authorizationUrl === null ||
          tokenUrl === null ||
          clientId === null ||
          callbackUrls.length === 0 ||
          (command.lifecycle === "active" && clientSecretReferenceId === null))
      ) {
        reject("oauth_configuration_incomplete");
      }
      if (
        protocol !== "oauth2" &&
        (authorizationUrl !== null ||
          tokenUrl !== null ||
          clientId !== null ||
          callbackUrls.length > 0 ||
          requiredScopes.length > 0 ||
          optionalScopes.length > 0)
      ) {
        reject("oauth_configuration_forbidden");
      }

      const operationalState = requireOneOf(
        command.operationalState,
        operationalStates,
        "integration_operational_state_invalid",
      );
      const maintenanceExpiresAt = requireMaintenanceExpiry(
        operationalState,
        command.maintenanceExpiresAt ?? null,
        commandTime,
      );
      const result = await input.store.setIntegration({
        actorId: command.actor.operatorId,
        integrationId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        key: requireKey(command.key),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "integration_name_required",
        ),
        protocol,
        connectionMode: requireOneOf(
          command.connectionMode,
          connectionModes,
          "integration_connection_mode_invalid",
        ),
        capabilities: requireCapabilities(command.capabilities),
        adapterPackage: requireAdapterPackage(command.adapterPackage),
        adapterVersion: requireAdapterVersion(command.adapterVersion),
        documentationUrl: requireOptionalHttpsUrl(
          command.documentationUrl ?? null,
          "documentation_url_invalid",
        ),
        authorizationUrl,
        tokenUrl,
        clientId,
        clientSecretReferenceId,
        webhookSecretReferenceId,
        callbackUrls,
        requiredScopes,
        optionalScopes,
        lifecycle: requireOneOf(
          command.lifecycle,
          lifecycles,
          "integration_lifecycle_invalid",
        ),
        operationalState,
        maintenanceExpiresAt,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      return unwrap(result);
    },

    async recordHealthObservation(command: RecordIntegrationHealthCommand) {
      const commandTime = now();
      authorize(command.actor, commandTime, false);
      const status = requireOneOf(
        command.status,
        healthStatuses,
        "health_status_invalid",
      );
      const errorCode = requireOptionalErrorCode(command.errorCode ?? null);
      if (status === "healthy" && errorCode !== null) {
        reject("healthy_observation_error_forbidden");
      }
      const result = await input.store.recordHealthObservation({
        actorId: command.actor.operatorId,
        observationId: randomId(),
        integrationId: requireUuid(
          command.integrationId,
          "integration_id_invalid",
        ),
        environment: input.environment,
        status,
        source: "operator_probe",
        latencyMs: requireOptionalInteger(
          command.latencyMs ?? null,
          0,
          120_000,
          "latency_invalid",
        ),
        httpStatusCode: requireOptionalInteger(
          command.httpStatusCode ?? null,
          100,
          599,
          "http_status_invalid",
        ),
        errorCode,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? randomId(),
        observedAt: commandTime,
        expiresAt: new Date(commandTime.getTime() + 5 * 60_000),
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },
  };
}

export interface SetPlatformIntegrationCommand {
  readonly actor: AuthenticatedOperator;
  readonly key: string;
  readonly displayName: string;
  readonly protocol: PlatformIntegrationProtocol;
  readonly connectionMode: PlatformIntegrationConnectionMode;
  readonly capabilities: ReadonlyArray<PlatformIntegrationCapability>;
  readonly adapterPackage: string;
  readonly adapterVersion: string;
  readonly documentationUrl?: string | null;
  readonly authorizationUrl?: string | null;
  readonly tokenUrl?: string | null;
  readonly clientId?: string | null;
  readonly clientSecretReferenceId?: string | null;
  readonly webhookSecretReferenceId?: string | null;
  readonly callbackUrls: ReadonlyArray<string>;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly optionalScopes: ReadonlyArray<string>;
  readonly lifecycle: PlatformIntegrationLifecycle;
  readonly operationalState: PlatformIntegrationOperationalState;
  readonly maintenanceExpiresAt?: string | null;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface RecordIntegrationHealthCommand {
  readonly actor: AuthenticatedOperator;
  readonly integrationId: string;
  readonly status: PlatformIntegrationReportedHealth;
  readonly latencyMs?: number | null;
  readonly httpStatusCode?: number | null;
  readonly errorCode?: string | null;
  readonly reason: string;
  readonly correlationId?: string;
}

function authorize(
  actor: AuthenticatedOperator,
  now: Date,
  requireRecentStepUp: boolean,
) {
  assertPlatformCommandAuthorized({
    actor,
    requestedCapability: "platform:integrations:write",
    requireRecentStepUp,
    now,
  });
}

function unwrap(result: IntegrationRegistryCommandResult) {
  if (result.outcome === "rejected") reject(result.reason);
  return result;
}

function reject(reason: string): never {
  throw new PlatformIntegrationCommandRejectedError(reason);
}

function requireKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(normalized)) {
    reject("integration_key_invalid");
  }
  return normalized;
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    reject(reason);
  }
  return normalized;
}

function requireOptionalText(
  value: string | null,
  minimum: number,
  maximum: number,
  reason: string,
) {
  return value === null || value.trim() === ""
    ? null
    : requireText(value, minimum, maximum, reason);
}

function requireReason(value: string) {
  return requireText(value, 8, 500, "command_reason_required");
}

function requireOneOf<Value extends string>(
  value: Value,
  allowed: ReadonlySet<Value>,
  reason: string,
) {
  if (!allowed.has(value)) reject(reason);
  return value;
}

function requireCapabilities(
  values: ReadonlyArray<PlatformIntegrationCapability>,
) {
  const normalized = [
    ...new Set(values),
  ].sort() as PlatformIntegrationCapability[];
  if (
    normalized.length === 0 ||
    normalized.some((capability) => !capabilities.has(capability))
  ) {
    reject("integration_capabilities_invalid");
  }
  return normalized;
}

function requireAdapterPackage(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^@[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    reject("adapter_package_invalid");
  }
  return normalized;
}

function requireAdapterVersion(value: string) {
  const normalized = value.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    reject("adapter_version_invalid");
  }
  return normalized;
}

function requireOptionalHttpsUrl(value: string | null, reason: string) {
  if (value === null || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) {
      reject(reason);
    }
    return url.toString();
  } catch (error) {
    if (error instanceof PlatformIntegrationCommandRejectedError) throw error;
    reject(reason);
  }
}

function requireCallbackUrls(values: ReadonlyArray<string>) {
  const normalized = [...new Set(values.map((value) => value.trim()))].sort();
  if (normalized.length > 16) reject("callback_urls_invalid");
  for (const value of normalized) {
    const url = requireOptionalHttpsUrl(value, "callback_urls_invalid");
    if (url === null || new URL(url).search !== "") {
      reject("callback_urls_invalid");
    }
  }
  return normalized;
}

function requireScopes(values: ReadonlyArray<string>) {
  const normalized = [...new Set(values.map((value) => value.trim()))].sort();
  if (
    normalized.length > 64 ||
    normalized.some(
      (value) =>
        value.length === 0 ||
        value.length > 128 ||
        !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/.test(value),
    )
  ) {
    reject("integration_scopes_invalid");
  }
  return normalized;
}

function requireOptionalReference(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? null : requireUuid(value, "secret_reference_invalid");
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(normalized)) reject(reason);
  return normalized;
}

function requireMaintenanceExpiry(
  state: PlatformIntegrationOperationalState,
  value: string | null,
  now: Date,
) {
  if (state !== "maintenance") {
    if (value !== null) reject("maintenance_expiry_forbidden");
    return null;
  }
  if (value === null) reject("maintenance_expiry_required");
  const expiry = new Date(value);
  if (
    Number.isNaN(expiry.getTime()) ||
    expiry.getTime() <= now.getTime() ||
    expiry.getTime() > now.getTime() + 90 * 24 * 60 * 60_000
  ) {
    reject("maintenance_expiry_invalid");
  }
  return expiry;
}

function requireOptionalInteger(
  value: number | null,
  minimum: number,
  maximum: number,
  reason: string,
) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    reject(reason);
  }
  return value;
}

function requireOptionalErrorCode(value: string | null) {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,95}$/.test(normalized)) {
    reject("health_error_code_invalid");
  }
  return normalized;
}
