import { describe, expect, it } from "vitest";
import { resolveIntegrationDatabase } from "./integration-environment";

const target = "postgresql://tester:private-test-password@isolated.example/qa";
const valid = {
  ATHARVAN_TEST_DATABASE_URL: target,
  ATHARVAN_TEST_DATABASE_DISPOSABLE: "1",
};

describe("integration database isolation", () => {
  it("accepts an explicit disposable target without a local application file", () => {
    expect(resolveIntegrationDatabase(valid)).toBe(target);
  });
  it("accepts a distinct target while ignoring an ambient application URL", () => {
    expect(
      resolveIntegrationDatabase(
        { ...valid, DATABASE_URL: "postgresql://app:p@app.example/app" },
        "postgresql://app:p@app.example/app",
      ),
    ).toBe(target);
  });
  it.each([
    {},
    { ATHARVAN_TEST_DATABASE_URL: target },
    { ATHARVAN_TEST_DATABASE_DISPOSABLE: "1" },
    { ...valid, ATHARVAN_TEST_DATABASE_DISPOSABLE: "true" },
  ])("requires both target and disposable acknowledgement", (environment) => {
    expect(() => resolveIntegrationDatabase(environment)).toThrow(
      "Integration tests require",
    );
  });
  it.each(["isolated.example", "isolated-pooler.example"])(
    "rejects the application's direct or pooled endpoint %s",
    (host) => {
      expect(() =>
        resolveIntegrationDatabase(
          valid,
          `postgresql://different:p@${host}/another_database`,
        ),
      ).toThrow("separate database host");
    },
  );
  it.each([
    "private-credential",
    "https://user:private-secret@qa.example/db",
    "postgresql://qa.example/db",
    "postgresql://user:private-secret@qa.example/",
  ])("rejects malformed targets without disclosing credentials", (value) => {
    let error: unknown;
    try {
      resolveIntegrationDatabase({
        ...valid,
        ATHARVAN_TEST_DATABASE_URL: value,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The integration database configuration is invalid.",
    );
  });
});
