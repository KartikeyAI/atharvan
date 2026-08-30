import { describe, expect, it, vi } from "vitest";

import {
  createPlatformConfigurationAdministrationService,
  normalizePlatformConfigurationKey,
  PlatformConfigurationRejectedError,
  validatePlatformConfigurationValue,
} from "./platform-configuration";

const actor = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: true,
  effectiveCapabilities: ["platform:*"],
  stepUpVerifiedAt: new Date("2026-08-30T00:04:00.000Z"),
};

describe("platform configuration contracts", () => {
  it("validates each supported value type and declared constraints", () => {
    expect(
      validatePlatformConfigurationValue({
        value: 30,
        valueType: "integer",
        validation: { minimum: 5, maximum: 60 },
      }),
    ).toBe(30);
    expect(
      validatePlatformConfigurationValue({
        value: " stable ",
        valueType: "string",
        validation: { allowedValues: ["stable", "beta"] },
      }),
    ).toBe("stable");
    expect(
      validatePlatformConfigurationValue({
        value: ["ap-south-1", "eu-west-1"],
        valueType: "string_list",
        validation: {},
      }),
    ).toEqual(["ap-south-1", "eu-west-1"]);
    expect(() =>
      validatePlatformConfigurationValue({
        value: 61,
        valueType: "integer",
        validation: { maximum: 60 },
      }),
    ).toThrowError(
      new PlatformConfigurationRejectedError("configuration_value_invalid"),
    );
  });

  it("rejects secret-like keys from the control-plane registry", () => {
    expect(() =>
      normalizePlatformConfigurationKey("providers.openai.api_key"),
    ).toThrowError(
      new PlatformConfigurationRejectedError("configuration_key_sensitive"),
    );
    expect(normalizePlatformConfigurationKey("platform.release.channel")).toBe(
      "platform.release.channel",
    );
  });

  it("authorizes, validates, and scopes an environment revision", async () => {
    const store = {
      findConfigurationDefinition: vi.fn(async () => ({
        id: "00000000-0000-4000-8000-000000000201",
        key: "platform.session.maximum_age_minutes",
        valueType: "integer" as const,
        validation: { minimum: 15, maximum: 10_080 },
        isMutable: true,
      })),
      setConfiguration: vi.fn(async () => ({
        outcome: "updated" as const,
        key: "platform.session.maximum_age_minutes",
        revisionNumber: 2,
      })),
    };
    const service = createPlatformConfigurationAdministrationService({
      store,
      environment: "development",
      now: () => new Date("2026-08-30T00:05:00.000Z"),
    });

    await expect(
      service.setConfiguration({
        actor,
        key: "platform.session.maximum_age_minutes",
        scope: "environment",
        value: 120,
        reason: "Shorten development operator sessions.",
        correlationId: "00000000-0000-4000-8000-000000000299",
      }),
    ).resolves.toMatchObject({ outcome: "updated", revisionNumber: 2 });
    expect(store.setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "development",
        scope: "environment",
        value: 120,
      }),
    );
  });

  it("requires the singleton owner and a recent step-up", async () => {
    const store = {
      findConfigurationDefinition: vi.fn(),
      setConfiguration: vi.fn(),
    };
    const service = createPlatformConfigurationAdministrationService({
      store,
      environment: "development",
      now: () => new Date("2026-08-30T00:10:01.000Z"),
    });

    await expect(
      service.setConfiguration({
        actor,
        key: "platform.release.channel",
        scope: "platform",
        value: "stable",
        reason: "Keep the stable release channel.",
      }),
    ).rejects.toThrow("recent_step_up_required");
    expect(store.findConfigurationDefinition).not.toHaveBeenCalled();
  });
});
