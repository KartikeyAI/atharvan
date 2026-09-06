export type AlertDeliveryEnvironment = "development" | "production" | "test";
export type AlertDeliveryKind = "triggered" | "resolved";
export type OperationalAlertDeliveryState =
  | "pending"
  | "leased"
  | "accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "dead_letter";

export interface RoutableOperationalAlert {
  readonly id: string;
  readonly source: string;
  readonly code: string;
  readonly severity: "critical" | "warning";
  readonly affectedCount: number | null;
  readonly title: string;
  readonly description: string;
  readonly nextStep: string;
}

export interface OperationalAlertDeliveryLease {
  readonly id: string;
  readonly occurrenceId: string;
  readonly environment: AlertDeliveryEnvironment;
  readonly kind: AlertDeliveryKind;
  readonly alert: RoutableOperationalAlert;
  readonly firstSeenAt: Date;
  readonly resolvedAt: Date | null;
  readonly attempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
  readonly recipientFingerprint: string;
  readonly templateVersion: import("./index").TransactionalEmailTemplateVersion;
  readonly templateLocale: import("./index").TransactionalEmailLocale;
}

export interface OperationalAlertDeliveryHealth {
  readonly observedAt: string;
  readonly pending: number;
  readonly leased: number;
  readonly deadLetters: number;
  readonly bounced: number;
  readonly complained: number;
  readonly oldestPendingAt: string | null;
}

export interface OperationalAlertDeliveryStore {
  /** Reconcile one complete current snapshot and enqueue only state transitions. */
  reconcile(
    environment: AlertDeliveryEnvironment,
    alerts: ReadonlyArray<RoutableOperationalAlert>,
    observedAt: Date,
    deliveryIdentity: {
      readonly recipientFingerprint: string;
      readonly templateVersion: import("./index").TransactionalEmailTemplateVersion;
      readonly templateLocale: import("./index").TransactionalEmailLocale;
    },
  ): Promise<{ opened: number; resolved: number }>;
  claim(
    environment: AlertDeliveryEnvironment,
  ): Promise<OperationalAlertDeliveryLease | null>;
  settle(
    lease: OperationalAlertDeliveryLease,
    result:
      | { readonly state: "accepted"; readonly providerMessageId: string }
      | { readonly state: "pending"; readonly nextAttemptAt: Date }
      | { readonly state: "dead_letter"; readonly reason: string },
  ): Promise<boolean>;
  health(
    environment: AlertDeliveryEnvironment,
  ): Promise<OperationalAlertDeliveryHealth>;
  isRecipientSuppressed(
    environment: AlertDeliveryEnvironment,
    recipientFingerprint: string,
  ): Promise<boolean>;
}

export interface OperationalAlertSender {
  sendOperationalAlert(input: {
    readonly to: string;
    readonly environment: AlertDeliveryEnvironment;
    readonly kind: AlertDeliveryKind;
    readonly alert: RoutableOperationalAlert;
    readonly firstSeenAt: Date;
    readonly resolvedAt: Date | null;
    readonly idempotencyKey: string;
    readonly consoleOrigin: string;
    readonly templateVersion?: import("./index").TransactionalEmailTemplateVersion;
    readonly locale?: import("./index").TransactionalEmailLocale;
  }): Promise<{ readonly providerMessageId: string }>;
}

/** Durable transition routing with fenced leases and provider-level idempotency. */
export function createOperationalAlertDeliveryService(options: {
  readonly store: OperationalAlertDeliveryStore;
  readonly environment: AlertDeliveryEnvironment;
  readonly sender: OperationalAlertSender | null;
  readonly destination: string | null;
  readonly consoleOrigin: string;
  readonly templateVersion?: import("./index").TransactionalEmailTemplateVersion;
  readonly locale?: import("./index").TransactionalEmailLocale;
  readonly recipientFingerprint: (email: string) => Promise<string>;
}) {
  return {
    async run(
      alerts: ReadonlyArray<RoutableOperationalAlert>,
      observedAt = new Date(),
      limit = 16,
    ): Promise<{ opened: number; resolved: number; processed: number }> {
      const recipientFingerprint = options.destination
        ? await options.recipientFingerprint(options.destination)
        : "unconfigured";
      const reconciled = await options.store.reconcile(
        options.environment,
        alerts,
        observedAt,
        {
          recipientFingerprint,
          templateVersion: options.templateVersion ?? "v1",
          templateLocale: options.locale ?? "en",
        },
      );
      if (!options.sender || !options.destination) {
        return { ...reconciled, processed: 0 };
      }

      let processed = 0;
      const count = Math.max(1, Math.min(32, Math.floor(limit)));
      for (let index = 0; index < count; index++) {
        const lease = await options.store.claim(options.environment);
        if (!lease) break;
        if (lease.leaseExpiresAt.getTime() - Date.now() <= 10_000) continue;
        if (
          lease.recipientFingerprint !== recipientFingerprint ||
          (await options.store.isRecipientSuppressed(
            options.environment,
            recipientFingerprint,
          ))
        ) {
          await options.store.settle(lease, {
            state: "dead_letter",
            reason:
              lease.recipientFingerprint !== recipientFingerprint
                ? "recipient_policy_changed"
                : "recipient_suppressed",
          });
          processed++;
          continue;
        }
        try {
          const receipt = await options.sender.sendOperationalAlert({
            to: options.destination,
            environment: options.environment,
            kind: lease.kind,
            alert: lease.alert,
            firstSeenAt: lease.firstSeenAt,
            resolvedAt: lease.resolvedAt,
            idempotencyKey: `atharvan/${options.environment}/alert/${lease.id}`,
            consoleOrigin: options.consoleOrigin,
            templateVersion: lease.templateVersion,
            locale: lease.templateLocale,
          });
          await options.store.settle(lease, {
            state: "accepted",
            providerMessageId: receipt.providerMessageId,
          });
        } catch (error) {
          const providerStatus =
            error instanceof Error &&
            error.name === "TransactionalEmailDeliveryError" &&
            "status" in error &&
            (typeof error.status === "number" || error.status === null)
              ? error.status
              : null;
          const permanent =
            providerStatus !== null &&
            providerStatus >= 400 &&
            providerStatus < 500 &&
            ![408, 409, 429].includes(providerStatus);
          const exhausted = lease.attempts >= 8;
          if (permanent || exhausted) {
            await options.store.settle(lease, {
              state: "dead_letter",
              reason: permanent ? "provider_rejected" : "retry_exhausted",
            });
          } else {
            const delay =
              Math.min(15 * 60_000, 15_000 * 2 ** (lease.attempts - 1)) +
              (crypto.getRandomValues(new Uint32Array(1))[0]! % 5_000);
            await options.store.settle(lease, {
              state: "pending",
              nextAttemptAt: new Date(Date.now() + delay),
            });
          }
        }
        processed++;
      }
      return { ...reconciled, processed };
    },
  };
}
