import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformConfigurationEnvironment,
  type PlatformConfigurationScope,
  type PlatformConfigurationValidation,
  type PlatformConfigurationValue,
  type PlatformConfigurationValueType,
} from "@atharvan/domain";

const configurationKeyPattern =
  /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)+$/;
const sensitiveKeySegmentPattern =
  /(^|[._-])(secret|password|token|credential|private[_-]?key|api[_-]?key|access[_-]?key|signing[_-]?key|hmac)([._-]|$)/;

export class PlatformConfigurationRejectedError extends Error {
  constructor(
    readonly reason:
      | "configuration_not_found"
      | "configuration_not_mutable"
      | "configuration_value_invalid"
      | "configuration_key_sensitive"
      | "configuration_scope_invalid"
      | "command_reason_required",
  ) {
    super(reason);
  }
}

export interface PlatformConfigurationDefinitionContract {
  readonly id: string;
  readonly key: string;
  readonly valueType: PlatformConfigurationValueType;
  readonly validation: PlatformConfigurationValidation;
  readonly isMutable: boolean;
}

export type PlatformConfigurationCommandResult =
  | {
      readonly outcome: "updated";
      readonly key: string;
      readonly revisionNumber: number;
    }
  | { readonly outcome: "unchanged"; readonly key: string };

export interface PlatformConfigurationAdministrationStore {
  findConfigurationDefinition(
    key: string,
  ): Promise<PlatformConfigurationDefinitionContract | null>;
  setConfiguration(input: {
    readonly actorId: string;
    readonly definition: PlatformConfigurationDefinitionContract;
    readonly scope: PlatformConfigurationScope;
    readonly environment: PlatformConfigurationEnvironment | null;
    readonly value: PlatformConfigurationValue;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<PlatformConfigurationCommandResult>;
}

export function createPlatformConfigurationAdministrationService(input: {
  readonly store: PlatformConfigurationAdministrationStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());

  return {
    async setConfiguration(command: {
      readonly actor: AuthenticatedOperator;
      readonly key: string;
      readonly scope: PlatformConfigurationScope;
      readonly value: unknown;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:configuration:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: commandTime,
      });

      const key = normalizePlatformConfigurationKey(command.key);
      const definition = await input.store.findConfigurationDefinition(key);

      if (definition === null) {
        throw new PlatformConfigurationRejectedError("configuration_not_found");
      }

      if (!definition.isMutable) {
        throw new PlatformConfigurationRejectedError(
          "configuration_not_mutable",
        );
      }

      const scope = requireScope(command.scope);
      const value = validatePlatformConfigurationValue({
        value: command.value,
        valueType: definition.valueType,
        validation: definition.validation,
      });

      return input.store.setConfiguration({
        actorId: command.actor.operatorId,
        definition,
        scope,
        environment: scope === "environment" ? input.environment : null,
        value,
        reason: requireReason(command.reason),
        correlationId: command.correlationId ?? crypto.randomUUID(),
        now: commandTime,
      });
    },
  };
}

export function normalizePlatformConfigurationKey(value: string): string {
  const key = value.trim().toLowerCase();

  if (!configurationKeyPattern.test(key) || key.length > 160) {
    throw new PlatformConfigurationRejectedError("configuration_not_found");
  }

  if (sensitiveKeySegmentPattern.test(key)) {
    throw new PlatformConfigurationRejectedError("configuration_key_sensitive");
  }

  return key;
}

export function validatePlatformConfigurationValue(input: {
  readonly value: unknown;
  readonly valueType: PlatformConfigurationValueType;
  readonly validation: PlatformConfigurationValidation;
}): PlatformConfigurationValue {
  const { value, valueType, validation } = input;

  if (valueType === "boolean") {
    if (typeof value !== "boolean") return invalidValue();
    return value;
  }

  if (valueType === "integer") {
    if (!Number.isSafeInteger(value)) return invalidValue();
    const numberValue = value as number;
    if (
      (validation.minimum !== undefined && numberValue < validation.minimum) ||
      (validation.maximum !== undefined && numberValue > validation.maximum)
    ) {
      return invalidValue();
    }
    return numberValue;
  }

  if (valueType === "string") {
    if (typeof value !== "string") return invalidValue();
    const stringValue = value.trim();
    const maximumLength = validation.maximumLength ?? 2_000;
    if (
      stringValue.length === 0 ||
      stringValue.length > maximumLength ||
      (validation.allowedValues !== undefined &&
        !validation.allowedValues.includes(stringValue))
    ) {
      return invalidValue();
    }
    return stringValue;
  }

  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 100 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim().length === 0 ||
        item.trim().length > (validation.maximumLength ?? 200),
    )
  ) {
    return invalidValue();
  }

  const normalized = value.map((item) => (item as string).trim());
  if (new Set(normalized).size !== normalized.length) return invalidValue();
  return normalized;
}

function requireScope(
  value: PlatformConfigurationScope,
): PlatformConfigurationScope {
  if (value !== "platform" && value !== "environment") {
    throw new PlatformConfigurationRejectedError("configuration_scope_invalid");
  }
  return value;
}

function requireReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new PlatformConfigurationRejectedError("command_reason_required");
  }
  return reason;
}

function invalidValue(): never {
  throw new PlatformConfigurationRejectedError("configuration_value_invalid");
}
