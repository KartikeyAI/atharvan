import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformAdapterCapabilityDeclaration,
  type PlatformAdapterCapabilityMaturity,
  type PlatformAdapterCapabilityName,
  type PlatformAdapterCategory,
  type PlatformAdapterCommandDeclaration,
  type PlatformAdapterConfigurationField,
  type PlatformAdapterConfigurationFieldType,
  type PlatformAdapterHealthCheckDeclaration,
  type PlatformAdapterLifecycle,
  type PlatformAdapterRegistry,
  type PlatformAdapterReleaseChannel,
  type PlatformAdapterSecurityReviewStatus,
  type PlatformAdapterSignatureStatus,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";

const categories = new Set<PlatformAdapterCategory>([
  "language",
  "framework",
  "package_manager",
  "build",
  "test",
  "database",
  "deployment",
  "cloud",
  "source_control",
  "observability",
  "security",
  "model",
  "design_system",
  "private_enterprise",
]);
const capabilityNames = [
  "detect",
  "understand",
  "modify",
  "validate",
  "preview",
  "deploy",
  "operate",
  "migrate",
] as const satisfies ReadonlyArray<PlatformAdapterCapabilityName>;
const maturities = new Set<PlatformAdapterCapabilityMaturity>([
  "unsupported",
  "experimental",
  "alpha",
  "beta",
  "stable",
  "deprecated",
]);
const fieldTypes = new Set<PlatformAdapterConfigurationFieldType>([
  "string",
  "boolean",
  "integer",
  "string_list",
  "secret_reference",
]);
const lifecycles = new Set<PlatformAdapterLifecycle>([
  "draft",
  "active",
  "deprecated",
  "blocked",
]);
const releaseChannels = new Set<PlatformAdapterReleaseChannel>([
  "internal",
  "canary",
  "beta",
  "stable",
]);
const signatureStatuses = new Set<PlatformAdapterSignatureStatus>([
  "unverified",
  "verified",
  "invalid",
]);
const reviewStatuses = new Set<PlatformAdapterSecurityReviewStatus>([
  "pending",
  "approved",
  "changes_required",
  "rejected",
]);
const supportedEnvironmentNames = new Set([
  "development",
  "preview",
  "staging",
  "production",
  "test",
]);

export type PlatformAdapterRegistryCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface PlatformAdapterRegistryStore {
  listRegistry(input: {
    readonly environment: PlatformConfigurationEnvironment;
  }): Promise<PlatformAdapterRegistry>;
  setRelease(input: {
    readonly actorId: string;
    readonly releaseId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly key: string;
    readonly version: string;
    readonly displayName: string;
    readonly category: PlatformAdapterCategory;
    readonly packageName: string;
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
    readonly deprecatedAt: Date | null;
    readonly sunsetAt: Date | null;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<PlatformAdapterRegistryCommandResult>;
}

export class PlatformAdapterCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("platform_adapter_command_rejected");
  }
}

export interface SetPlatformAdapterReleaseCommand {
  readonly actor: AuthenticatedOperator;
  readonly key: string;
  readonly version: string;
  readonly displayName: string;
  readonly category: PlatformAdapterCategory;
  readonly packageName: string;
  readonly packageDigestSha256: string;
  readonly documentationUrl?: string | null;
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
  readonly securityReviewReference?: string | null;
  readonly lifecycle: PlatformAdapterLifecycle;
  readonly blockReason?: string | null;
  readonly deprecatedAt?: string | null;
  readonly sunsetAt?: string | null;
  readonly reason: string;
  readonly correlationId?: string;
}

export function createPlatformAdapterRegistryService(input: {
  readonly store: PlatformAdapterRegistryStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  return {
    listRegistry: () =>
      input.store.listRegistry({ environment: input.environment }),

    async setRelease(command: SetPlatformAdapterReleaseCommand) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:adapters:write",
        requireRecentStepUp: true,
        now: commandTime,
      });
      const lifecycle = requireOneOf(
        command.lifecycle,
        lifecycles,
        "adapter_lifecycle_invalid",
      );
      const releaseChannel = requireOneOf(
        command.releaseChannel,
        releaseChannels,
        "adapter_release_channel_invalid",
      );
      const signatureStatus = requireOneOf(
        command.signatureStatus,
        signatureStatuses,
        "adapter_signature_status_invalid",
      );
      const securityReviewStatus = requireOneOf(
        command.securityReviewStatus,
        reviewStatuses,
        "adapter_review_status_invalid",
      );
      const securityReviewReference = requireOptionalText(
        command.securityReviewReference ?? null,
        3,
        200,
        "adapter_review_reference_invalid",
      );
      const blockReason = requireOptionalText(
        command.blockReason ?? null,
        8,
        500,
        "adapter_block_reason_invalid",
      );
      const deprecatedAt = requireOptionalDate(
        command.deprecatedAt ?? null,
        "adapter_deprecated_at_invalid",
      );
      const sunsetAt = requireOptionalDate(
        command.sunsetAt ?? null,
        "adapter_sunset_at_invalid",
      );
      const normalizedCapabilities = requireCapabilities(command.capabilities);

      if (
        lifecycle === "active" &&
        (signatureStatus !== "verified" ||
          securityReviewStatus !== "approved" ||
          securityReviewReference === null ||
          normalizedCapabilities.every(
            (capability) => capability.maturity === "unsupported",
          ))
      ) {
        reject("adapter_activation_evidence_incomplete");
      }
      if (releaseChannel === "stable" && lifecycle !== "active") {
        reject("stable_adapter_must_be_active");
      }
      if (
        (signatureStatus === "invalid" ||
          securityReviewStatus === "rejected") &&
        lifecycle !== "blocked"
      ) {
        reject("unsafe_adapter_must_be_blocked");
      }
      if ((lifecycle === "blocked") !== (blockReason !== null)) {
        reject(
          lifecycle === "blocked"
            ? "adapter_block_reason_required"
            : "adapter_block_reason_forbidden",
        );
      }
      if (lifecycle === "deprecated") {
        if (deprecatedAt === null) reject("adapter_deprecated_at_required");
        if (sunsetAt !== null && sunsetAt.getTime() <= deprecatedAt.getTime()) {
          reject("adapter_sunset_must_follow_deprecation");
        }
      } else if (deprecatedAt !== null || sunsetAt !== null) {
        reject("adapter_deprecation_metadata_forbidden");
      }

      const result = await input.store.setRelease({
        actorId: command.actor.operatorId,
        releaseId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        key: requireKey(command.key, "adapter_key_invalid"),
        version: requireVersion(command.version),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "adapter_name_required",
        ),
        category: requireOneOf(
          command.category,
          categories,
          "adapter_category_invalid",
        ),
        packageName: requirePackageName(command.packageName),
        packageDigestSha256: requireDigest(command.packageDigestSha256),
        documentationUrl: requireOptionalHttpsUrl(
          command.documentationUrl ?? null,
        ),
        capabilities: normalizedCapabilities,
        declaredPermissions: requireIdentifiers(
          command.declaredPermissions,
          64,
          "adapter_permissions_invalid",
        ),
        configurationFields: requireConfigurationFields(
          command.configurationFields,
        ),
        commands: requireCommands(command.commands),
        supportedEnvironments: requireSupportedEnvironments(
          command.supportedEnvironments,
        ),
        compatibilityTags: requireIdentifiers(
          command.compatibilityTags,
          64,
          "adapter_compatibility_invalid",
        ),
        requiredSecretPurposes: requireIdentifiers(
          command.requiredSecretPurposes,
          32,
          "adapter_secret_purposes_invalid",
        ),
        healthChecks: requireHealthChecks(command.healthChecks),
        releaseChannel,
        signatureStatus,
        securityReviewStatus,
        securityReviewReference,
        lifecycle,
        blockReason,
        deprecatedAt,
        sunsetAt,
        reason: requireText(command.reason, 8, 500, "command_reason_required"),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },
  };
}

function requireCapabilities(
  values: ReadonlyArray<PlatformAdapterCapabilityDeclaration>,
) {
  if (values.length !== capabilityNames.length) {
    reject("adapter_capabilities_incomplete");
  }
  const byName = new Map(values.map((value) => [value.name, value.maturity]));
  if (
    byName.size !== capabilityNames.length ||
    capabilityNames.some((name) => !byName.has(name)) ||
    [...byName.values()].some((maturity) => !maturities.has(maturity))
  ) {
    reject("adapter_capabilities_invalid");
  }
  return capabilityNames.map((name) => ({
    name,
    maturity: byName.get(name) as PlatformAdapterCapabilityMaturity,
  }));
}

function requireConfigurationFields(
  values: ReadonlyArray<PlatformAdapterConfigurationField>,
) {
  if (values.length > 64) reject("adapter_configuration_fields_invalid");
  const normalized = values.map((field) => ({
    key: requireKey(field.key, "adapter_configuration_fields_invalid"),
    label: requireText(
      field.label,
      2,
      120,
      "adapter_configuration_fields_invalid",
    ),
    type: requireOneOf(
      field.type,
      fieldTypes,
      "adapter_configuration_fields_invalid",
    ),
    required: field.required,
  }));
  if (
    normalized.some((field) => typeof field.required !== "boolean") ||
    new Set(normalized.map((field) => field.key)).size !== normalized.length
  ) {
    reject("adapter_configuration_fields_invalid");
  }
  return normalized;
}

function requireCommands(
  values: ReadonlyArray<PlatformAdapterCommandDeclaration>,
) {
  if (values.length > 64) reject("adapter_commands_invalid");
  const normalized = values.map((command) => ({
    key: requireKey(command.key, "adapter_commands_invalid"),
    description: requireText(
      command.description,
      3,
      240,
      "adapter_commands_invalid",
    ),
    risk: command.risk,
  }));
  if (
    normalized.some(
      (command) =>
        command.risk !== "read" &&
        command.risk !== "write" &&
        command.risk !== "destructive",
    ) ||
    new Set(normalized.map((command) => command.key)).size !== normalized.length
  ) {
    reject("adapter_commands_invalid");
  }
  return normalized;
}

function requireHealthChecks(
  values: ReadonlyArray<PlatformAdapterHealthCheckDeclaration>,
) {
  if (values.length > 16) reject("adapter_health_checks_invalid");
  const normalized = values.map((check) => ({
    key: requireKey(check.key, "adapter_health_checks_invalid"),
    command: requireText(
      check.command,
      1,
      240,
      "adapter_health_checks_invalid",
    ),
    timeoutSeconds: check.timeoutSeconds,
  }));
  if (
    normalized.some(
      (check) =>
        !Number.isSafeInteger(check.timeoutSeconds) ||
        check.timeoutSeconds < 1 ||
        check.timeoutSeconds > 300,
    ) ||
    new Set(normalized.map((check) => check.key)).size !== normalized.length
  ) {
    reject("adapter_health_checks_invalid");
  }
  return normalized;
}

function requireSupportedEnvironments(values: ReadonlyArray<string>) {
  const normalized = [
    ...new Set(values.map((value) => value.trim().toLowerCase())),
  ].sort();
  if (
    normalized.length === 0 ||
    normalized.some((value) => !supportedEnvironmentNames.has(value))
  ) {
    reject("adapter_supported_environments_invalid");
  }
  return normalized;
}

function requireIdentifiers(
  values: ReadonlyArray<string>,
  maximumItems: number,
  reason: string,
) {
  const normalized = [
    ...new Set(values.map((value) => value.trim().toLowerCase())),
  ].sort();
  if (
    normalized.length > maximumItems ||
    normalized.some(
      (value) => value.length > 128 || !/^[a-z][a-z0-9_.:/-]*$/.test(value),
    )
  ) {
    reject(reason);
  }
  return normalized;
}

function requireKey(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(normalized)) reject(reason);
  return normalized;
}

function requireVersion(value: string) {
  const normalized = value.trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    reject("adapter_version_invalid");
  }
  return normalized;
}

function requirePackageName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^@[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    reject("adapter_package_invalid");
  }
  return normalized;
}

function requireDigest(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) reject("adapter_digest_invalid");
  return normalized;
}

function requireOptionalHttpsUrl(value: string | null) {
  if (value === null || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      reject("adapter_documentation_url_invalid");
    }
    return url.toString();
  } catch (error) {
    if (error instanceof PlatformAdapterCommandRejectedError) throw error;
    reject("adapter_documentation_url_invalid");
  }
}

function requireOptionalDate(value: string | null, reason: string) {
  if (value === null || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) reject(reason);
  return date;
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

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    reject(reason);
  return normalized;
}

function requireOneOf<Value extends string>(
  value: Value,
  allowed: ReadonlySet<Value>,
  reason: string,
) {
  if (!allowed.has(value)) reject(reason);
  return value;
}

function reject(reason: string): never {
  throw new PlatformAdapterCommandRejectedError(reason);
}
