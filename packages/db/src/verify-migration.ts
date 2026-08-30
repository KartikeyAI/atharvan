import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to verify Atharvan migrations.");
}

const expectedTables = [
  "allowed_email_domains",
  "audit_events",
  "operator_invitations",
  "operator_verification_challenges",
  "operators",
  "platform_configuration_bindings",
  "platform_configuration_definitions",
  "platform_configuration_revisions",
  "platform_secret_references",
  "platform_secret_versions",
] as const;

const expectedIndexes = [
  "operators_auth_user_id_unique",
  "operators_single_super_administrator",
  "operator_invitations_one_pending_per_operator",
  "operator_verification_challenges_one_pending_per_operator",
  "operator_verification_challenges_correlation_idx",
  "platform_configuration_bindings_environment_unique",
  "platform_configuration_bindings_platform_unique",
  "platform_configuration_definitions_key_unique",
  "platform_configuration_revisions_number_unique",
  "platform_secret_references_key_environment_unique",
  "platform_secret_versions_one_active",
  "platform_secret_versions_one_pending",
] as const;

const expectedAuthTables = [
  "account",
  "rate_limit",
  "session",
  "user",
  "verification",
] as const;

const expectedAuthIndexes = [
  "auth_account_issuer_account_unique",
  "auth_rate_limit_key_unique",
  "auth_session_token_unique",
  "auth_user_email_unique",
] as const;

const expectedConstraints = [
  "operators_super_administrator_must_be_active",
  "platform_secret_references_active_metadata",
  "platform_secret_versions_terminal_metadata",
] as const;

const forbiddenSecretMaterialColumns = new Set([
  "value",
  "secret_value",
  "ciphertext",
  "value_hash",
  "value_preview",
]);

const expectedTriggers = [
  "platform_configuration_revisions_immutable",
  "platform_secret_references_no_delete",
  "platform_secret_versions_no_delete",
] as const;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});

try {
  const tableResult = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public'",
  );
  const indexResult = await pool.query<{ indexname: string }>(
    "select indexname from pg_indexes where schemaname = 'public'",
  );
  const constraintResult = await pool.query<{ constraint_name: string }>(
    "select constraint_name from information_schema.table_constraints where constraint_schema = 'public'",
  );
  const authTableResult = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'auth'",
  );
  const authIndexResult = await pool.query<{ indexname: string }>(
    "select indexname from pg_indexes where schemaname = 'auth'",
  );
  const triggerResult = await pool.query<{ trigger_name: string }>(
    "select trigger_name from information_schema.triggers where trigger_schema = 'public'",
  );
  const secretColumnResult = await pool.query<{
    table_name: string;
    column_name: string;
  }>(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('platform_secret_references', 'platform_secret_versions')",
  );
  const tableNames = new Set(tableResult.rows.map((row) => row.table_name));
  const indexNames = new Set(indexResult.rows.map((row) => row.indexname));
  const constraintNames = new Set(
    constraintResult.rows.map((row) => row.constraint_name),
  );
  const authTableNames = new Set(
    authTableResult.rows.map((row) => row.table_name),
  );
  const authIndexNames = new Set(
    authIndexResult.rows.map((row) => row.indexname),
  );
  const triggerNames = new Set(
    triggerResult.rows.map((row) => row.trigger_name),
  );

  for (const tableName of expectedTables) {
    if (!tableNames.has(tableName)) {
      throw new Error(`Missing migrated table: ${tableName}`);
    }
  }

  for (const indexName of expectedIndexes) {
    if (!indexNames.has(indexName)) {
      throw new Error(`Missing migrated index: ${indexName}`);
    }
  }

  for (const constraintName of expectedConstraints) {
    if (!constraintNames.has(constraintName)) {
      throw new Error(`Missing migrated constraint: ${constraintName}`);
    }
  }

  for (const triggerName of expectedTriggers) {
    if (!triggerNames.has(triggerName)) {
      throw new Error(`Missing migrated trigger: ${triggerName}`);
    }
  }

  for (const tableName of expectedAuthTables) {
    if (!authTableNames.has(tableName)) {
      throw new Error(`Missing migrated auth table: ${tableName}`);
    }
  }

  for (const indexName of expectedAuthIndexes) {
    if (!authIndexNames.has(indexName)) {
      throw new Error(`Missing migrated auth index: ${indexName}`);
    }
  }

  for (const column of secretColumnResult.rows) {
    if (forbiddenSecretMaterialColumns.has(column.column_name)) {
      throw new Error(
        `Secret material column must not exist: ${column.table_name}.${column.column_name}`,
      );
    }
  }
} finally {
  await pool.end();
}
