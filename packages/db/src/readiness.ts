import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import type * as schema from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const currentAtharvanSchemaVersion = 28;
export const currentAtharvanMigrationTimestamp = "1788582524868";
export const currentAtharvanMigrationHash =
  "bba5ea2deba31f1ee23a6e2fae92cd011e9709acfb8e65f0de731887b16a29c7";

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
    writable: boolean;
    commandPrivileges: boolean;
    retentionPrivileges: boolean;
    cleanupPrivileges: boolean;
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
      current_setting('transaction_read_only') = 'off' AS writable,
      has_table_privilege(current_user, 'public.platform_commands', 'SELECT,INSERT,UPDATE') AS "commandPrivileges",
      has_table_privilege(current_user, 'public.operational_retention_runs', 'SELECT,INSERT,UPDATE') AS "retentionPrivileges",
      has_table_privilege(current_user, 'public.verification_email_deliveries', 'SELECT,DELETE') AS "cleanupPrivileges"
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
  if (!row.retentionTable || !row.retentionGuard)
    throw new Error("database_schema_sentinel_missing");
  if (
    !row.writable ||
    !row.commandPrivileges ||
    !row.retentionPrivileges ||
    !row.cleanupPrivileges
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
