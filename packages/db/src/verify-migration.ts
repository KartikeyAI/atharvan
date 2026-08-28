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
] as const;

const expectedIndexes = [
  "operators_single_super_administrator",
  "operator_invitations_one_pending_per_operator",
  "operator_verification_challenges_one_pending_per_operator",
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
  const tableNames = new Set(tableResult.rows.map((row) => row.table_name));
  const indexNames = new Set(indexResult.rows.map((row) => row.indexname));

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
} finally {
  await pool.end();
}
