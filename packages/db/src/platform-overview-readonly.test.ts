import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  createPostgresPlatformOverviewReader,
  healthSummaryQuery,
} from "./platform-overview-reader";
import * as schema from "./schema";
import { integrationDatabaseFromEnvironment } from "./integration-environment";

/** Opt-in verification uses SELECT-only fixtures and never seeds the hosted database. */
describe.skipIf(process.env.ATHARVAN_RUN_OVERVIEW_READONLY !== "1")(
  "read-only PostgreSQL overview",
  () => {
    it("checks actual schema queries and latest-observation/freshness boundaries", async () => {
      const databaseUrl = process.env.ATHARVAN_TEST_DATABASE_URL
        ? integrationDatabaseFromEnvironment()
        : parseEnv(
            readFileSync(
              new URL("../../../.env.local", import.meta.url),
              "utf8",
            ),
          ).DATABASE_URL;
      if (!databaseUrl) throw new Error("DATABASE_URL is required");
      const pool = new pg.Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 10_000,
      });
      try {
        await pool.connect();
        await pool.query("BEGIN READ ONLY");
        const mode = await pool.query("SHOW transaction_read_only");
        expect(mode.rows[0].transaction_read_only).toBe("on");
        const live = await createPostgresPlatformOverviewReader(
          drizzle(pool, { schema }),
        ).read("development");
        expect(live.evidence).toHaveLength(2);
        expect(live.evidence.every((entry) => entry.counts !== null)).toBe(
          true,
        );

        for (const source of ["models", "integrations"] as const) {
          const foreignKey =
            source === "models" ? "provider_id" : "integration_id";
          const query = new PgDialect().sqlToQuery(
            healthSummaryQuery(
              source,
              "development",
              new Date("2026-09-04T00:00:00Z"),
            ),
          );
          const fixtureQuery = query.sql
            .replace(
              source === "models"
                ? "public.model_providers"
                : "public.platform_integrations",
              "registry_fixture",
            )
            .replace(
              source === "models"
                ? "public.model_provider_health_observations"
                : "public.platform_integration_health_observations",
              "observations_fixture",
            )
            .replace(
              "WITH evidence AS",
              `WITH registry_fixture(id, environment) AS (
            VALUES ('a','development'),('b','development'),('c','development'),('d','development'),('e','development'),('f','development'),('g','development'),('h','development'),('i','production')
          ), observation_values(id, ${foreignKey}, status, observed_at, expires_at, created_at) AS (
            VALUES
              ('1','a','healthy','2026-09-03 23:59:50Z','2026-09-04 00:00:10Z','2026-09-03 23:59:50Z'),
              ('2','b','degraded','2026-09-03 23:59:50Z','2026-09-04 00:00:20Z','2026-09-03 23:59:50Z'),
              ('3','c','unavailable','2026-09-03 23:59:50Z','2026-09-04 00:00:20Z','2026-09-03 23:59:50Z'),
              ('4','d','healthy','2026-09-03 23:59:50Z','2026-09-04 00:00:00Z','2026-09-03 23:59:50Z'),
              ('5','f','healthy','2026-09-04 00:00:01Z','2026-09-04 00:00:20Z','2026-09-04 00:00:01Z'),
              ('6','g','healthy','2026-09-03 23:59:40Z','2026-09-04 00:00:20Z','2026-09-03 23:59:40Z'),
              ('7','g','healthy','2026-09-03 23:59:50Z','2026-09-03 23:59:59Z','2026-09-03 23:59:50Z'),
              ('8','h','healthy','2026-09-03 23:59:50Z','2026-09-04 00:00:20Z','2026-09-03 23:59:50Z'),
              ('9','h','degraded','2026-09-03 23:59:50Z','2026-09-04 00:00:20Z','2026-09-03 23:59:50Z'),
              ('10','i','unavailable','2026-09-03 23:59:50Z','2026-09-04 00:00:20Z','2026-09-03 23:59:50Z')
          ), observations_fixture AS (
            SELECT id, ${foreignKey}, status, observed_at::timestamptz AS observed_at, expires_at::timestamptz AS expires_at, created_at::timestamptz AS created_at FROM observation_values
          ), evidence AS`,
            );
          const result = await pool.query(fixtureQuery, query.params);
          expect(result.rows[0]).toMatchObject({
            total: 8,
            healthy: 1,
            degraded: 2,
            unavailable: 1,
            stale: 2,
            unknown: 2,
          });
          expect(new Date(result.rows[0].nextExpiryAt).toISOString()).toBe(
            "2026-09-04T00:00:10.000Z",
          );
        }
      } finally {
        await pool.query("ROLLBACK").catch(() => undefined);
        await pool.end();
      }
    }, 30_000);
  },
);
