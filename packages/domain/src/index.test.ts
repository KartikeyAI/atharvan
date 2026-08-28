import { describe, expect, it } from "vitest";

import { isCustomerPrivateCapability, platformWildcardMatches } from "./index";

describe("platform wildcard privacy boundary", () => {
  it("matches platform-plane capabilities", () => {
    expect(platformWildcardMatches("platform:models.disable")).toBe(true);
    expect(platformWildcardMatches("platform:runners.drain")).toBe(true);
  });

  it("never matches customer-private capabilities", () => {
    expect(platformWildcardMatches("customer-private:chat.read")).toBe(false);
    expect(platformWildcardMatches("customer-private:code.read")).toBe(false);
    expect(platformWildcardMatches("customer-private:secret.read")).toBe(false);
  });

  it("recognises the customer-private namespace explicitly", () => {
    expect(
      isCustomerPrivateCapability("customer-private:environment.read"),
    ).toBe(true);
    expect(isCustomerPrivateCapability("platform:environment.inspect")).toBe(
      false,
    );
  });
});
