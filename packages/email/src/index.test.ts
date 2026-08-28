import { describe, expect, it } from "vitest";

import {
  EmailDeliveryNotConfiguredError,
  unconfiguredTransactionalEmailSender,
} from "./index";

describe("transactional email boundary", () => {
  it("fails closed until a real provider adapter is configured", async () => {
    await expect(
      unconfiguredTransactionalEmailSender.sendFirstLoginVerification({
        to: "operator@rokad.co",
        code: "123456",
        expiresAt: new Date("2026-08-28T23:10:00.000Z"),
        correlationId: "correlation-1",
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryNotConfiguredError);
  });
});
