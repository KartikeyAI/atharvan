export interface FirstLoginVerificationMessage {
  readonly idempotencyKey?: string;
  readonly to: string;
  readonly code: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
  readonly templateVersion?: TransactionalEmailTemplateVersion;
  readonly locale?: TransactionalEmailLocale;
}

export type TransactionalEmailTemplateVersion = "v1" | "v2";
export type TransactionalEmailLocale = "en" | "hi";

export interface TransactionalEmailReceipt {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
}

export interface TransactionalEmailSender {
  sendFirstLoginVerification(
    message: FirstLoginVerificationMessage,
  ): Promise<TransactionalEmailReceipt>;
}

export interface ResendOperationalAlertSenderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
}

export function createResendOperationalAlertSender(
  options: ResendOperationalAlertSenderOptions,
): import("./operational-alert-delivery").OperationalAlertSender {
  const fetchImplementation = options.fetch ?? fetch;
  const apiKey = requireNonEmpty(options.apiKey, "resend_api_key_required");
  const from = requireNonEmpty(options.from, "email_from_required");
  return {
    async sendOperationalAlert(message) {
      const response = await fetchImplementation(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: renderOperationalAlertSubject(message),
            text: renderOperationalAlertText(message),
            html: renderOperationalAlertHtml(message),
            tags: [
              { name: "message_type", value: "operational_alert" },
              { name: "environment", value: message.environment },
              { name: "alert_source", value: message.alert.source },
              {
                name: "template_version",
                value: message.templateVersion ?? "v1",
              },
              { name: "template_locale", value: message.locale ?? "en" },
            ],
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new TransactionalEmailDeliveryError(response.status);
      }
      const body: unknown = await readBoundedProviderResponse(response);
      if (!hasProviderMessageId(body))
        throw new TransactionalEmailDeliveryError(response.status);
      return { providerMessageId: body.id };
    },
  };
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
            "idempotency-key":
              message.idempotencyKey ?? `atharvan/otp/${message.correlationId}`,
          },
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: renderVerificationSubject(message),
            text: renderVerificationText(message),
            html: renderVerificationHtml(message),
            tags: [
              { name: "message_type", value: "operator_verification" },
              { name: "correlation_id", value: message.correlationId },
              {
                name: "template_version",
                value: message.templateVersion ?? "v1",
              },
              { name: "template_locale", value: message.locale ?? "en" },
            ],
          }),
        },
      );

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new TransactionalEmailDeliveryError(response.status);
      }

      const body: unknown = await readBoundedProviderResponse(response);

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
  const locale = message.locale ?? "en";
  const version = message.templateVersion ?? "v1";
  if (locale === "hi")
    return [
      version === "v2"
        ? "Atharvan में सुरक्षित रूप से साइन इन करें"
        : "Atharvan में साइन इन करने के लिए इस सत्यापन कोड का उपयोग करें:",
      "",
      message.code,
      "",
      `यह कोड ${message.expiresAt.toISOString()} पर समाप्त होगा।`,
      "यदि आपने यह कोड नहीं मांगा है, तो इस ईमेल को अनदेखा करें।",
    ].join("\n");
  return [
    version === "v2"
      ? "Sign in securely to Atharvan with this verification code:"
      : "Use this verification code to sign in to Atharvan:",
    "",
    message.code,
    "",
    `This code expires at ${message.expiresAt.toISOString()}.`,
    "If you did not request this code, you can ignore this email.",
  ].join("\n");
}

function renderVerificationSubject(message: FirstLoginVerificationMessage) {
  if (message.locale === "hi") return "आपका Atharvan सत्यापन कोड";
  return message.templateVersion === "v2"
    ? "Sign in securely to Atharvan"
    : "Your Atharvan verification code";
}

function renderVerificationHtml(message: FirstLoginVerificationMessage) {
  return textToSafeHtml(renderVerificationText(message), message.code);
}

function renderOperationalAlertSubject(message: {
  kind: "triggered" | "resolved";
  environment: string;
  alert: { severity: string; title: string };
  templateVersion?: TransactionalEmailTemplateVersion;
  locale?: TransactionalEmailLocale;
}) {
  const state =
    message.kind === "resolved"
      ? "RECOVERED"
      : message.alert.severity.toUpperCase();
  const prefix =
    message.locale === "hi" && message.templateVersion === "v2"
      ? `[Atharvan ${message.environment}] ${state}: कार्रवाई आवश्यक`
      : `[Atharvan ${message.environment}] ${state}`;
  return `${prefix}: ${message.alert.title}`.slice(0, 200);
}

function renderOperationalAlertText(message: {
  kind: "triggered" | "resolved";
  environment: string;
  alert: {
    id: string;
    severity: string;
    affectedCount: number | null;
    title: string;
    description: string;
    nextStep: string;
  };
  firstSeenAt: Date;
  resolvedAt: Date | null;
  consoleOrigin: string;
  templateVersion?: TransactionalEmailTemplateVersion;
  locale?: TransactionalEmailLocale;
}) {
  if (message.locale === "hi")
    return [
      message.kind === "resolved"
        ? "संचालन चेतावनी ठीक हो गई"
        : "संचालन चेतावनी सक्रिय हुई",
      `परिवेश: ${message.environment}`,
      `गंभीरता: ${message.alert.severity}`,
      `चेतावनी: ${message.alert.title}`,
      `चेतावनी ID: ${message.alert.id}`,
      ...(message.alert.affectedCount === null
        ? []
        : [`प्रभावित रिकॉर्ड: ${message.alert.affectedCount}`]),
      `पहली बार: ${message.firstSeenAt.toISOString()}`,
      ...(message.resolvedAt
        ? [`समाधान समय: ${message.resolvedAt.toISOString()}`]
        : []),
      "",
      message.alert.description,
      "",
      `अगला कदम: ${message.alert.nextStep}`,
      `कंसोल: ${message.consoleOrigin}`,
    ].join("\n");
  return [
    message.kind === "resolved"
      ? "Operational alert recovered"
      : "Operational alert triggered",
    `Environment: ${message.environment}`,
    `Severity: ${message.alert.severity}`,
    `Alert: ${message.alert.title}`,
    `Alert ID: ${message.alert.id}`,
    ...(message.alert.affectedCount === null
      ? []
      : [`Affected records: ${message.alert.affectedCount}`]),
    `First seen: ${message.firstSeenAt.toISOString()}`,
    ...(message.resolvedAt
      ? [`Resolved: ${message.resolvedAt.toISOString()}`]
      : []),
    "",
    message.alert.description,
    "",
    `Next step: ${message.alert.nextStep}`,
    `Console: ${message.consoleOrigin}`,
  ].join("\n");
}

function renderOperationalAlertHtml(
  message: Parameters<
    ReturnType<
      typeof createResendOperationalAlertSender
    >["sendOperationalAlert"]
  >[0],
) {
  return textToSafeHtml(renderOperationalAlertText(message));
}

function textToSafeHtml(value: string, emphasizedLine?: string): string {
  return value
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line === emphasizedLine)
        return `<p style="font-size:24px;font-weight:700;letter-spacing:0.2em">${escaped}</p>`;
      return line.length === 0 ? "<br>" : `<p>${escaped}</p>`;
    })
    .join("");
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
    value.id.length > 0 &&
    value.id.length <= 256
  );
}

function requireNonEmpty(value: string, error: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(error);
  }

  return normalized;
}

/** Bound provider response memory and never propagate provider response text into logs. */
async function readBoundedProviderResponse(
  response: Response,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TransactionalEmailDeliveryError(response.status);
  try {
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 16_384)
        throw new TransactionalEmailDeliveryError(response.status);
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TransactionalEmailDeliveryError(response.status);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export * from "./verification-delivery";
export * from "./operational-alert-delivery";
export * from "./resend-webhook";
export * from "./recipient-policy";
