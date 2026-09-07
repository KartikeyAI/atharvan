# Stripe subscription operations

## Configuration

Set `STRIPE_SECRET_KEY` as a Worker secret. Development and test require a Stripe
test-mode secret; production requires live mode. Configure each active fixed
recurring plan with the exact Stripe Price ID, then seal and assign that plan's
entitlement snapshot to the target workspace.

## Checkout

Billing Operators open **Billing → Stripe subscription lifecycle**, inspect the
workspace, select its assigned recurring plan, provide an audit reason, and
start Checkout. Atharvan stores the request before calling Stripe. A ready
request exposes only Stripe's hosted Checkout URL. Pending requests are retried
by the scheduled Worker with the original idempotency key.

Do not create another request while one is pending or ready. If the browser loses
the response, inspect the workspace again. Completed and expired Checkout URLs
are removed from the registry.

## Reconciliation

The scheduled Worker polls due Checkout requests every minute and current
subscriptions every 15 minutes. Billing Operators can request immediate
reconciliation with a reason and recent passkey verification.

`matched` means provider identity, metadata, environment, customer, Price, and
plan all agree. `drift` preserves the existing Atharvan plan and subscription
revision and records a reason code. `failed` means the provider could not be
read; bounded retries continue. Investigate drift in Stripe and the immutable
catalogue before changing either system. Never rewrite a historical revision or
migration.

## Recovery

For provider timeouts, retain the Checkout request and let the scheduled worker
retry. Stable idempotency prevents duplicate session creation. For a dead
Checkout request, confirm the categorical error and Stripe request ID in audit
evidence, correct configuration or plan metadata, and start a new command.

Migration `0031_billing_subscriptions` is additive. Before production data,
rollback uses the disposable database snapshot. After production data exists,
restore the provider snapshot or ship a reviewed forward migration.
