export interface FirstLoginVerificationMessage {
  readonly to: string;
  readonly code: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

export interface TransactionalEmailReceipt {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
}

export interface TransactionalEmailSender {
  sendFirstLoginVerification(
    message: FirstLoginVerificationMessage,
  ): Promise<TransactionalEmailReceipt>;
}

export class EmailDeliveryNotConfiguredError extends Error {
  override readonly name = "EmailDeliveryNotConfiguredError";

  constructor() {
    super("Transactional email delivery is not configured.");
  }
}

export class TransactionalEmailDeliveryError extends Error {
  override readonly name = "TransactionalEmailDeliveryError";

  constructor(readonly status: number | null) {
    super("The transactional email provider rejected the delivery request.");
  }
}

export interface ResendTransactionalEmailSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
}

export function createResendTransactionalEmailSender(
  options: ResendTransactionalEmailSenderOptions,
): TransactionalEmailSender {
  const fetchImplementation = options.fetch ?? fetch;
  const apiKey = requireNonEmpty(options.apiKey, "resend_api_key_required");
  const from = requireNonEmpty(options.from, "email_from_required");

  return {
    async sendFirstLoginVerification(message) {
      const response = await fetchImplementation(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: "Your Atharvan verification code",
            text: renderVerificationText(message),
            html: renderVerificationHtml(message),
            tags: [
              { name: "message_type", value: "operator_verification" },
              { name: "correlation_id", value: message.correlationId },
            ],
          }),
        },
      );

      if (!response.ok) {
        throw new TransactionalEmailDeliveryError(response.status);
      }

      const body: unknown = await response.json();

      if (!hasProviderMessageId(body)) {
        throw new TransactionalEmailDeliveryError(response.status);
      }

      return {
        providerMessageId: body.id,
        acceptedAt: new Date(),
      };
    },
  };
}

export const unconfiguredTransactionalEmailSender: TransactionalEmailSender = {
  sendFirstLoginVerification() {
    return Promise.reject(new EmailDeliveryNotConfiguredError());
  },
};

function renderVerificationText(message: FirstLoginVerificationMessage) {
  return [
    "Use this verification code to sign in to Atharvan:",
    "",
    message.code,
    "",
    `This code expires at ${message.expiresAt.toISOString()}.`,
    "If you did not request this code, you can ignore this email.",
  ].join("\n");
}

function renderVerificationHtml(message: FirstLoginVerificationMessage) {
  const code = escapeHtml(message.code);
  const expiresAt = escapeHtml(message.expiresAt.toISOString());

  return `<p>Use this verification code to sign in to Atharvan:</p><p style="font-size:24px;font-weight:700;letter-spacing:0.2em">${code}</p><p>This code expires at ${expiresAt}.</p><p>If you did not request this code, you can ignore this email.</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasProviderMessageId(
  value: unknown,
): value is { readonly id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

function requireNonEmpty(value: string, error: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(error);
  }

  return normalized;
}
