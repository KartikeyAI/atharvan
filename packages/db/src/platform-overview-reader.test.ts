import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createPostgresPlatformOverviewReader,
  healthSummaryQuery,
} from "./platform-overview-reader";

const now = new Date("2026-09-04T00:00:00Z");
const empty = {
  total: 0,
  healthy: 0,
  degraded: 0,
  unavailable: 0,
  stale: 0,
  unknown: 0,
  latestObservedAt: null,
  nextExpiryAt: null,
};
type Database = Parameters<typeof createPostgresPlatformOverviewReader>[0];

describe("platform overview reader", () => {
  it.each(["models", "integrations"] as const)(
    "binds environment and freshness boundaries for %s",
    (source) => {
      const query = new PgDialect().sqlToQuery(
        healthSummaryQuery(source, "development", now),
      );
      expect(query.params).toContain("development");
      expect(query.params).toContain(now.toISOString());
      expect(query.sql).not.toContain("'development'");
      expect(query.sql).toContain(
        "ORDER BY observed_at DESC, created_at DESC, id DESC LIMIT 1",
      );
      expect(query.sql).toContain("h.expires_at <=");
      expect(query.sql).toContain("h.observed_at >");
    },
  );
  it("keeps an empty registry unknown", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [empty] });
    const result = await createPostgresPlatformOverviewReader({
      execute,
    } as unknown as Database).read("development", now, {
      includeHistory: false,
    });
    expect(result.status).toBe("unknown");
    expect(result.evidence).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("isolates a failed source without exposing its database error", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("private connection details"))
      .mockResolvedValueOnce({ rows: [empty] });
    const result = await createPostgresPlatformOverviewReader({
      execute,
    } as unknown as Database).read("development", now, {
      includeHistory: false,
    });
    expect(result.status).toBe("degraded");
    expect(result.evidence[0]).toEqual({
      source: "models",
      status: "error",
      counts: null,
    });
    expect(result.evidence[1]?.counts?.total).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("does not publish malformed counts as healthy", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ ...empty, healthy: 1 }] });
    expect(
      (
        await createPostgresPlatformOverviewReader({
          execute,
        } as unknown as Database).read("development", now, {
          includeHistory: false,
        })
      ).status,
    ).toBe("error");
  });
});
