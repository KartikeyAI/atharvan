import {
  createBillingSubscriptionService,
  createStripeBillingProvider,
  unconfiguredBillingProvider,
} from "@atharvan/commercial";
import type { AuthenticationRuntimeConfig } from "@atharvan/config";
import {
  createPostgresBillingSubscriptionStore,
  type AtharvanDatabase,
} from "@atharvan/db";

/** Reconcile due Checkout requests and Stripe subscription snapshots. */
export function createBillingReconciliationRuntime(
  database: AtharvanDatabase,
  config: AuthenticationRuntimeConfig,
) {
  const provider = config.STRIPE_SECRET_KEY
    ? createStripeBillingProvider({ secretKey: config.STRIPE_SECRET_KEY })
    : unconfiguredBillingProvider;
  const service = createBillingSubscriptionService({
    store: createPostgresBillingSubscriptionStore(database),
    provider,
    environment: config.ATHARVAN_ENVIRONMENT,
    publicOrigin: config.ATHARVAN_PUBLIC_ORIGIN,
  });

  return { run: service.runDue };
}
