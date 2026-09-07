import type {
  BillingProvider,
  BillingProviderCheckoutSession,
  BillingProviderSubscriptionSnapshot,
} from "./subscriptions";
import { BillingProviderError } from "./subscriptions";

const stripeApiOrigin = "https://api.stripe.com";
const stripeApiVersion = "2026-02-25.clover";
const maximumResponseBytes = 256 * 1024;
const requestTimeoutMilliseconds = 10_000;

type Fetcher = typeof fetch;

/** Minimal, pinned Stripe Billing client for hosted Checkout and reconciliation. */
export function createStripeBillingProvider(input: {
  readonly secretKey: string;
  readonly fetcher?: Fetcher;
}): BillingProvider {
  const secretKey = normalizeSecretKey(input.secretKey);
  const fetcher = input.fetcher ?? fetch;

  async function request(
    path: string,
    init: RequestInit,
    idempotencyKey?: string,
  ): Promise<{ readonly body: unknown; readonly requestId: string | null }> {
    let response: Response;
    try {
      response = await fetcher(`${stripeApiOrigin}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${secretKey}`,
          "stripe-version": stripeApiVersion,
          ...(idempotencyKey === undefined
            ? {}
            : { "idempotency-key": idempotencyKey }),
          ...init.headers,
        },
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      throw new BillingProviderError("stripe_network_failure", true);
    }
    const requestId = normalizeOptionalReference(
      response.headers.get("request-id"),
    );
    const declaredLength = Number(
      response.headers.get("content-length") ?? "0",
    );
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > maximumResponseBytes
    )
      throw new BillingProviderError(
        "stripe_response_too_large",
        false,
        requestId,
      );
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumResponseBytes)
      throw new BillingProviderError(
        "stripe_response_too_large",
        false,
        requestId,
      );
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new BillingProviderError(
        "stripe_response_invalid",
        response.status >= 500,
        requestId,
      );
    }
    if (!response.ok) {
      const providerCode = readProviderErrorCode(body);
      throw new BillingProviderError(
        providerCode ?? classifyHttpFailure(response.status),
        response.status === 409 ||
          response.status === 429 ||
          response.status >= 500,
        requestId,
      );
    }
    return { body, requestId };
  }

  return {
    configured: true,

    async createCheckoutSession(command) {
      const values = new URLSearchParams();
      values.set("mode", "subscription");
      values.set("client_reference_id", command.checkoutRequestId);
      values.set("line_items[0][price]", command.priceId);
      values.set("line_items[0][quantity]", "1");
      if (command.customerId !== null)
        values.set("customer", command.customerId);
      values.set("success_url", command.successUrl);
      values.set("cancel_url", command.cancelUrl);
      values.set(
        "metadata[atharvan_checkout_request_id]",
        command.checkoutRequestId,
      );
      values.set("metadata[atharvan_workspace_id]", command.workspaceId);
      values.set("metadata[atharvan_plan_version_id]", command.planVersionId);
      values.set(
        "subscription_data[metadata][atharvan_checkout_request_id]",
        command.checkoutRequestId,
      );
      values.set(
        "subscription_data[metadata][atharvan_workspace_id]",
        command.workspaceId,
      );
      values.set(
        "subscription_data[metadata][atharvan_plan_version_id]",
        command.planVersionId,
      );
      const response = await request(
        "/v1/checkout/sessions",
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: values.toString(),
        },
        command.idempotencyKey,
      );
      return parseCheckoutSession(response.body, response.requestId);
    },

    async retrieveCheckoutSession(id) {
      const response = await request(
        `/v1/checkout/sessions/${encodeURIComponent(requireReference(id, "stripe_checkout_id_invalid"))}`,
        { method: "GET" },
      );
      return parseCheckoutSession(response.body, response.requestId);
    },

    async retrieveSubscription(id) {
      const response = await request(
        `/v1/subscriptions/${encodeURIComponent(requireReference(id, "stripe_subscription_id_invalid"))}`,
        { method: "GET" },
      );
      return parseSubscription(response.body, response.requestId);
    },
  };
}

export const unconfiguredBillingProvider: BillingProvider = {
  configured: false,
  createCheckoutSession: () => unconfigured(),
  retrieveCheckoutSession: () => unconfigured(),
  retrieveSubscription: () => unconfigured(),
};

function parseCheckoutSession(
  value: unknown,
  requestId: string | null,
): BillingProviderCheckoutSession {
  const record = requireRecord(value, "stripe_checkout_response_invalid");
  const state = record.status;
  if (state !== "open" && state !== "complete" && state !== "expired")
    invalid("stripe_checkout_response_invalid", requestId);
  return {
    id: requireReference(
      record.id,
      "stripe_checkout_response_invalid",
      requestId,
    ),
    state,
    url:
      record.url === null
        ? null
        : requireCheckoutUrl(
            record.url,
            "stripe_checkout_response_invalid",
            requestId,
          ),
    expiresAt: requireUnixDate(
      record.expires_at,
      "stripe_checkout_response_invalid",
      requestId,
    ),
    customerId: readExpandableId(
      record.customer,
      "stripe_checkout_response_invalid",
      requestId,
    ),
    subscriptionId: readExpandableId(
      record.subscription,
      "stripe_checkout_response_invalid",
      requestId,
    ),
    requestId,
  };
}

function parseSubscription(
  value: unknown,
  requestId: string | null,
): BillingProviderSubscriptionSnapshot {
  const record = requireRecord(value, "stripe_subscription_response_invalid");
  const items = requireRecord(
    record.items,
    "stripe_subscription_response_invalid",
    requestId,
  );
  if (!Array.isArray(items.data) || items.data.length !== 1)
    invalid("stripe_subscription_item_count_invalid", requestId);
  const item = requireRecord(
    items.data[0],
    "stripe_subscription_response_invalid",
    requestId,
  );
  const price = requireRecord(
    item.price,
    "stripe_subscription_response_invalid",
    requestId,
  );
  const metadata = requireRecord(
    record.metadata,
    "stripe_subscription_response_invalid",
    requestId,
  );
  const status = requireSubscriptionStatus(record.status, requestId);
  const currentPeriodStart = requireUnixDate(
    item.current_period_start ?? record.current_period_start,
    "stripe_subscription_response_invalid",
    requestId,
  );
  const currentPeriodEnd = requireUnixDate(
    item.current_period_end ?? record.current_period_end,
    "stripe_subscription_response_invalid",
    requestId,
  );
  if (currentPeriodEnd <= currentPeriodStart)
    invalid("stripe_subscription_period_invalid", requestId);
  return {
    id: requireReference(
      record.id,
      "stripe_subscription_response_invalid",
      requestId,
    ),
    customerId: requireExpandableId(
      record.customer,
      "stripe_subscription_response_invalid",
      requestId,
    ),
    priceId: requireReference(
      price.id,
      "stripe_subscription_response_invalid",
      requestId,
    ),
    status,
    quantity: requireBoundedInteger(
      item.quantity,
      1,
      1_000_000,
      "stripe_subscription_quantity_invalid",
      requestId,
    ),
    cancelAtPeriodEnd: requireBoolean(
      record.cancel_at_period_end,
      "stripe_subscription_response_invalid",
      requestId,
    ),
    currentPeriodStart,
    currentPeriodEnd,
    trialEnd:
      record.trial_end === null
        ? null
        : requireUnixDate(
            record.trial_end,
            "stripe_subscription_response_invalid",
            requestId,
          ),
    createdAt: requireUnixDate(
      record.created,
      "stripe_subscription_response_invalid",
      requestId,
    ),
    livemode: requireBoolean(
      record.livemode,
      "stripe_subscription_response_invalid",
      requestId,
    ),
    workspaceId: requireReference(
      metadata.atharvan_workspace_id,
      "stripe_subscription_metadata_invalid",
      requestId,
    ),
    planVersionId: requireReference(
      metadata.atharvan_plan_version_id,
      "stripe_subscription_metadata_invalid",
      requestId,
    ),
    checkoutRequestId: requireReference(
      metadata.atharvan_checkout_request_id,
      "stripe_subscription_metadata_invalid",
      requestId,
    ),
    requestId,
  };
}

function requireSubscriptionStatus(value: unknown, requestId: string | null) {
  if (
    value !== "incomplete" &&
    value !== "incomplete_expired" &&
    value !== "trialing" &&
    value !== "active" &&
    value !== "past_due" &&
    value !== "canceled" &&
    value !== "unpaid" &&
    value !== "paused"
  )
    invalid("stripe_subscription_status_unsupported", requestId);
  return value;
}

function readProviderErrorCode(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const code = value.error.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{2,79}$/u.test(code)
    ? `stripe_${code}`
    : null;
}

function classifyHttpFailure(status: number) {
  if (status === 401 || status === 403) return "stripe_authentication_failed";
  if (status === 404) return "stripe_object_not_found";
  if (status === 429) return "stripe_rate_limited";
  if (status >= 500) return "stripe_service_unavailable";
  return "stripe_request_rejected";
}

function normalizeSecretKey(value: string) {
  const normalized = value.trim();
  if (!/^[sr]k_(?:test|live)_[A-Za-z0-9_]{12,}$/u.test(normalized))
    throw new BillingProviderError("stripe_secret_key_invalid", false);
  return normalized;
}

function requireCheckoutUrl(
  value: unknown,
  reason: string,
  requestId: string | null,
) {
  if (typeof value !== "string" || value.length > 2_048)
    invalid(reason, requestId);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid(reason, requestId);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "checkout.stripe.com" ||
    url.username ||
    url.password
  )
    invalid(reason, requestId);
  return url.toString();
}

function readExpandableId(
  value: unknown,
  reason: string,
  requestId: string | null,
): string | null {
  if (value === null) return null;
  return requireExpandableId(value, reason, requestId);
}

function requireExpandableId(
  value: unknown,
  reason: string,
  requestId: string | null,
) {
  return requireReference(
    isRecord(value) ? value.id : value,
    reason,
    requestId,
  );
}

function requireReference(
  value: unknown,
  reason: string,
  requestId: string | null = null,
) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    invalid(reason, requestId);
  return value;
}

function requireUnixDate(
  value: unknown,
  reason: string,
  requestId: string | null,
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 946_684_800 ||
    value > 4_102_444_800
  )
    invalid(reason, requestId);
  return new Date(value * 1_000);
}

function requireBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  reason: string,
  requestId: string | null,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    invalid(reason, requestId);
  return Number(value);
}

function requireBoolean(
  value: unknown,
  reason: string,
  requestId: string | null,
) {
  if (typeof value !== "boolean") invalid(reason, requestId);
  return value;
}

function requireRecord(
  value: unknown,
  reason: string,
  requestId: string | null = null,
): Record<string, unknown> {
  if (!isRecord(value)) invalid(reason, requestId);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalReference(value: string | null) {
  return value !== null && value.length >= 3 && value.length <= 200
    ? value
    : null;
}

function invalid(reason: string, requestId: string | null): never {
  throw new BillingProviderError(reason, false, requestId);
}

function unconfigured(): never {
  throw new BillingProviderError("billing_provider_unconfigured", false);
}
