import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  PlatformAdapterCapabilityDeclaration,
  PlatformAdapterCommandDeclaration,
  PlatformAdapterConfigurationField,
  PlatformAdapterHealthCheckDeclaration,
  PlatformConfigurationValidation,
  PlatformConfigurationValue,
  PlatformFeatureFlagRule,
  PlatformJsonValue,
} from "@atharvan/domain";

export const authSchema = pgSchema("auth");

export const user = authSchema.table(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("auth_user_email_unique").on(table.email)],
);

export const session = authSchema.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("auth_session_token_unique").on(table.token),
    index("auth_session_user_id_idx").on(table.userId),
  ],
);

export const account = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_account_issuer_account_unique").on(
      table.issuer,
      table.accountId,
    ),
    index("auth_account_user_id_idx").on(table.userId),
  ],
);

export const verification = authSchema.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = authSchema.table(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (table) => [uniqueIndex("auth_rate_limit_key_unique").on(table.key)],
);

export const operatorStatus = pgEnum("operator_status", [
  "invited",
  "verification_pending",
  "active",
  "suspended",
  "deactivated",
]);

export const operatorInvitationStatus = pgEnum("operator_invitation_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

export const verificationChallengeStatus = pgEnum(
  "verification_challenge_status",
  ["pending", "consumed", "expired", "locked", "superseded"],
);

export const platformConfigurationValueType = pgEnum(
  "platform_configuration_value_type",
  ["boolean", "integer", "string", "string_list"],
);

export const platformConfigurationScope = pgEnum(
  "platform_configuration_scope",
  ["platform", "environment"],
);

export const platformConfigurationEnvironment = pgEnum(
  "platform_configuration_environment",
  ["development", "production", "test"],
);

export const platformCommandOutcome = pgEnum("platform_command_outcome", [
  "succeeded",
  "rejected",
  "failed",
]);

export const platformSecretReferenceStatus = pgEnum(
  "platform_secret_reference_status",
  [
    "provisioning",
    "active",
    "provisioning_failed",
    "rotating",
    "rotation_failed",
    "revoking",
    "revocation_failed",
    "revoked",
  ],
);

export const platformSecretVersionStatus = pgEnum(
  "platform_secret_version_status",
  ["pending", "active", "retired", "failed"],
);

export const platformSecretProvider = pgEnum("platform_secret_provider", [
  "cloudflare_secrets_store",
]);

export const modelProviderAdapterKind = pgEnum("model_provider_adapter_kind", [
  "openai",
  "anthropic",
  "google",
  "azure_openai",
  "openai_compatible",
  "self_hosted",
]);

export const modelCatalogueLifecycle = pgEnum("model_catalogue_lifecycle", [
  "draft",
  "active",
  "deprecated",
]);

export const modelDataClassification = pgEnum("model_data_classification", [
  "public",
  "internal",
  "confidential",
  "restricted",
]);

export const modelKind = pgEnum("model_kind", ["generation", "embedding"]);

export const modelProviderHealthStatus = pgEnum(
  "model_provider_health_status",
  ["healthy", "degraded", "unavailable"],
);

export const modelProviderHealthSource = pgEnum(
  "model_provider_health_source",
  ["operator_probe"],
);

export const modelRoutingControlState = pgEnum("model_routing_control_state", [
  "enabled",
  "maintenance",
  "disabled",
]);

export const modelRoutingControlTargetKind = pgEnum(
  "model_routing_control_target_kind",
  ["provider", "model"],
);

export const platformIntegrationProtocol = pgEnum(
  "platform_integration_protocol",
  ["oauth2", "api_key", "service_account", "webhook"],
);

export const platformIntegrationConnectionMode = pgEnum(
  "platform_integration_connection_mode",
  ["direct", "managed", "claimable"],
);

export const platformIntegrationLifecycle = pgEnum(
  "platform_integration_lifecycle",
  ["draft", "active", "deprecated"],
);

export const platformIntegrationOperationalState = pgEnum(
  "platform_integration_operational_state",
  ["enabled", "maintenance", "disabled"],
);

export const platformIntegrationHealthStatus = pgEnum(
  "platform_integration_health_status",
  ["healthy", "degraded", "unavailable"],
);

export const platformIntegrationHealthSource = pgEnum(
  "platform_integration_health_source",
  ["operator_probe"],
);

export const platformAdapterCategory = pgEnum("platform_adapter_category", [
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

export const platformAdapterReleaseChannel = pgEnum(
  "platform_adapter_release_channel",
  ["internal", "canary", "beta", "stable"],
);

export const platformAdapterSignatureStatus = pgEnum(
  "platform_adapter_signature_status",
  ["unverified", "verified", "invalid"],
);

export const platformAdapterSecurityReviewStatus = pgEnum(
  "platform_adapter_security_review_status",
  ["pending", "approved", "changes_required", "rejected"],
);

export const platformAdapterLifecycle = pgEnum("platform_adapter_lifecycle", [
  "draft",
  "active",
  "deprecated",
  "blocked",
]);

export const platformFeatureFlagLifecycle = pgEnum(
  "platform_feature_flag_lifecycle",
  ["draft", "active", "archived"],
);

export const operators = pgTable(
  "operators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailDomain: text("email_domain").notNull(),
    status: operatorStatus("status").notNull().default("invited"),
    isSuperAdministrator: boolean("is_super_administrator")
      .notNull()
      .default(false),
    authUserId: text("auth_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    invitedAt: timestamp("invited_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("operators_email_unique").on(table.email),
    uniqueIndex("operators_auth_user_id_unique")
      .on(table.authUserId)
      .where(sql`${table.authUserId} IS NOT NULL`),
    index("operators_email_domain_idx").on(table.emailDomain),
    uniqueIndex("operators_single_super_administrator")
      .on(table.isSuperAdministrator)
      .where(sql`${table.isSuperAdministrator} = true`),
    check(
      "operators_email_normalized",
      sql`${table.email} = lower(${table.email})`,
    ),
    check("operators_email_shape", sql`${table.email} ~ '^[^@]+@[^@]+$'`),
    check(
      "operators_email_domain_normalized",
      sql`${table.emailDomain} = lower(${table.emailDomain})`,
    ),
    check(
      "operators_email_domain_matches",
      sql`${table.emailDomain} = split_part(${table.email}, '@', 2)`,
    ),
    check(
      "operators_active_has_activation_time",
      sql`${table.status} <> 'active' OR ${table.activatedAt} IS NOT NULL`,
    ),
    check(
      "operators_super_administrator_must_be_active",
      sql`NOT ${table.isSuperAdministrator} OR ${table.status} = 'active'`,
    ),
  ],
);

export const allowedEmailDomains = pgTable(
  "allowed_email_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain").notNull(),
    includeSubdomains: boolean("include_subdomains").notNull().default(false),
    isPublicDomainException: boolean("is_public_domain_exception")
      .notNull()
      .default(false),
    isActive: boolean("is_active").notNull().default(true),
    reason: text("reason").notNull(),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id),
    disabledByOperatorId: uuid("disabled_by_operator_id").references(
      () => operators.id,
    ),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("allowed_email_domains_domain_unique").on(table.domain),
    index("allowed_email_domains_created_by_idx").on(table.createdByOperatorId),
    index("allowed_email_domains_disabled_by_idx")
      .on(table.disabledByOperatorId)
      .where(sql`${table.disabledByOperatorId} IS NOT NULL`),
    check(
      "allowed_email_domains_normalized",
      sql`${table.domain} = lower(${table.domain})`,
    ),
    check(
      "allowed_email_domains_disable_metadata",
      sql`(${table.isActive} AND ${table.disabledAt} IS NULL AND ${table.disabledByOperatorId} IS NULL) OR (NOT ${table.isActive} AND ${table.disabledAt} IS NOT NULL AND ${table.disabledByOperatorId} IS NOT NULL)`,
    ),
    check(
      "allowed_email_domains_shape",
      sql`position('.' in ${table.domain}) > 1`,
    ),
  ],
);

export const operatorRoleDefinitions = pgTable(
  "operator_role_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    capabilities: text("capabilities")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    isSystem: boolean("is_system").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("operator_role_definitions_key_version_unique").on(
      table.key,
      table.version,
    ),
    uniqueIndex("operator_role_definitions_one_active_version")
      .on(table.key)
      .where(sql`${table.isActive} = true`),
    check(
      "operator_role_definitions_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_]{2,63}$'`,
    ),
    check(
      "operator_role_definitions_version_positive",
      sql`${table.version} > 0`,
    ),
    check(
      "operator_role_definitions_capabilities_nonempty",
      sql`cardinality(${table.capabilities}) > 0`,
    ),
  ],
);

export const operatorInvitations = pgTable(
  "operator_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id),
    email: text("email").notNull(),
    emailDomain: text("email_domain").notNull(),
    organizationId: text("organization_id").notNull(),
    intendedCapabilities: text("intended_capabilities")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    intendedRoleDefinitionId: uuid("intended_role_definition_id").references(
      () => operatorRoleDefinitions.id,
      { onDelete: "restrict" },
    ),
    invitedByOperatorId: uuid("invited_by_operator_id")
      .notNull()
      .references(() => operators.id),
    status: operatorInvitationStatus("status").notNull().default("pending"),
    tokenFingerprint: text("token_fingerprint").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    reason: text("reason").notNull(),
    approvalReference: text("approval_reference"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("operator_invitations_token_fingerprint_unique").on(
      table.tokenFingerprint,
    ),
    index("operator_invitations_operator_idx").on(table.operatorId),
    index("operator_invitations_inviter_idx").on(table.invitedByOperatorId),
    index("operator_invitations_role_definition_idx")
      .on(table.intendedRoleDefinitionId)
      .where(sql`${table.intendedRoleDefinitionId} IS NOT NULL`),
    index("operator_invitations_correlation_idx").on(table.correlationId),
    index("operator_invitations_pending_email_idx")
      .on(table.email, table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("operator_invitations_one_pending_per_operator")
      .on(table.operatorId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "operator_invitations_email_normalized",
      sql`${table.email} = lower(${table.email})`,
    ),
    check(
      "operator_invitations_email_shape",
      sql`${table.email} ~ '^[^@]+@[^@]+$'`,
    ),
    check(
      "operator_invitations_email_domain_matches",
      sql`${table.emailDomain} = split_part(${table.email}, '@', 2)`,
    ),
    check(
      "operator_invitations_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "operator_invitations_terminal_metadata",
      sql`(${table.status} <> 'accepted' OR ${table.acceptedAt} IS NOT NULL) AND (${table.status} <> 'revoked' OR ${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

export const operatorRoleAssignments = pgTable(
  "operator_role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    roleDefinitionId: uuid("role_definition_id")
      .notNull()
      .references(() => operatorRoleDefinitions.id, { onDelete: "restrict" }),
    assignedByOperatorId: uuid("assigned_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedByOperatorId: uuid("revoked_by_operator_id").references(
      () => operators.id,
      { onDelete: "restrict" },
    ),
    revokedReason: text("revoked_reason"),
    revokedCorrelationId: uuid("revoked_correlation_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("operator_role_assignments_active_unique")
      .on(table.operatorId, table.roleDefinitionId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("operator_role_assignments_operator_active_idx")
      .on(table.operatorId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("operator_role_assignments_role_definition_idx").on(
      table.roleDefinitionId,
    ),
    index("operator_role_assignments_correlation_idx").on(table.correlationId),
    check(
      "operator_role_assignments_revocation_metadata",
      sql`(${table.revokedAt} IS NULL AND ${table.revokedByOperatorId} IS NULL AND ${table.revokedReason} IS NULL AND ${table.revokedCorrelationId} IS NULL) OR (${table.revokedAt} IS NOT NULL AND ${table.revokedByOperatorId} IS NOT NULL AND ${table.revokedReason} IS NOT NULL AND ${table.revokedCorrelationId} IS NOT NULL)`,
    ),
  ],
);

export const operatorVerificationChallenges = pgTable(
  "operator_verification_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => operatorInvitations.id),
    status: verificationChallengeStatus("status").notNull().default("pending"),
    codeDigest: text("code_digest").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maximumAttempts: integer("maximum_attempts").notNull().default(5),
    resendSequence: integer("resend_sequence").notNull().default(0),
    correlationId: uuid("correlation_id").notNull(),
    deliveryProviderMessageId: text("delivery_provider_message_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("operator_verification_challenges_operator_idx").on(table.operatorId),
    index("operator_verification_challenges_invitation_idx").on(
      table.invitationId,
    ),
    index("operator_verification_challenges_correlation_idx").on(
      table.correlationId,
    ),
    index("operator_verification_challenges_pending_expiry_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("operator_verification_challenges_one_pending_per_operator")
      .on(table.operatorId)
      .where(sql`${table.status} = 'pending'`),
    check(
      "operator_verification_challenges_attempt_bounds",
      sql`${table.attemptCount} >= 0 AND ${table.maximumAttempts} BETWEEN 1 AND 10 AND ${table.attemptCount} <= ${table.maximumAttempts}`,
    ),
    check(
      "operator_verification_challenges_resend_nonnegative",
      sql`${table.resendSequence} >= 0`,
    ),
    check(
      "operator_verification_challenges_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "operator_verification_challenges_consumed_metadata",
      sql`${table.status} <> 'consumed' OR ${table.consumedAt} IS NOT NULL`,
    ),
  ],
);

export const platformConfigurationDefinitions = pgTable(
  "platform_configuration_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    valueType: platformConfigurationValueType("value_type").notNull(),
    validation: jsonb("validation")
      .$type<PlatformConfigurationValidation>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    defaultValue: jsonb("default_value")
      .$type<PlatformConfigurationValue>()
      .notNull(),
    isMutable: boolean("is_mutable").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_configuration_definitions_key_unique").on(table.key),
    index("platform_configuration_definitions_category_idx").on(
      table.category,
      table.key,
    ),
    check(
      "platform_configuration_definitions_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)+$'`,
    ),
    check(
      "platform_configuration_definitions_key_nonsecret",
      sql`${table.key} !~ '(^|[._-])(secret|password|token|credential|private[_-]?key|api[_-]?key|access[_-]?key|signing[_-]?key|hmac)([._-]|$)'`,
    ),
    check(
      "platform_configuration_definitions_category_normalized",
      sql`${table.category} = lower(${table.category}) AND ${table.category} ~ '^[a-z][a-z0-9_-]{1,63}$'`,
    ),
    check(
      "platform_configuration_definitions_validation_object",
      sql`jsonb_typeof(${table.validation}) = 'object'`,
    ),
    check(
      "platform_configuration_definitions_default_type",
      sql`(${table.valueType} = 'boolean' AND jsonb_typeof(${table.defaultValue}) = 'boolean') OR (${table.valueType} = 'integer' AND jsonb_typeof(${table.defaultValue}) = 'number') OR (${table.valueType} = 'string' AND jsonb_typeof(${table.defaultValue}) = 'string') OR (${table.valueType} = 'string_list' AND jsonb_typeof(${table.defaultValue}) = 'array' AND jsonb_array_length(${table.defaultValue}) > 0)`,
    ),
  ],
);

export const platformConfigurationRevisions = pgTable(
  "platform_configuration_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => platformConfigurationDefinitions.id, {
        onDelete: "restrict",
      }),
    revisionNumber: integer("revision_number").notNull(),
    scope: platformConfigurationScope("scope").notNull(),
    environment: platformConfigurationEnvironment("environment"),
    value: jsonb("value").$type<PlatformConfigurationValue>().notNull(),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_configuration_revisions_number_unique").on(
      table.definitionId,
      table.revisionNumber,
    ),
    index("platform_configuration_revisions_definition_created_idx").on(
      table.definitionId,
      table.createdAt,
    ),
    index("platform_configuration_revisions_correlation_idx").on(
      table.correlationId,
    ),
    check(
      "platform_configuration_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "platform_configuration_revisions_scope_environment",
      sql`(${table.scope} = 'platform' AND ${table.environment} IS NULL) OR (${table.scope} = 'environment' AND ${table.environment} IS NOT NULL)`,
    ),
    check(
      "platform_configuration_revisions_value_supported",
      sql`jsonb_typeof(${table.value}) IN ('boolean', 'number', 'string', 'array')`,
    ),
  ],
);

export const platformConfigurationBindings = pgTable(
  "platform_configuration_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => platformConfigurationDefinitions.id, {
        onDelete: "restrict",
      }),
    scope: platformConfigurationScope("scope").notNull(),
    environment: platformConfigurationEnvironment("environment"),
    currentRevisionId: uuid("current_revision_id")
      .notNull()
      .references(() => platformConfigurationRevisions.id, {
        onDelete: "restrict",
      }),
    updatedByOperatorId: uuid("updated_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_configuration_bindings_platform_unique")
      .on(table.definitionId)
      .where(sql`${table.scope} = 'platform'`),
    uniqueIndex("platform_configuration_bindings_environment_unique")
      .on(table.definitionId, table.environment)
      .where(sql`${table.scope} = 'environment'`),
    uniqueIndex("platform_configuration_bindings_revision_unique").on(
      table.currentRevisionId,
    ),
    index("platform_configuration_bindings_updated_by_idx").on(
      table.updatedByOperatorId,
    ),
    check(
      "platform_configuration_bindings_scope_environment",
      sql`(${table.scope} = 'platform' AND ${table.environment} IS NULL) OR (${table.scope} = 'environment' AND ${table.environment} IS NOT NULL)`,
    ),
  ],
);

export const platformSecretReferences = pgTable(
  "platform_secret_references",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    purpose: text("purpose").notNull(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    provider: platformSecretProvider("provider").notNull(),
    providerName: text("provider_name").notNull(),
    providerSecretId: text("provider_secret_id"),
    status: platformSecretReferenceStatus("status")
      .notNull()
      .default("provisioning"),
    currentVersionNumber: integer("current_version_number"),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    revokedByOperatorId: uuid("revoked_by_operator_id").references(
      () => operators.id,
      { onDelete: "restrict" },
    ),
    revokedReason: text("revoked_reason"),
    revokedCorrelationId: uuid("revoked_correlation_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_secret_references_key_environment_unique").on(
      table.key,
      table.environment,
    ),
    uniqueIndex("platform_secret_references_provider_name_unique").on(
      table.provider,
      table.providerName,
    ),
    uniqueIndex("platform_secret_references_provider_id_unique")
      .on(table.provider, table.providerSecretId)
      .where(sql`${table.providerSecretId} IS NOT NULL`),
    index("platform_secret_references_status_idx").on(
      table.environment,
      table.status,
    ),
    check(
      "platform_secret_references_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)+$'`,
    ),
    check(
      "platform_secret_references_no_value_columns",
      sql`${table.providerName} <> '' AND ${table.purpose} <> ''`,
    ),
    check(
      "platform_secret_references_active_metadata",
      sql`${table.status} NOT IN ('active', 'rotating', 'rotation_failed', 'revoking', 'revocation_failed', 'revoked') OR (${table.providerSecretId} IS NOT NULL AND ${table.currentVersionNumber} IS NOT NULL AND ${table.currentVersionNumber} > 0)`,
    ),
    check(
      "platform_secret_references_revocation_metadata",
      sql`(${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL AND ${table.revokedByOperatorId} IS NOT NULL AND ${table.revokedReason} IS NOT NULL AND ${table.revokedCorrelationId} IS NOT NULL) OR (${table.status} <> 'revoked' AND ${table.revokedAt} IS NULL AND ${table.revokedByOperatorId} IS NULL AND ${table.revokedReason} IS NULL AND ${table.revokedCorrelationId} IS NULL)`,
    ),
  ],
);

export const platformSecretVersions = pgTable(
  "platform_secret_versions",
  {
    id: uuid("id").primaryKey(),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => platformSecretReferences.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: platformSecretVersionStatus("status").notNull().default("pending"),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("platform_secret_versions_number_unique").on(
      table.referenceId,
      table.versionNumber,
    ),
    uniqueIndex("platform_secret_versions_correlation_unique").on(
      table.correlationId,
    ),
    uniqueIndex("platform_secret_versions_one_active")
      .on(table.referenceId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("platform_secret_versions_one_pending")
      .on(table.referenceId)
      .where(sql`${table.status} = 'pending'`),
    index("platform_secret_versions_reference_created_idx").on(
      table.referenceId,
      table.createdAt,
    ),
    check(
      "platform_secret_versions_number_positive",
      sql`${table.versionNumber} > 0`,
    ),
    check(
      "platform_secret_versions_terminal_metadata",
      sql`(${table.status} = 'pending' AND ${table.activatedAt} IS NULL AND ${table.retiredAt} IS NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.retiredAt} IS NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'retired' AND ${table.activatedAt} IS NOT NULL AND ${table.retiredAt} IS NOT NULL AND ${table.failedAt} IS NULL) OR (${table.status} = 'failed' AND ${table.activatedAt} IS NULL AND ${table.retiredAt} IS NULL AND ${table.failedAt} IS NOT NULL)`,
    ),
  ],
);

export const modelProviders = pgTable(
  "model_providers",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_providers_key_environment_unique").on(
      table.key,
      table.environment,
    ),
    index("model_providers_environment_updated_idx").on(
      table.environment,
      table.updatedAt,
    ),
    check(
      "model_providers_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_-]{1,63}$'`,
    ),
    check(
      "model_providers_revision_positive",
      sql`${table.currentRevisionNumber} > 0`,
    ),
  ],
);

export const modelProviderRevisions = pgTable(
  "model_provider_revisions",
  {
    id: uuid("id").primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProviders.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    displayName: text("display_name").notNull(),
    adapterKind: modelProviderAdapterKind("adapter_kind").notNull(),
    baseUrl: text("base_url"),
    credentialReferenceId: uuid("credential_reference_id").references(
      () => platformSecretReferences.id,
      { onDelete: "restrict" },
    ),
    regions: text("regions").array().notNull(),
    maximumDataClassification: modelDataClassification(
      "maximum_data_classification",
    ).notNull(),
    lifecycle: modelCatalogueLifecycle("lifecycle").notNull(),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_provider_revisions_number_unique").on(
      table.providerId,
      table.revisionNumber,
    ),
    uniqueIndex("model_provider_revisions_correlation_unique").on(
      table.correlationId,
    ),
    index("model_provider_revisions_provider_created_idx").on(
      table.providerId,
      table.createdAt,
    ),
    index("model_provider_revisions_credential_reference_idx")
      .on(table.credentialReferenceId)
      .where(sql`${table.credentialReferenceId} IS NOT NULL`),
    check(
      "model_provider_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "model_provider_revisions_name_nonempty",
      sql`length(btrim(${table.displayName})) BETWEEN 2 AND 120`,
    ),
    check(
      "model_provider_revisions_regions_nonempty",
      sql`cardinality(${table.regions}) BETWEEN 1 AND 32`,
    ),
    check(
      "model_provider_revisions_base_url_https",
      sql`${table.baseUrl} IS NULL OR ${table.baseUrl} ~ '^https://[^[:space:]@]+$'`,
    ),
  ],
);

export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProviders.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("models_provider_key_unique").on(table.providerId, table.key),
    index("models_provider_updated_idx").on(table.providerId, table.updatedAt),
    check(
      "models_key_shape",
      sql`${table.key} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'`,
    ),
    check("models_revision_positive", sql`${table.currentRevisionNumber} > 0`),
  ],
);

export const modelRevisions = pgTable(
  "model_revisions",
  {
    id: uuid("id").primaryKey(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    displayName: text("display_name").notNull(),
    kind: modelKind("kind").notNull(),
    capabilities: text("capabilities").array().notNull(),
    contextWindowTokens: integer("context_window_tokens").notNull(),
    maximumOutputTokens: integer("maximum_output_tokens"),
    inputPriceMicrounitsPerMillion: bigint(
      "input_price_microunits_per_million",
      { mode: "number" },
    ).notNull(),
    outputPriceMicrounitsPerMillion: bigint(
      "output_price_microunits_per_million",
      { mode: "number" },
    ).notNull(),
    currency: text("currency").notNull().default("USD"),
    regions: text("regions").array().notNull(),
    maximumDataClassification: modelDataClassification(
      "maximum_data_classification",
    ).notNull(),
    lifecycle: modelCatalogueLifecycle("lifecycle").notNull(),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_revisions_number_unique").on(
      table.modelId,
      table.revisionNumber,
    ),
    uniqueIndex("model_revisions_correlation_unique").on(table.correlationId),
    index("model_revisions_model_created_idx").on(
      table.modelId,
      table.createdAt,
    ),
    check("model_revisions_number_positive", sql`${table.revisionNumber} > 0`),
    check(
      "model_revisions_name_nonempty",
      sql`length(btrim(${table.displayName})) BETWEEN 2 AND 120`,
    ),
    check(
      "model_revisions_capabilities_nonempty",
      sql`cardinality(${table.capabilities}) > 0`,
    ),
    check(
      "model_revisions_regions_nonempty",
      sql`cardinality(${table.regions}) BETWEEN 1 AND 32`,
    ),
    check(
      "model_revisions_token_bounds",
      sql`${table.contextWindowTokens} > 0 AND ((${table.kind} = 'generation' AND ${table.maximumOutputTokens} > 0) OR (${table.kind} = 'embedding' AND ${table.maximumOutputTokens} IS NULL))`,
    ),
    check(
      "model_revisions_price_nonnegative",
      sql`${table.inputPriceMicrounitsPerMillion} >= 0 AND ${table.outputPriceMicrounitsPerMillion} >= 0`,
    ),
    check("model_revisions_currency_usd", sql`${table.currency} = 'USD'`),
  ],
);

export const modelProviderHealthObservations = pgTable(
  "model_provider_health_observations",
  {
    id: uuid("id").primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProviders.id, { onDelete: "restrict" }),
    status: modelProviderHealthStatus("status").notNull(),
    source: modelProviderHealthSource("source").notNull(),
    latencyMs: integer("latency_ms"),
    httpStatusCode: integer("http_status_code"),
    errorCode: text("error_code"),
    recordedByOperatorId: uuid("recorded_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_provider_health_correlation_unique").on(
      table.correlationId,
    ),
    index("model_provider_health_provider_observed_idx").on(
      table.providerId,
      table.observedAt,
    ),
    index("model_provider_health_expiry_idx").on(table.expiresAt),
    check(
      "model_provider_health_latency_bounds",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} BETWEEN 0 AND 120000`,
    ),
    check(
      "model_provider_health_http_status_bounds",
      sql`${table.httpStatusCode} IS NULL OR ${table.httpStatusCode} BETWEEN 100 AND 599`,
    ),
    check(
      "model_provider_health_error_code_shape",
      sql`${table.errorCode} IS NULL OR ${table.errorCode} ~ '^[a-z][a-z0-9_.-]{1,95}$'`,
    ),
    check(
      "model_provider_health_healthy_has_no_error",
      sql`${table.status} <> 'healthy' OR ${table.errorCode} IS NULL`,
    ),
    check(
      "model_provider_health_expiry_after_observation",
      sql`${table.expiresAt} > ${table.observedAt}`,
    ),
  ],
);

export const platformIntegrations = pgTable(
  "platform_integrations",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_integrations_key_environment_unique").on(
      table.key,
      table.environment,
    ),
    index("platform_integrations_environment_updated_idx").on(
      table.environment,
      table.updatedAt,
    ),
    check(
      "platform_integrations_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_-]{1,63}$'`,
    ),
    check(
      "platform_integrations_revision_positive",
      sql`${table.currentRevisionNumber} > 0`,
    ),
  ],
);

export const platformIntegrationRevisions = pgTable(
  "platform_integration_revisions",
  {
    id: uuid("id").primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => platformIntegrations.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    displayName: text("display_name").notNull(),
    protocol: platformIntegrationProtocol("protocol").notNull(),
    connectionMode:
      platformIntegrationConnectionMode("connection_mode").notNull(),
    capabilities: text("capabilities").array().notNull(),
    adapterPackage: text("adapter_package").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    documentationUrl: text("documentation_url"),
    authorizationUrl: text("authorization_url"),
    tokenUrl: text("token_url"),
    clientId: text("client_id"),
    clientSecretReferenceId: uuid("client_secret_reference_id").references(
      () => platformSecretReferences.id,
      { onDelete: "restrict" },
    ),
    webhookSecretReferenceId: uuid("webhook_secret_reference_id").references(
      () => platformSecretReferences.id,
      { onDelete: "restrict" },
    ),
    callbackUrls: text("callback_urls").array().notNull(),
    requiredScopes: text("required_scopes").array().notNull(),
    optionalScopes: text("optional_scopes").array().notNull(),
    lifecycle: platformIntegrationLifecycle("lifecycle").notNull(),
    operationalState:
      platformIntegrationOperationalState("operational_state").notNull(),
    maintenanceExpiresAt: timestamp("maintenance_expires_at", {
      withTimezone: true,
    }),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_integration_revisions_number_unique").on(
      table.integrationId,
      table.revisionNumber,
    ),
    uniqueIndex("platform_integration_revisions_correlation_unique").on(
      table.correlationId,
    ),
    index("platform_integration_revisions_integration_created_idx").on(
      table.integrationId,
      table.createdAt,
    ),
    index("platform_integration_revisions_client_secret_idx")
      .on(table.clientSecretReferenceId)
      .where(sql`${table.clientSecretReferenceId} IS NOT NULL`),
    index("platform_integration_revisions_webhook_secret_idx")
      .on(table.webhookSecretReferenceId)
      .where(sql`${table.webhookSecretReferenceId} IS NOT NULL`),
    check(
      "platform_integration_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "platform_integration_revisions_name_nonempty",
      sql`length(btrim(${table.displayName})) BETWEEN 2 AND 120`,
    ),
    check(
      "platform_integration_revisions_capabilities_nonempty",
      sql`cardinality(${table.capabilities}) BETWEEN 1 AND 16`,
    ),
    check(
      "platform_integration_revisions_callback_limit",
      sql`cardinality(${table.callbackUrls}) <= 16`,
    ),
    check(
      "platform_integration_revisions_scope_limit",
      sql`cardinality(${table.requiredScopes}) <= 64 AND cardinality(${table.optionalScopes}) <= 64`,
    ),
    check(
      "platform_integration_revisions_adapter_shape",
      sql`${table.adapterPackage} ~ '^@[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*$' AND ${table.adapterVersion} ~ '^[0-9]+\.[0-9]+\.[0-9]+'`,
    ),
    check(
      "platform_integration_revisions_https_urls",
      sql`(${table.documentationUrl} IS NULL OR ${table.documentationUrl} ~ '^https://[^[:space:]@]+$') AND (${table.authorizationUrl} IS NULL OR ${table.authorizationUrl} ~ '^https://[^[:space:]@]+$') AND (${table.tokenUrl} IS NULL OR ${table.tokenUrl} ~ '^https://[^[:space:]@]+$')`,
    ),
    check(
      "platform_integration_revisions_oauth_shape",
      sql`(${table.protocol} = 'oauth2' AND ${table.authorizationUrl} IS NOT NULL AND ${table.tokenUrl} IS NOT NULL AND ${table.clientId} IS NOT NULL AND cardinality(${table.callbackUrls}) > 0) OR (${table.protocol} <> 'oauth2' AND ${table.authorizationUrl} IS NULL AND ${table.tokenUrl} IS NULL AND ${table.clientId} IS NULL AND cardinality(${table.callbackUrls}) = 0 AND cardinality(${table.requiredScopes}) = 0 AND cardinality(${table.optionalScopes}) = 0)`,
    ),
    check(
      "platform_integration_revisions_active_oauth_secret",
      sql`${table.protocol} <> 'oauth2' OR ${table.lifecycle} <> 'active' OR ${table.clientSecretReferenceId} IS NOT NULL`,
    ),
    check(
      "platform_integration_revisions_maintenance_metadata",
      sql`(${table.operationalState} = 'maintenance' AND ${table.maintenanceExpiresAt} IS NOT NULL) OR (${table.operationalState} <> 'maintenance' AND ${table.maintenanceExpiresAt} IS NULL)`,
    ),
  ],
);

export const platformIntegrationHealthObservations = pgTable(
  "platform_integration_health_observations",
  {
    id: uuid("id").primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => platformIntegrations.id, { onDelete: "restrict" }),
    status: platformIntegrationHealthStatus("status").notNull(),
    source: platformIntegrationHealthSource("source").notNull(),
    latencyMs: integer("latency_ms"),
    httpStatusCode: integer("http_status_code"),
    errorCode: text("error_code"),
    recordedByOperatorId: uuid("recorded_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_integration_health_correlation_unique").on(
      table.correlationId,
    ),
    index("platform_integration_health_integration_observed_idx").on(
      table.integrationId,
      table.observedAt,
    ),
    index("platform_integration_health_expiry_idx").on(table.expiresAt),
    check(
      "platform_integration_health_latency_bounds",
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} BETWEEN 0 AND 120000`,
    ),
    check(
      "platform_integration_health_http_status_bounds",
      sql`${table.httpStatusCode} IS NULL OR ${table.httpStatusCode} BETWEEN 100 AND 599`,
    ),
    check(
      "platform_integration_health_error_code_shape",
      sql`${table.errorCode} IS NULL OR ${table.errorCode} ~ '^[a-z][a-z0-9_.-]{1,95}$'`,
    ),
    check(
      "platform_integration_health_healthy_has_no_error",
      sql`${table.status} <> 'healthy' OR ${table.errorCode} IS NULL`,
    ),
    check(
      "platform_integration_health_expiry_after_observation",
      sql`${table.expiresAt} > ${table.observedAt}`,
    ),
  ],
);

export const platformAdapterReleases = pgTable(
  "platform_adapter_releases",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    version: text("version").notNull(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_adapter_releases_identity_unique").on(
      table.key,
      table.version,
      table.environment,
    ),
    index("platform_adapter_releases_environment_updated_idx").on(
      table.environment,
      table.updatedAt,
    ),
    check(
      "platform_adapter_releases_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_-]{1,63}$'`,
    ),
    check(
      "platform_adapter_releases_version_shape",
      sql`${table.version} ~ '^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'`,
    ),
    check(
      "platform_adapter_releases_revision_positive",
      sql`${table.currentRevisionNumber} > 0`,
    ),
  ],
);

export const platformAdapterReleaseRevisions = pgTable(
  "platform_adapter_release_revisions",
  {
    id: uuid("id").primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => platformAdapterReleases.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    displayName: text("display_name").notNull(),
    category: platformAdapterCategory("category").notNull(),
    packageName: text("package_name").notNull(),
    packageDigestSha256: text("package_digest_sha256").notNull(),
    documentationUrl: text("documentation_url"),
    capabilities: jsonb("capabilities")
      .$type<ReadonlyArray<PlatformAdapterCapabilityDeclaration>>()
      .notNull(),
    declaredPermissions: text("declared_permissions").array().notNull(),
    configurationFields: jsonb("configuration_fields")
      .$type<ReadonlyArray<PlatformAdapterConfigurationField>>()
      .notNull(),
    commands: jsonb("commands")
      .$type<ReadonlyArray<PlatformAdapterCommandDeclaration>>()
      .notNull(),
    supportedEnvironments: text("supported_environments").array().notNull(),
    compatibilityTags: text("compatibility_tags").array().notNull(),
    requiredSecretPurposes: text("required_secret_purposes").array().notNull(),
    healthChecks: jsonb("health_checks")
      .$type<ReadonlyArray<PlatformAdapterHealthCheckDeclaration>>()
      .notNull(),
    releaseChannel: platformAdapterReleaseChannel("release_channel").notNull(),
    signatureStatus:
      platformAdapterSignatureStatus("signature_status").notNull(),
    securityReviewStatus: platformAdapterSecurityReviewStatus(
      "security_review_status",
    ).notNull(),
    securityReviewReference: text("security_review_reference"),
    lifecycle: platformAdapterLifecycle("lifecycle").notNull(),
    blockReason: text("block_reason"),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    sunsetAt: timestamp("sunset_at", { withTimezone: true }),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_adapter_release_revisions_number_unique").on(
      table.releaseId,
      table.revisionNumber,
    ),
    uniqueIndex("platform_adapter_release_revisions_correlation_unique").on(
      table.correlationId,
    ),
    index("platform_adapter_release_revisions_release_created_idx").on(
      table.releaseId,
      table.createdAt,
    ),
    index("platform_adapter_release_revisions_lifecycle_idx").on(
      table.lifecycle,
      table.releaseChannel,
    ),
    check(
      "platform_adapter_release_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "platform_adapter_release_revisions_name_nonempty",
      sql`length(btrim(${table.displayName})) BETWEEN 2 AND 120`,
    ),
    check(
      "platform_adapter_release_revisions_package_shape",
      sql`${table.packageName} ~ '^@[a-z0-9][a-z0-9_-]*/[a-z0-9][a-z0-9._-]*$' AND ${table.packageDigestSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "platform_adapter_release_revisions_documentation_https",
      sql`${table.documentationUrl} IS NULL OR ${table.documentationUrl} ~ '^https://[^[:space:]@]+$'`,
    ),
    check(
      "platform_adapter_release_revisions_json_arrays",
      sql`jsonb_typeof(${table.capabilities}) = 'array' AND jsonb_array_length(${table.capabilities}) = 8 AND jsonb_typeof(${table.configurationFields}) = 'array' AND jsonb_typeof(${table.commands}) = 'array' AND jsonb_typeof(${table.healthChecks}) = 'array'`,
    ),
    check(
      "platform_adapter_release_revisions_array_limits",
      sql`cardinality(${table.declaredPermissions}) <= 64 AND cardinality(${table.supportedEnvironments}) BETWEEN 1 AND 5 AND cardinality(${table.compatibilityTags}) <= 64 AND cardinality(${table.requiredSecretPurposes}) <= 32`,
    ),
    check(
      "platform_adapter_release_revisions_activation_evidence",
      sql`${table.lifecycle} <> 'active' OR (${table.signatureStatus} = 'verified' AND ${table.securityReviewStatus} = 'approved' AND ${table.securityReviewReference} IS NOT NULL)`,
    ),
    check(
      "platform_adapter_release_revisions_stable_active",
      sql`${table.releaseChannel} <> 'stable' OR ${table.lifecycle} = 'active'`,
    ),
    check(
      "platform_adapter_release_revisions_block_metadata",
      sql`(${table.lifecycle} = 'blocked' AND ${table.blockReason} IS NOT NULL) OR (${table.lifecycle} <> 'blocked' AND ${table.blockReason} IS NULL)`,
    ),
    check(
      "platform_adapter_release_revisions_unsafe_blocked",
      sql`(${table.signatureStatus} <> 'invalid' AND ${table.securityReviewStatus} <> 'rejected') OR ${table.lifecycle} = 'blocked'`,
    ),
    check(
      "platform_adapter_release_revisions_deprecation_metadata",
      sql`(${table.lifecycle} = 'deprecated' AND ${table.deprecatedAt} IS NOT NULL AND (${table.sunsetAt} IS NULL OR ${table.sunsetAt} > ${table.deprecatedAt})) OR (${table.lifecycle} <> 'deprecated' AND ${table.deprecatedAt} IS NULL AND ${table.sunsetAt} IS NULL)`,
    ),
  ],
);

export const modelRoutingPolicies = pgTable(
  "model_routing_policies",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_routing_policies_key_environment_unique").on(
      table.key,
      table.environment,
    ),
    index("model_routing_policies_environment_updated_idx").on(
      table.environment,
      table.updatedAt,
    ),
    check(
      "model_routing_policies_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_]{2,63}$'`,
    ),
    check(
      "model_routing_policies_revision_positive",
      sql`${table.currentRevisionNumber} > 0`,
    ),
  ],
);

export const modelRoutingPolicyRevisions = pgTable(
  "model_routing_policy_revisions",
  {
    id: uuid("id").primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => modelRoutingPolicies.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    displayName: text("display_name").notNull(),
    requiredCapabilities: text("required_capabilities").array().notNull(),
    maximumDataClassification: modelDataClassification(
      "maximum_data_classification",
    ).notNull(),
    allowedRegions: text("allowed_regions").array().notNull(),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_routing_policy_revisions_number_unique").on(
      table.policyId,
      table.revisionNumber,
    ),
    uniqueIndex("model_routing_policy_revisions_correlation_unique").on(
      table.correlationId,
    ),
    index("model_routing_policy_revisions_policy_created_idx").on(
      table.policyId,
      table.createdAt,
    ),
    check(
      "model_routing_policy_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "model_routing_policy_revisions_name_nonempty",
      sql`length(btrim(${table.displayName})) BETWEEN 2 AND 120`,
    ),
    check(
      "model_routing_policy_revisions_capabilities_nonempty",
      sql`cardinality(${table.requiredCapabilities}) BETWEEN 1 AND 7`,
    ),
    check(
      "model_routing_policy_revisions_regions_nonempty",
      sql`cardinality(${table.allowedRegions}) BETWEEN 1 AND 32`,
    ),
  ],
);

export const modelRoutingPolicyTargets = pgTable(
  "model_routing_policy_targets",
  {
    id: uuid("id").primaryKey(),
    policyRevisionId: uuid("policy_revision_id")
      .notNull()
      .references(() => modelRoutingPolicyRevisions.id, {
        onDelete: "restrict",
      }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "restrict" }),
    priority: integer("priority").notNull(),
    rolloutBasisPoints: integer("rollout_basis_points").notNull(),
    allowDegraded: boolean("allow_degraded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_routing_policy_targets_priority_unique").on(
      table.policyRevisionId,
      table.priority,
    ),
    uniqueIndex("model_routing_policy_targets_model_unique").on(
      table.policyRevisionId,
      table.modelId,
    ),
    index("model_routing_policy_targets_model_idx").on(table.modelId),
    check(
      "model_routing_policy_targets_priority_bounds",
      sql`${table.priority} BETWEEN 1 AND 16`,
    ),
    check(
      "model_routing_policy_targets_rollout_bounds",
      sql`${table.rolloutBasisPoints} BETWEEN 1 AND 10000`,
    ),
  ],
);

export const modelOperationalControls = pgTable(
  "model_operational_controls",
  {
    id: uuid("id").primaryKey(),
    targetKind: modelRoutingControlTargetKind("target_kind").notNull(),
    providerId: uuid("provider_id").references(() => modelProviders.id, {
      onDelete: "restrict",
    }),
    modelId: uuid("model_id").references(() => models.id, {
      onDelete: "restrict",
    }),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_operational_controls_provider_unique")
      .on(table.providerId)
      .where(sql`${table.providerId} IS NOT NULL`),
    uniqueIndex("model_operational_controls_model_unique")
      .on(table.modelId)
      .where(sql`${table.modelId} IS NOT NULL`),
    check(
      "model_operational_controls_target_shape",
      sql`(${table.targetKind} = 'provider' AND ${table.providerId} IS NOT NULL AND ${table.modelId} IS NULL) OR (${table.targetKind} = 'model' AND ${table.providerId} IS NULL AND ${table.modelId} IS NOT NULL)`,
    ),
    check(
      "model_operational_controls_revision_positive",
      sql`${table.currentRevisionNumber} > 0`,
    ),
  ],
);

export const modelOperationalControlRevisions = pgTable(
  "model_operational_control_revisions",
  {
    id: uuid("id").primaryKey(),
    controlId: uuid("control_id")
      .notNull()
      .references(() => modelOperationalControls.id, {
        onDelete: "restrict",
      }),
    revisionNumber: integer("revision_number").notNull(),
    state: modelRoutingControlState("state").notNull(),
    maintenanceExpiresAt: timestamp("maintenance_expires_at", {
      withTimezone: true,
    }),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("model_operational_control_revisions_number_unique").on(
      table.controlId,
      table.revisionNumber,
    ),
    uniqueIndex("model_operational_control_revisions_correlation_unique").on(
      table.correlationId,
    ),
    index("model_operational_control_revisions_control_created_idx").on(
      table.controlId,
      table.createdAt,
    ),
    check(
      "model_operational_control_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "model_operational_control_revisions_maintenance_metadata",
      sql`(${table.state} = 'maintenance' AND ${table.maintenanceExpiresAt} IS NOT NULL AND ${table.maintenanceExpiresAt} > ${table.createdAt}) OR (${table.state} <> 'maintenance' AND ${table.maintenanceExpiresAt} IS NULL)`,
    ),
  ],
);

export const platformFeatureFlags = pgTable(
  "platform_feature_flags",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    currentRevisionNumber: integer("current_revision_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_feature_flags_key_environment_unique").on(
      table.key,
      table.environment,
    ),
    index("platform_feature_flags_environment_updated_idx").on(
      table.environment,
      table.updatedAt,
    ),
    check(
      "platform_feature_flags_key_normalized",
      sql`${table.key} = lower(${table.key}) AND ${table.key} ~ '^[a-z][a-z0-9_.-]{2,95}$'`,
    ),
    check(
      "platform_feature_flags_revision_positive",
      sql`${table.currentRevisionNumber} > 0`,
    ),
  ],
);

export const platformFeatureFlagRevisions = pgTable(
  "platform_feature_flag_revisions",
  {
    id: uuid("id").primaryKey(),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => platformFeatureFlags.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    displayName: text("display_name").notNull(),
    purpose: text("purpose").notNull(),
    ownerOperatorId: uuid("owner_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    lifecycle: platformFeatureFlagLifecycle("lifecycle").notNull(),
    defaultEnabled: boolean("default_enabled").notNull(),
    emergencyDisabled: boolean("emergency_disabled").notNull(),
    rules: jsonb("rules")
      .$type<ReadonlyArray<PlatformFeatureFlagRule>>()
      .notNull(),
    reviewAt: timestamp("review_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByOperatorId: uuid("created_by_operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_feature_flag_revisions_number_unique").on(
      table.flagId,
      table.revisionNumber,
    ),
    uniqueIndex("platform_feature_flag_revisions_correlation_unique").on(
      table.correlationId,
    ),
    index("platform_feature_flag_revisions_flag_created_idx").on(
      table.flagId,
      table.createdAt,
    ),
    index("platform_feature_flag_revisions_review_idx").on(
      table.lifecycle,
      table.reviewAt,
      table.expiresAt,
    ),
    index("platform_feature_flag_revisions_owner_idx").on(
      table.ownerOperatorId,
      table.lifecycle,
    ),
    check(
      "platform_feature_flag_revisions_number_positive",
      sql`${table.revisionNumber} > 0`,
    ),
    check(
      "platform_feature_flag_revisions_name_nonempty",
      sql`length(btrim(${table.displayName})) BETWEEN 2 AND 120`,
    ),
    check(
      "platform_feature_flag_revisions_purpose_nonempty",
      sql`length(btrim(${table.purpose})) BETWEEN 8 AND 500`,
    ),
    check(
      "platform_feature_flag_revisions_rules_array",
      sql`jsonb_typeof(${table.rules}) = 'array' AND jsonb_array_length(${table.rules}) <= 50`,
    ),
    check(
      "platform_feature_flag_revisions_expiry_after_review",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.reviewAt}`,
    ),
  ],
);

export const platformCommands = pgTable(
  "platform_commands",
  {
    id: uuid("id").primaryKey(),
    environment: platformConfigurationEnvironment("environment").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => operators.id, { onDelete: "restrict" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    expectedTargetVersion: integer("expected_target_version"),
    payloadFingerprint: text("payload_fingerprint").notNull(),
    idempotencyFingerprint: text("idempotency_fingerprint").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    reason: text("reason").notNull(),
    approvalReference: text("approval_reference"),
    evidenceReferences: text("evidence_references")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_commands_idempotency_unique").on(
      table.environment,
      table.actorId,
      table.name,
      table.version,
      table.idempotencyFingerprint,
    ),
    uniqueIndex("platform_commands_correlation_unique").on(table.correlationId),
    index("platform_commands_actor_requested_idx").on(
      table.actorId,
      table.requestedAt,
    ),
    index("platform_commands_target_requested_idx").on(
      table.targetType,
      table.targetId,
      table.requestedAt,
    ),
    index("platform_commands_name_requested_idx").on(
      table.name,
      table.requestedAt,
    ),
    check(
      "platform_commands_name_normalized",
      sql`${table.name} = lower(${table.name}) AND ${table.name} ~ '^[a-z][a-z0-9_.-]{2,127}$'`,
    ),
    check(
      "platform_commands_target_type_normalized",
      sql`${table.targetType} = lower(${table.targetType}) AND ${table.targetType} ~ '^[a-z][a-z0-9_.-]{2,127}$'`,
    ),
    check("platform_commands_version_positive", sql`${table.version} > 0`),
    check(
      "platform_commands_expected_version_positive",
      sql`${table.expectedTargetVersion} IS NULL OR ${table.expectedTargetVersion} > 0`,
    ),
    check(
      "platform_commands_payload_fingerprint_sha256",
      sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "platform_commands_idempotency_fingerprint_sha256",
      sql`${table.idempotencyFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "platform_commands_reason_nonempty",
      sql`length(btrim(${table.reason})) BETWEEN 8 AND 500`,
    ),
    check(
      "platform_commands_evidence_bounded",
      sql`cardinality(${table.evidenceReferences}) <= 20`,
    ),
  ],
);

export const platformCommandResults = pgTable(
  "platform_command_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commandId: uuid("command_id")
      .notNull()
      .references(() => platformCommands.id, { onDelete: "restrict" }),
    outcome: platformCommandOutcome("outcome").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<PlatformJsonValue>().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_command_results_command_unique").on(table.commandId),
    index("platform_command_results_outcome_completed_idx").on(
      table.outcome,
      table.completedAt,
    ),
    check(
      "platform_command_results_http_status",
      sql`${table.responseStatus} BETWEEN 100 AND 599`,
    ),
    check(
      "platform_command_results_body_object",
      sql`jsonb_typeof(${table.responseBody}) = 'object'`,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => operators.id),
    commandId: uuid("command_id").references(() => platformCommands.id, {
      onDelete: "restrict",
    }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence")
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_actor_idx")
      .on(table.actorId)
      .where(sql`${table.actorId} IS NOT NULL`),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
    index("audit_events_command_idx")
      .on(table.commandId)
      .where(sql`${table.commandId} IS NOT NULL`),
    index("audit_events_correlation_idx").on(table.correlationId),
    index("audit_events_occurred_at_idx").on(table.occurredAt),
  ],
);
