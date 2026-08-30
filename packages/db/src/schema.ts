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

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => operators.id),
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
    index("audit_events_correlation_idx").on(table.correlationId),
    index("audit_events_occurred_at_idx").on(table.occurredAt),
  ],
);
