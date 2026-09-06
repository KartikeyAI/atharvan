import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildOperationalAlerts } from "@atharvan/domain";
import { OperationalAlerts } from "./operational-alerts";

const alerts = buildOperationalAlerts("development", [], {
  emailDeliveryConfigured: false,
  secretProviderConfigured: false,
});

describe("operational alert presentation", () => {
  it("shows severity and recovery guidance without manufacturing affected counts", () => {
    const html = renderToStaticMarkup(
      <OperationalAlerts
        alerts={alerts}
        filter="all"
        onFilterChange={() => {}}
      />,
    );
    expect(html).toContain("Email delivery is not configured");
    expect(html).toContain("Secret management is not configured");
    expect(html).toContain("Recovery steps");
    expect(html).not.toContain("Affected entries:");
  });
  it("filters warnings from the critical view and exposes the selected control", () => {
    const html = renderToStaticMarkup(
      <OperationalAlerts
        alerts={alerts}
        filter="critical"
        onFilterChange={() => {}}
      />,
    );
    expect(html).toContain("Email delivery is not configured");
    expect(html).not.toContain("Secret management is not configured");
    expect(html).toContain('aria-pressed="true">Critical (1)');
  });
  it("keeps an empty alert view distinct from verified platform health", () => {
    const html = renderToStaticMarkup(
      <OperationalAlerts alerts={[]} filter="all" onFilterChange={() => {}} />,
    );
    expect(html).toContain(
      "Unconnected sources and untested services remain unknown",
    );
    expect(html).not.toContain("All systems operational");
  });
});
