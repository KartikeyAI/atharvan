import { describe, expect, it } from "vitest";
import { buildOperationalAlerts } from "./operational-alerts";
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
const configured = {
  emailDeliveryConfigured: true,
  secretProviderConfigured: true,
};

describe("operational alert rules", () => {
  it("does not invent alerts for empty registries or configured services", () => {
    expect(
      buildOperationalAlerts(
        "development",
        [summarizeHealth("models", empty)],
        configured,
      ),
    ).toEqual([]);
    expect(
      buildOperationalAlerts(
        "development",
        [summarizeHealth("models", { ...empty, total: 2, healthy: 2 })],
        configured,
      ),
    ).toEqual([]);
  });
  it("groups current signals by source/rule and orders critical signals first", () => {
    const counts = {
      ...empty,
      total: 10,
      unavailable: 1,
      degraded: 2,
      stale: 3,
      unknown: 4,
    };
    const evidence = [
      summarizeHealth("models", counts),
      summarizeHealth("integrations", counts),
    ];
    const alerts = buildOperationalAlerts("development", evidence);
    expect(alerts).toHaveLength(8);
    expect(alerts.slice(0, 2).map((alert) => alert.severity)).toEqual([
      "critical",
      "critical",
    ]);
    expect(
      alerts.find((alert) => alert.id === "development:models:stale")
        ?.affectedCount,
    ).toBe(3);
    expect(new Set(alerts.map((alert) => alert.id)).size).toBe(alerts.length);
    expect(
      buildOperationalAlerts("development", [...evidence].reverse()),
    ).toEqual(alerts);
  });
  it("distinguishes a failed read from failing services and unknown affected counts", () => {
    const [alert] = buildOperationalAlerts("development", [
      summarizeHealth("integrations", null),
    ]);
    expect(alert).toMatchObject({
      code: "read_failed",
      severity: "critical",
      affectedCount: null,
    });
    expect(alert?.description).toContain("cannot be determined");
  });
  it("replaces expired outages with evidence warnings, without claiming recovery", () => {
    const previous = buildOperationalAlerts("development", [
      summarizeHealth("models", { ...empty, total: 1, unavailable: 1 }),
    ]);
    const current = buildOperationalAlerts("development", [
      summarizeHealth("models", { ...empty, total: 1, stale: 1 }),
    ]);
    expect(previous[0]?.severity).toBe("critical");
    expect(current[0]).toMatchObject({ code: "stale", severity: "warning" });
    expect(current[0]?.description).toContain("no longer current evidence");
    expect(current.some((alert) => alert.code === "unavailable")).toBe(false);
  });
  it("clears signals after new healthy evidence and keeps IDs stable before recovery", () => {
    const failed = [
      summarizeHealth("models", { ...empty, total: 1, unavailable: 1 }),
    ];
    const first = buildPlatformOverview(
      "development",
      new Date("2026-09-04T00:00:00Z"),
      failed,
    );
    const second = buildPlatformOverview(
      "development",
      new Date("2026-09-04T00:00:05Z"),
      failed,
    );
    expect(first.alerts).toEqual(second.alerts);
    expect(
      buildOperationalAlerts("development", [
        summarizeHealth("models", { ...empty, total: 1, healthy: 1 }),
      ]),
    ).toEqual([]);
    expect(buildOperationalAlerts("production", failed)[0]?.id).not.toBe(
      first.alerts[0]?.id,
    );
  });
  it("reports missing foundation providers from booleans only", () => {
    const alerts = buildOperationalAlerts("development", [], {
      emailDeliveryConfigured: false,
      secretProviderConfigured: false,
    });
    expect(
      alerts.map((alert) => [
        alert.source,
        alert.severity,
        alert.affectedCount,
      ]),
    ).toEqual([
      ["email", "critical", null],
      ["secrets", "warning", null],
    ]);
    expect(alerts.every((alert) => alert.code === "not_configured")).toBe(true);
    expect(buildOperationalAlerts("development", [])).toEqual([]);
  });
});
