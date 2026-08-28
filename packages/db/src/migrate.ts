import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required to run Atharvan migrations.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});
const client = await pool.connect();

try {
  await client.query(
    "select pg_advisory_lock($1::integer, $2::integer)",
    [1_095_785_041, 1],
  );

  try {
    const database = drizzle({ client });

    await migrate(database, {
      migrationsFolder: fileURLToPath(
        new URL("../../../migrations", import.meta.url),
      ),
      migrationsSchema: "atharvan_migrations",
      migrationsTable: "history",
    });
  } finally {
    await client.query(
      "select pg_advisory_unlock($1::integer, $2::integer)",
      [1_095_785_041, 1],
    );
  }
} finally {
  client.release();
  await pool.end();
}
