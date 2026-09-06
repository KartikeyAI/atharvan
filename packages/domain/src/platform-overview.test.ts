import { describe, expect, it } from "vitest";
import {
  buildPlatformOverview,
  summarizeHealth,
  type HealthEvidenceCounts,
} from "./platform-overview";

const empty: HealthEvidenceCounts = {
  total: 0,
  healthy: 0,
  degraded: 0,
  unavailable: 0,
  stale: 0,
  unknown: 0,
  latestObservedAt: null,
  nextExpiryAt: null,
};
const now = new Date("2026-09-04T00:00:00Z");

describe("health evidence summaries", () => {
  it.each([
    [empty, "unknown"],
    [{ ...empty, total: 1, healthy: 1 }, "healthy"],
    [{ ...empty, total: 2, healthy: 1, stale: 1 }, "partial"],
    [{ ...empty, total: 1, stale: 1 }, "unknown"],
    [{ ...empty, total: 1, degraded: 1 }, "degraded"],
    [{ ...empty, total: 2, degraded: 1, unavailable: 1 }, "action-required"],
  ] as const)("classifies mutually exclusive counts %#", (counts, status) => {
    expect(summarizeHealth("models", counts).status).toBe(status);
  });
  it("preserves read failures as null, not zero counts", () => {
    expect(summarizeHealth("integrations", null)).toEqual({
      source: "integrations",
      status: "error",
      counts: null,
    });
  });
  it("rejects inconsistent or negative counts", () => {
    expect(() => summarizeHealth("models", { ...empty, healthy: 1 })).toThrow(
      "invalid_health_counts",
    );
    expect(() =>
      summarizeHealth("models", { ...empty, healthy: -1, unknown: 1 }),
    ).toThrow("invalid_health_counts");
  });
  it("never labels incomplete platform coverage healthy and expires at the earliest probe", () => {
    const overview = buildPlatformOverview("development", now, [
      summarizeHealth("models", {
        ...empty,
        total: 1,
        healthy: 1,
        nextExpiryAt: "2026-09-04T00:00:03Z",
      }),
    ]);
    expect(overview.status).toBe("partial");
    expect(overview.validUntil).toBe("2026-09-04T00:00:03.000Z");
  });
  it("retains failures beside good evidence and reports total failure", () => {
    const error = summarizeHealth("integrations", null);
    expect(
      buildPlatformOverview("development", now, [
        summarizeHealth("models", empty),
        error,
      ]).status,
    ).toBe("degraded");
    expect(buildPlatformOverview("development", now, [error]).status).toBe(
      "error",
    );
  });
  it("rejects an already expired snapshot", () => {
    expect(() =>
      buildPlatformOverview("development", now, [
        summarizeHealth("models", {
          ...empty,
          nextExpiryAt: now.toISOString(),
        }),
      ]),
    ).toThrow("invalid_health_expiry");
  });
});
