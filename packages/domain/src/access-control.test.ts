import { describe, expect, it } from "vitest";

import {
  assertDelegableOperatorCapabilities,
  assertPlatformCommandAuthorized,
  capabilityGrantMatches,
  type AuthenticatedOperator,
} from "./index";

const superAdministrator: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: new Date("2026-08-28T12:00:00.000Z"),
};

describe("operator access control", () => {
  it("matches platform wildcard grants without crossing the privacy boundary", () => {
    expect(
      capabilityGrantMatches("platform:*", "platform:operators:invite"),
    ).toBe(true);
    expect(
      capabilityGrantMatches("platform:*", "customer-private:chats:read"),
    ).toBe(false);
    expect(
      capabilityGrantMatches(
        "customer-private:*",
        "customer-private:repositories:read",
      ),
    ).toBe(false);
  });

  it("requires a recent step-up assertion for sensitive commands", () => {
    expect(() =>
      assertPlatformCommandAuthorized({
        actor: superAdministrator,
        requestedCapability: "platform:membership-domains:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: new Date("2026-08-28T12:04:59.000Z"),
      }),
    ).not.toThrow();

    expect(() =>
      assertPlatformCommandAuthorized({
        actor: superAdministrator,
        requestedCapability: "platform:membership-domains:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: new Date("2026-08-28T12:05:01.000Z"),
      }),
    ).toThrow("recent_step_up_required");
  });

  it("never delegates the singleton wildcard or customer-private access", () => {
    expect(() =>
      assertDelegableOperatorCapabilities(["platform:operators:read"]),
    ).not.toThrow();
    expect(() => assertDelegableOperatorCapabilities(["platform:*"])).toThrow(
      "invalid_operator_capabilities",
    );
    expect(() =>
      assertDelegableOperatorCapabilities(["customer-private:chats:read"]),
    ).toThrow("invalid_operator_capabilities");
  });
});
