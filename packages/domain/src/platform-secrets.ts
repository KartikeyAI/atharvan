export type PlatformSecretReferenceStatus =
  | "provisioning"
  | "active"
  | "provisioning_failed"
  | "rotating"
  | "rotation_failed"
  | "revoking"
  | "revocation_failed"
  | "revoked";

export type PlatformSecretVersionStatus =
  "pending" | "active" | "retired" | "failed";

export type PlatformSecretProvider = "cloudflare_secrets_store";

export interface PlatformSecretVersionEntry {
  readonly id: string;
  readonly versionNumber: number;
  readonly status: PlatformSecretVersionStatus;
  readonly reason: string;
  readonly correlationId: string;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly retiredAt: string | null;
  readonly failedAt: string | null;
}

export interface PlatformSecretReferenceEntry {
  readonly id: string;
  readonly key: string;
  readonly purpose: string;
  readonly environment: "development" | "production" | "test";
  readonly provider: PlatformSecretProvider;
  readonly status: PlatformSecretReferenceStatus;
  readonly currentVersionNumber: number | null;
  readonly createdByOperatorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt: string | null;
  readonly recentVersions: ReadonlyArray<PlatformSecretVersionEntry>;
}

export interface PlatformSecretReferenceRegistry {
  readonly providerConfigured: boolean;
  readonly items: ReadonlyArray<PlatformSecretReferenceEntry>;
}
