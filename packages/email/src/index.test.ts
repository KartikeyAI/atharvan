import { describe, expect, it, vi } from "vitest";

import {
  TransactionalEmailDeliveryError,
  createResendTransactionalEmailSender,
} from "./index";

const message = {
  to: "operator@arth.example",
  code: "123456",
  expiresAt: new Date("2026-08-30T12:10:00.000Z"),
  correlationId: "d31b6672-cd98-46f0-8735-36cb3d49eb55",
};

describe("Resend transactional email sender", () => {
  it("sends the verification message without exposing the API key in content", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const sender = createResendTransactionalEmailSender({
      apiKey: "re_secret",
      from: "Atharvan <operators@arth.example>",
      fetch: fetchImplementation,
    });

    await expect(sender.sendFirstLoginVerification(message)).resolves.toEqual({
      providerMessageId: "email_123",
      acceptedAt: expect.any(Date),
    });
    const [, request] = fetchImplementation.mock.calls[0] ?? [];
    const serializedRequest = JSON.stringify(request);

    expect(request?.headers).toMatchObject({
      authorization: "Bearer re_secret",
    });
    expect(request?.body).toContain('"to":["operator@arth.example"]');
    expect(request?.body).toContain("123456");
    expect(request?.body).not.toContain("re_secret");
    expect(serializedRequest).toContain("Bearer re_secret");
  });

  it("fails closed when Resend rejects a delivery", async () => {
    const sender = createResendTransactionalEmailSender({
      apiKey: "re_secret",
      from: "operators@arth.example",
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("rate limited", { status: 429 })),
    });

    await expect(sender.sendFirstLoginVerification(message)).rejects.toEqual(
      new TransactionalEmailDeliveryError(429),
    );
  });
});
