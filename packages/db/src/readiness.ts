import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import type * as schema from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const currentAtharvanSchemaVersion = 31;
export const currentAtharvanMigrationTimestamp = "1788769518101";
export const currentAtharvanMigrationHash =
  "a6e50ce47ebf21cd25841bcb2801ee1a3581c801f1a482cbe79d178471b41a6e";

export interface DatabaseReadinessEvidence {
  readonly schemaVersion: number;
  readonly checkedAt: string;
}

/** Verify the exact migration head and required write privileges without mutating state. */
export async function checkPostgresReadiness(
  database: Database,
): Promise<DatabaseReadinessEvidence> {
  const result = await database.execute<{
    hash: string;
    createdAt: string;
    checkedAt: string;
    retentionTable: boolean;
    retentionGuard: boolean;
    commercialTable: boolean;
    commercialGuard: boolean;
    entitlementTable: boolean;
    entitlementGuard: boolean;
    billingTable: boolean;
    billingGuard: boolean;
    writable: boolean;
    commandPrivileges: boolean;
    retentionPrivileges: boolean;
    cleanupPrivileges: boolean;
    commercialPrivileges: boolean;
    entitlementPrivileges: boolean;
    billingPrivileges: boolean;
  }>(sql`SELECT
      migration.hash,
      migration.created_at::text AS "createdAt",
      clock_timestamp()::text AS "checkedAt",
      to_regclass('public.operational_retention_runs') IS NOT NULL AS "retentionTable",
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('public.operational_retention_runs')
          AND tgname = 'operational_retention_runs_guard'
          AND NOT tgisinternal
      ) AS "retentionGuard",
      to_regclass('public.commercial_plan_versions') IS NOT NULL AS "commercialTable",
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('public.commercial_plan_versions')
          AND tgname = 'commercial_plan_versions_immutable'
          AND NOT tgisinternal
      ) AS "commercialGuard",
      to_regclass('public.workspace_entitlement_snapshots') IS NOT NULL AS "entitlementTable",
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('public.workspace_entitlement_snapshots')
          AND tgname = 'workspace_entitlement_snapshots_immutable'
          AND NOT tgisinternal
      ) AS "entitlementGuard",
      to_regclass('public.workspace_billing_subscriptions') IS NOT NULL AS "billingTable",
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = to_regclass('public.workspace_billing_subscription_revisions')
          AND tgname = 'workspace_billing_subscription_revisions_immutable'
          AND NOT tgisinternal
      ) AS "billingGuard",
      current_setting('transaction_read_only') = 'off' AS writable,
      has_table_privilege(current_user, 'public.platform_commands', 'SELECT,INSERT,UPDATE') AS "commandPrivileges",
      has_table_privilege(current_user, 'public.operational_retention_runs', 'SELECT,INSERT,UPDATE') AS "retentionPrivileges",
      has_table_privilege(current_user, 'public.verification_email_deliveries', 'SELECT,DELETE') AS "cleanupPrivileges",
      has_table_privilege(current_user, 'public.commercial_products', 'SELECT,INSERT,UPDATE')
        AND has_table_privilege(current_user, 'public.commercial_product_revisions', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.commercial_plans', 'SELECT,INSERT,UPDATE')
        AND has_table_privilege(current_user, 'public.commercial_plan_versions', 'SELECT,INSERT') AS "commercialPrivileges",
      has_table_privilege(current_user, 'public.commercial_plan_entitlement_sets', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.commercial_plan_entitlement_values', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.workspace_entitlement_assignments', 'SELECT,INSERT,UPDATE')
        AND has_table_privilege(current_user, 'public.workspace_entitlement_snapshots', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.workspace_entitlement_snapshot_layers', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.workspace_enterprise_entitlement_grants', 'SELECT,INSERT,UPDATE')
        AND has_table_privilege(current_user, 'public.workspace_enterprise_entitlement_grant_revisions', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.workspace_entitlement_observations', 'SELECT,INSERT') AS "entitlementPrivileges"
      , has_table_privilege(current_user, 'public.billing_checkout_requests', 'SELECT,INSERT,UPDATE')
        AND has_table_privilege(current_user, 'public.workspace_billing_subscriptions', 'SELECT,INSERT,UPDATE')
        AND has_table_privilege(current_user, 'public.billing_provider_subscription_bindings', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.workspace_billing_subscription_revisions', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.billing_subscription_observations', 'SELECT,INSERT')
        AND has_table_privilege(current_user, 'public.billing_subscription_reconciliation_jobs', 'SELECT,INSERT,UPDATE') AS "billingPrivileges"
    FROM atharvan_migrations.history AS migration
    ORDER BY migration.created_at DESC, migration.id DESC
    LIMIT 1`);
  if (
    typeof result !== "object" ||
    result === null ||
    !("rows" in result) ||
    !Array.isArray(result.rows)
  )
    throw new Error("database_readiness_result_invalid");
  const row = result.rows[0];
  if (!row) throw new Error("database_migration_history_missing");
  if (
    row.hash !== currentAtharvanMigrationHash ||
    row.createdAt !== currentAtharvanMigrationTimestamp
  )
    throw new Error("database_migration_head_mismatch");
  if (
    !row.retentionTable ||
    !row.retentionGuard ||
    !row.commercialTable ||
    !row.commercialGuard ||
    !row.entitlementTable ||
    !row.entitlementGuard ||
    !row.billingTable ||
    !row.billingGuard
  )
    throw new Error("database_schema_sentinel_missing");
  if (
    !row.writable ||
    !row.commandPrivileges ||
    !row.retentionPrivileges ||
    !row.cleanupPrivileges ||
    !row.commercialPrivileges ||
    !row.entitlementPrivileges ||
    !row.billingPrivileges
  )
    throw new Error("database_write_authority_unavailable");
  const checkedAt = new Date(row.checkedAt);
  if (!Number.isFinite(checkedAt.getTime()))
    throw new Error("database_clock_unavailable");
  return {
    schemaVersion: currentAtharvanSchemaVersion,
    checkedAt: checkedAt.toISOString(),
  };
}
