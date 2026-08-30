export type PlatformConfigurationEnvironment =
  "development" | "production" | "test";

export type PlatformConfigurationScope = "platform" | "environment";

export type PlatformConfigurationValueType =
  "boolean" | "integer" | "string" | "string_list";

export type PlatformConfigurationValue =
  boolean | number | string | ReadonlyArray<string>;

export interface PlatformConfigurationValidation {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumLength?: number;
  readonly allowedValues?: ReadonlyArray<string>;
}

export interface PlatformConfigurationRevisionEntry {
  readonly id: string;
  readonly revisionNumber: number;
  readonly scope: PlatformConfigurationScope;
  readonly environment: PlatformConfigurationEnvironment | null;
  readonly value: PlatformConfigurationValue;
  readonly reason: string;
  readonly correlationId: string;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
}

export interface PlatformConfigurationEntry {
  readonly definitionId: string;
  readonly key: string;
  readonly category: string;
  readonly name: string;
  readonly description: string;
  readonly valueType: PlatformConfigurationValueType;
  readonly validation: PlatformConfigurationValidation;
  readonly defaultValue: PlatformConfigurationValue;
  readonly platformOverride: PlatformConfigurationRevisionEntry | null;
  readonly environmentOverride: PlatformConfigurationRevisionEntry | null;
  readonly resolvedValue: PlatformConfigurationValue;
  readonly resolvedFrom: "default" | PlatformConfigurationScope;
  readonly recentRevisions: ReadonlyArray<PlatformConfigurationRevisionEntry>;
}

export interface PlatformConfigurationRegistry {
  readonly environment: PlatformConfigurationEnvironment;
  readonly items: ReadonlyArray<PlatformConfigurationEntry>;
}
