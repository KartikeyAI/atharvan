import {
  TransactionalEmailDeliveryError,
  type FirstLoginVerificationMessage,
  type TransactionalEmailLocale,
  type TransactionalEmailSender,
  type TransactionalEmailTemplateVersion,
} from "./index";

export type DeliveryEnvironment = "development" | "production" | "test";
export type VerificationDeliveryState =
  | "pending"
  | "leased"
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "expired"
  | "cancelled"
  | "dead_letter";
export interface VerificationDelivery {
  readonly id: string;
  readonly environment: DeliveryEnvironment;
  readonly verificationId: string;
  readonly encryptedPayload: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
  readonly recipientFingerprint: string;
  readonly templateVersion: TransactionalEmailTemplateVersion;
  readonly templateLocale: TransactionalEmailLocale;
}
export interface VerificationDeliveryLease extends VerificationDelivery {
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly attempts: number;
}
export interface VerificationDeliveryStore {
  findChallenge(
    email: string,
    digest: string,
  ): Promise<{ id: string; expiresAt: Date } | null>;
  enqueue(
    input: VerificationDelivery & { email: string; digest: string },
  ): Promise<boolean>;
  claim(
    environment: DeliveryEnvironment,
    id?: string,
  ): Promise<VerificationDeliveryLease | null>;
  isCurrent(
    input: VerificationDeliveryLease,
    email: string,
    digest: string,
  ): Promise<boolean>;
  settle(
    input: VerificationDeliveryLease,
    result: {
      state: "pending" | "accepted" | "expired" | "cancelled" | "dead_letter";
      reason: string;
      providerMessageId?: string;
      nextAttemptAt?: Date;
    },
  ): Promise<boolean>;
  expire(environment: DeliveryEnvironment): Promise<number>;
  isRecipientSuppressed(
    environment: DeliveryEnvironment,
    recipientFingerprint: string,
  ): Promise<boolean>;
}

interface SealedMessage {
  to: string;
  code: string;
  sender: string;
  templateVersion: TransactionalEmailTemplateVersion;
  locale: TransactionalEmailLocale;
}

/** AES-GCM is context-bound to the row and deadline; OTP plaintext never enters queue metadata. */
export function createVerificationDeliveryCipher(
  secret: string,
  environment: DeliveryEnvironment,
) {
  if (secret.length < 32) throw new Error("email_queue_secret_required");
  const encoder = new TextEncoder();
  async function getKey() {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(`atharvan:email-outbox:${environment}`),
        info: encoder.encode("verification-payload:v1"),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }
  const context = (row: Omit<VerificationDelivery, "encryptedPayload">) =>
    encoder.encode(
      JSON.stringify([
        "v1",
        row.environment,
        row.id,
        row.verificationId,
        row.expiresAt.toISOString(),
        row.correlationId,
      ]),
    );
  return {
    async seal(
      row: Omit<VerificationDelivery, "encryptedPayload">,
      message: SealedMessage,
    ): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: context(row) },
          await getKey(),
          encoder.encode(JSON.stringify(message)),
        ),
      );
      return `v1.${encode(iv)}.${encode(bytes)}`;
    },
    async open(row: VerificationDelivery): Promise<SealedMessage> {
      try {
        if (row.encryptedPayload.length > 8192) throw new Error();
        const [version, nonce, payload, extra] =
          row.encryptedPayload.split(".");
        if (version !== "v1" || !nonce || !payload || extra !== undefined)
          throw new Error();
        const iv = decode(nonce);
        if (iv.length !== 12) throw new Error();
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData: context(row) },
          await getKey(),
          decode(payload),
        );
        const value: unknown = JSON.parse(new TextDecoder().decode(plaintext));
        if (
          !value ||
          typeof value !== "object" ||
          !("to" in value) ||
          typeof value.to !== "string" ||
          !("code" in value) ||
          typeof value.code !== "string" ||
          !/^\d{6}$/.test(value.code) ||
          !("sender" in value) ||
          typeof value.sender !== "string" ||
          ("templateVersion" in value &&
            value.templateVersion !== "v1" &&
            value.templateVersion !== "v2") ||
          ("locale" in value && value.locale !== "en" && value.locale !== "hi")
        )
          throw new Error();
        return {
          to: value.to,
          code: value.code,
          sender: value.sender,
          templateVersion:
            "templateVersion" in value && value.templateVersion === "v2"
              ? "v2"
              : "v1",
          locale: "locale" in value && value.locale === "hi" ? "hi" : "en",
        };
      } catch {
        throw new Error("email_payload_unreadable");
      }
    },
  };
}

/** Persist acceptance before responding; request wake-ups only accelerate the scheduled worker. */
export function createVerificationDeliveryService(options: {
  store: VerificationDeliveryStore;
  environment: DeliveryEnvironment;
  cipher: ReturnType<typeof createVerificationDeliveryCipher>;
  digest: (code: string) => Promise<string>;
  sender: string;
  provider: TransactionalEmailSender | null;
  eligible: (email: string) => Promise<boolean>;
  recipientFingerprint: (email: string) => Promise<string>;
  template: () => Promise<{
    readonly templateVersion: TransactionalEmailTemplateVersion;
    readonly locale: TransactionalEmailLocale;
  }>;
}) {
  const { store, environment } = options;
  async function deliver(row: VerificationDeliveryLease) {
    let result: Parameters<VerificationDeliveryStore["settle"]>[1];
    try {
      const message = await options.cipher.open(row);
      if (message.sender !== options.sender) {
        result = { state: "dead_letter", reason: "sender_changed" };
      } else if (
        await store.isRecipientSuppressed(environment, row.recipientFingerprint)
      ) {
        result = { state: "cancelled", reason: "recipient_suppressed" };
      } else if (
        !(await options.eligible(message.to)) ||
        !(await store.isCurrent(
          row,
          message.to,
          await options.digest(message.code),
        ))
      ) {
        result = { state: "cancelled", reason: "challenge_no_longer_eligible" };
      } else if (row.expiresAt.getTime() - Date.now() <= 15_000) {
        result = { state: "expired", reason: "challenge_expired" };
      } else {
        if (row.leaseExpiresAt.getTime() - Date.now() <= 15_000) return;
        if (!options.provider) throw new Error("email_provider_unconfigured");
        const receipt = await options.provider.sendFirstLoginVerification({
          to: message.to,
          code: message.code,
          expiresAt: row.expiresAt,
          correlationId: row.correlationId,
          idempotencyKey: `atharvan/${environment}/otp/${row.id}`,
          templateVersion: message.templateVersion,
          locale: message.locale,
        });
        result = {
          state: "accepted",
          reason: "provider_accepted",
          providerMessageId: receipt.providerMessageId,
        };
      }
    } catch (error) {
      const unreadable =
        error instanceof Error && error.message === "email_payload_unreadable";
      const permanent =
        error instanceof TransactionalEmailDeliveryError &&
        error.status !== null &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 409, 429].includes(error.status);
      // Five attempts remain inside the OTP lifetime and Resend's 24-hour deduplication window.
      const exhausted = row.attempts >= 5;
      const delay =
        Math.min(120_000, 5_000 * 2 ** (row.attempts - 1)) +
        (crypto.getRandomValues(new Uint32Array(1))[0]! % 3_000);
      result =
        unreadable || permanent || exhausted
          ? {
              state: "dead_letter",
              reason: unreadable
                ? "payload_unreadable"
                : permanent
                  ? "provider_rejected"
                  : "retry_exhausted",
            }
          : {
              state: "pending",
              reason: "delivery_uncertain",
              nextAttemptAt: new Date(Date.now() + delay),
            };
    }
    // A database error here must escape: leave the lease for idempotent recovery.
    await store.settle(row, result);
  }
  return {
    async enqueue(
      message: FirstLoginVerificationMessage,
    ): Promise<string | null> {
      const digest = await options.digest(message.code);
      const challenge = await store.findChallenge(message.to, digest);
      if (!challenge) return null; // A concurrent resend/consumption superseded this callback.
      const template = await options.template();
      const row = {
        id: crypto.randomUUID(),
        environment,
        verificationId: challenge.id,
        expiresAt: challenge.expiresAt,
        correlationId: message.correlationId,
        recipientFingerprint: await options.recipientFingerprint(message.to),
        templateVersion: template.templateVersion,
        templateLocale: template.locale,
      };
      const encryptedPayload = await options.cipher.seal(row, {
        to: message.to,
        code: message.code,
        sender: options.sender,
        templateVersion: row.templateVersion,
        locale: row.templateLocale,
      });
      return (await store.enqueue({
        ...row,
        encryptedPayload,
        email: message.to,
        digest,
      }))
        ? row.id
        : null;
    },
    async run(limit = 8, id?: string): Promise<void> {
      await store.expire(environment);
      if (!options.provider) return; // Preserve attempts while configuration is absent.
      const count = Math.max(1, Math.min(8, Math.floor(limit)));
      for (let index = 0; index < count; index++) {
        const row = await store.claim(environment, id);
        if (!row) return;
        await deliver(row);
      }
    },
  };
}

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );
}
