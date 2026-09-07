import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type BillingCheckoutRequestEntry,
  type BillingCheckoutState,
  type BillingSubscriptionStatus,
  type PlatformConfigurationEnvironment,
  type WorkspaceBillingRegistry,
} from "@atharvan/domain";

const maximumCheckoutBatch = 10;
const maximumSubscriptionBatch = 20;

export interface BillingProviderCheckoutSession {
  readonly id: string;
  readonly state: "open" | "complete" | "expired";
  readonly url: string | null;
  readonly expiresAt: Date;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly requestId: string | null;
}

export interface BillingProviderSubscriptionSnapshot {
  readonly id: string;
  readonly customerId: string;
  readonly priceId: string;
  readonly status: BillingSubscriptionStatus;
  readonly quantity: number;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly trialEnd: Date | null;
  readonly createdAt: Date;
  readonly livemode: boolean;
  readonly workspaceId: string;
  readonly planVersionId: string;
  readonly checkoutRequestId: string;
  readonly requestId: string | null;
}

export interface BillingProvider {
  readonly configured: boolean;
  createCheckoutSession(input: {
    readonly idempotencyKey: string;
    readonly checkoutRequestId: string;
    readonly workspaceId: string;
    readonly planVersionId: string;
    readonly priceId: string;
    readonly customerId: string | null;
    readonly successUrl: string;
    readonly cancelUrl: string;
  }): Promise<BillingProviderCheckoutSession>;
  retrieveCheckoutSession(id: string): Promise<BillingProviderCheckoutSession>;
  retrieveSubscription(
    id: string,
  ): Promise<BillingProviderSubscriptionSnapshot>;
}

export class BillingProviderError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
    readonly requestId: string | null = null,
  ) {
    super("billing_provider_error");
  }
}

export interface LeasedBillingCheckout {
  readonly id: string;
  readonly leaseToken: string;
  readonly state: "pending" | "ready";
  readonly workspaceId: string;
  readonly planVersionId: string;
  readonly providerPriceReference: string;
  readonly providerIdempotencyKey: string;
  readonly providerCheckoutSessionId: string | null;
  readonly providerCustomerId: string | null;
  readonly expiresAt: Date | null;
}

export interface LeasedBillingSubscription {
  readonly id: string;
  readonly leaseToken: string;
  readonly workspaceId: string;
  readonly planVersionId: string;
  readonly providerPriceReference: string;
  readonly providerBindingId: string;
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly revisionNumber: number;
}

export type BillingCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly state?: BillingCheckoutState;
      readonly checkoutUrl?: string | null;
      readonly expiresAt?: string | null;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface BillingSubscriptionStore {
  getWorkspaceRegistry(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly providerConfigured: boolean;
    readonly now: Date;
  }): Promise<WorkspaceBillingRegistry | null>;
  getCheckoutRequest(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId: string;
    readonly now: Date;
  }): Promise<BillingCheckoutRequestEntry | null>;
  createCheckoutRequest(input: {
    readonly id: string;
    readonly actorId: string;
    readonly commandId?: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly planVersionId: string;
    readonly providerIdempotencyKey: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<BillingCommandResult>;
  requestSubscriptionReconciliation(input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<BillingCommandResult>;
  claimCheckout(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId?: string;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<LeasedBillingCheckout | null>;
  markCheckoutReady(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId: string;
    readonly leaseToken: string;
    readonly session: BillingProviderCheckoutSession;
    readonly now: Date;
  }): Promise<void>;
  deferCheckout(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId: string;
    readonly leaseToken: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<void>;
  expireCheckout(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId: string;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<void>;
  failCheckout(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId: string;
    readonly leaseToken: string;
    readonly errorCode: string;
    readonly providerRequestId: string | null;
    readonly retryable: boolean;
    readonly now: Date;
  }): Promise<void>;
  completeCheckout(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly requestId: string;
    readonly leaseToken: string;
    readonly session: BillingProviderCheckoutSession;
    readonly subscription: BillingProviderSubscriptionSnapshot;
    readonly subscriptionId: string;
    readonly providerBindingId: string;
    readonly revisionId: string;
    readonly observationId: string;
    readonly providerDataSha256: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  claimSubscription(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly subscriptionId?: string;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<LeasedBillingSubscription | null>;
  applySubscriptionSnapshot(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly subscriptionId: string;
    readonly leaseToken: string;
    readonly snapshot: BillingProviderSubscriptionSnapshot;
    readonly revisionId: string;
    readonly observationId: string;
    readonly providerDataSha256: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  failSubscriptionReconciliation(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly subscriptionId: string;
    readonly leaseToken: string;
    readonly observationId: string;
    readonly errorCode: string;
    readonly providerRequestId: string | null;
    readonly retryable: boolean;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
}

export class BillingCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("billing_command_rejected");
  }
}

export interface StartSubscriptionCheckoutCommand {
  readonly commandId?: string;
  readonly workspaceId: string;
  readonly planVersionId: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface ReconcileWorkspaceSubscriptionCommand {
  readonly commandId?: string;
  readonly workspaceId: string;
  readonly reason: string;
  readonly correlationId?: string;
}

/** Coordinate durable Stripe Checkout provisioning and provider reconciliation. */
export function createBillingSubscriptionService(input: {
  readonly store: BillingSubscriptionStore;
  readonly provider: BillingProvider;
  readonly environment: PlatformConfigurationEnvironment;
  readonly publicOrigin: string;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const clock = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());
  const origin = normalizePublicOrigin(input.publicOrigin);

  async function processCheckout(claim: LeasedBillingCheckout): Promise<void> {
    try {
      if (claim.state === "pending") {
        const session = await input.provider.createCheckoutSession({
          idempotencyKey: claim.providerIdempotencyKey,
          checkoutRequestId: claim.id,
          workspaceId: claim.workspaceId,
          planVersionId: claim.planVersionId,
          priceId: claim.providerPriceReference,
          customerId: claim.providerCustomerId,
          successUrl: `${origin}/billing?checkout=success`,
          cancelUrl: `${origin}/billing?checkout=cancelled`,
        });
        if (
          claim.providerCustomerId !== null &&
          session.customerId !== claim.providerCustomerId
        )
          throw new BillingProviderError(
            "stripe_checkout_customer_mismatch",
            false,
            session.requestId,
          );
        await input.store.markCheckoutReady({
          environment: input.environment,
          requestId: claim.id,
          leaseToken: claim.leaseToken,
          session,
          now: clock(),
        });
        return;
      }

      if (!claim.providerCheckoutSessionId || !claim.expiresAt)
        throw new BillingProviderError("checkout_state_invalid", false);
      if (claim.expiresAt <= clock()) {
        await input.store.expireCheckout({
          environment: input.environment,
          requestId: claim.id,
          leaseToken: claim.leaseToken,
          now: clock(),
        });
        return;
      }
      const session = await input.provider.retrieveCheckoutSession(
        claim.providerCheckoutSessionId,
      );
      if (session.state === "open") {
        await input.store.deferCheckout({
          environment: input.environment,
          requestId: claim.id,
          leaseToken: claim.leaseToken,
          expiresAt: session.expiresAt,
          now: clock(),
        });
        return;
      }
      if (session.state === "expired") {
        await input.store.expireCheckout({
          environment: input.environment,
          requestId: claim.id,
          leaseToken: claim.leaseToken,
          now: clock(),
        });
        return;
      }
      if (!session.customerId || !session.subscriptionId)
        throw new BillingProviderError("checkout_completion_invalid", true);
      const subscription = await input.provider.retrieveSubscription(
        session.subscriptionId,
      );
      await input.store.completeCheckout({
        environment: input.environment,
        requestId: claim.id,
        leaseToken: claim.leaseToken,
        session,
        subscription,
        subscriptionId: randomId(),
        providerBindingId: randomId(),
        revisionId: randomId(),
        observationId: randomId(),
        providerDataSha256: await fingerprintSubscription(subscription),
        correlationId: randomId(),
        now: clock(),
      });
    } catch (error) {
      const providerError = normalizeProviderError(error);
      await input.store.failCheckout({
        environment: input.environment,
        requestId: claim.id,
        leaseToken: claim.leaseToken,
        errorCode: providerError.reason,
        providerRequestId: providerError.requestId,
        retryable: providerError.retryable,
        now: clock(),
      });
    }
  }

  async function processSubscription(
    claim: LeasedBillingSubscription,
  ): Promise<void> {
    try {
      const snapshot = await input.provider.retrieveSubscription(
        claim.providerSubscriptionId,
      );
      await input.store.applySubscriptionSnapshot({
        environment: input.environment,
        subscriptionId: claim.id,
        leaseToken: claim.leaseToken,
        snapshot,
        revisionId: randomId(),
        observationId: randomId(),
        providerDataSha256: await fingerprintSubscription(snapshot),
        correlationId: randomId(),
        now: clock(),
      });
    } catch (error) {
      const providerError = normalizeProviderError(error);
      await input.store.failSubscriptionReconciliation({
        environment: input.environment,
        subscriptionId: claim.id,
        leaseToken: claim.leaseToken,
        observationId: randomId(),
        errorCode: providerError.reason,
        providerRequestId: providerError.requestId,
        retryable: providerError.retryable,
        correlationId: randomId(),
        now: clock(),
      });
    }
  }

  return {
    getWorkspaceBilling(workspaceId: string) {
      return input.store.getWorkspaceRegistry({
        environment: input.environment,
        workspaceId: requireIdentifier(workspaceId, "workspace_id_invalid"),
        providerConfigured: input.provider.configured,
        now: clock(),
      });
    },

    async startCheckout(
      actor: AuthenticatedOperator,
      command: StartSubscriptionCheckoutCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      if (!input.provider.configured) reject("billing_provider_unconfigured");
      const requestId = randomId();
      const result = unwrap(
        await input.store.createCheckoutRequest({
          id: requestId,
          actorId: actor.operatorId,
          ...(command.commandId === undefined
            ? {}
            : { commandId: command.commandId }),
          environment: input.environment,
          workspaceId: requireIdentifier(
            command.workspaceId,
            "workspace_id_invalid",
          ),
          planVersionId: requireUuid(
            command.planVersionId,
            "plan_version_id_invalid",
          ),
          providerIdempotencyKey: `atharvan-${input.environment}-${requestId}`,
          reason: requireText(command.reason, 8, 500, "reason_invalid"),
          correlationId: command.correlationId ?? randomId(),
          now,
        }),
      );
      const claim = await input.store.claimCheckout({
        environment: input.environment,
        requestId: result.id,
        leaseToken: randomId(),
        now: clock(),
      });
      if (claim) await processCheckout(claim);
      return {
        outcome: result.outcome,
        id: result.id,
        state: result.state ?? "pending",
        checkoutUrl: result.checkoutUrl ?? null,
        expiresAt: result.expiresAt ?? null,
      };
    },

    async requestReconciliation(
      actor: AuthenticatedOperator,
      command: ReconcileWorkspaceSubscriptionCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      if (!input.provider.configured) reject("billing_provider_unconfigured");
      const result = unwrap(
        await input.store.requestSubscriptionReconciliation({
          actorId: actor.operatorId,
          ...(command.commandId === undefined
            ? {}
            : { commandId: command.commandId }),
          environment: input.environment,
          workspaceId: requireIdentifier(
            command.workspaceId,
            "workspace_id_invalid",
          ),
          reason: requireText(command.reason, 8, 500, "reason_invalid"),
          correlationId: command.correlationId ?? randomId(),
          now,
        }),
      );
      const claim = await input.store.claimSubscription({
        environment: input.environment,
        subscriptionId: result.id,
        leaseToken: randomId(),
        now: clock(),
      });
      if (claim) await processSubscription(claim);
      return result;
    },

    async runDue() {
      if (!input.provider.configured)
        return { checkouts: 0, subscriptions: 0, configured: false };
      let checkouts = 0;
      for (; checkouts < maximumCheckoutBatch; checkouts += 1) {
        const claim = await input.store.claimCheckout({
          environment: input.environment,
          leaseToken: randomId(),
          now: clock(),
        });
        if (!claim) break;
        await processCheckout(claim);
      }
      let subscriptions = 0;
      for (; subscriptions < maximumSubscriptionBatch; subscriptions += 1) {
        const claim = await input.store.claimSubscription({
          environment: input.environment,
          leaseToken: randomId(),
          now: clock(),
        });
        if (!claim) break;
        await processSubscription(claim);
      }
      return { checkouts, subscriptions, configured: true };
    },
  };
}

function authorize(actor: AuthenticatedOperator, now: Date) {
  assertPlatformCommandAuthorized({
    actor,
    requestedCapability: "platform:billing:write",
    requireRecentStepUp: true,
    now,
  });
}

function unwrap(result: BillingCommandResult) {
  if (result.outcome === "rejected") reject(result.reason);
  return result;
}

function normalizeProviderError(error: unknown): BillingProviderError {
  return error instanceof BillingProviderError
    ? error
    : new BillingProviderError("billing_provider_unavailable", true);
}

async function fingerprintSubscription(
  value: BillingProviderSubscriptionSnapshot,
): Promise<string> {
  const canonical = JSON.stringify({
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    checkoutRequestId: value.checkoutRequestId,
    createdAt: value.createdAt.toISOString(),
    currentPeriodEnd: value.currentPeriodEnd.toISOString(),
    currentPeriodStart: value.currentPeriodStart.toISOString(),
    customerId: value.customerId,
    id: value.id,
    livemode: value.livemode,
    planVersionId: value.planVersionId,
    priceId: value.priceId,
    quantity: value.quantity,
    status: value.status,
    trialEnd: value.trialEnd?.toISOString() ?? null,
    workspaceId: value.workspaceId,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizePublicOrigin(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    reject("public_origin_invalid");
  return url.origin;
}

function requireIdentifier(value: string, reason: string) {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  )
    reject(reason);
  return normalized;
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  )
    reject(reason);
  return normalized;
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    reject(reason);
  return normalized;
}

function reject(reason: string): never {
  throw new BillingCommandRejectedError(reason);
}
