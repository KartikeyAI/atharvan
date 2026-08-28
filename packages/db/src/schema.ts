import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
