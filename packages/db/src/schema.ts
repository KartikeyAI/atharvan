import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const operatorStatus = pgEnum("operator_status", [
  "invited",
  "verification_pending",
  "active",
  "suspended",
  "deactivated",
]);

export const operators = pgTable(
  "operators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    status: operatorStatus("status").notNull().default("invited"),
    isSuperAdministrator: boolean("is_super_administrator")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("operators_email_unique").on(table.email),
    uniqueIndex("operators_single_super_administrator")
      .on(table.isSuperAdministrator)
      .where(sql`${table.isSuperAdministrator} = true`),
  ],
);

export const allowedEmailDomains = pgTable(
  "allowed_email_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("allowed_email_domains_domain_unique").on(table.domain),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_target_idx").on(table.targetType, table.targetId),
    index("audit_events_occurred_at_idx").on(table.occurredAt),
  ],
);
