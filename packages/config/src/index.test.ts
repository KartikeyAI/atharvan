import { describe, expect, it } from "vitest";

import { parseRuntimeConfig } from "./index";

describe("runtime configuration", () => {
  it("accepts explicit non-secret runtime configuration", () => {
    expect(
      parseRuntimeConfig({
        ATHARVAN_ENVIRONMENT: "development",
        ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.example",
      }),
    ).toEqual({
      ATHARVAN_ENVIRONMENT: "development",
      ATHARVAN_PUBLIC_ORIGIN: "https://dev.atharvan.example",
    });
  });

  it("rejects an invalid origin", () => {
    expect(() =>
      parseRuntimeConfig({
        ATHARVAN_ENVIRONMENT: "production",
        ATHARVAN_PUBLIC_ORIGIN: "not-a-url",
      }),
    ).toThrow();
  });
});
