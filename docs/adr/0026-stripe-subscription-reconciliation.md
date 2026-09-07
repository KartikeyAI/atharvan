# ADR 0026: Stripe hosted subscription Checkout and reconciliation

- Status: Accepted
- Date: 2026-09-07

## Decision

Atharvan uses Stripe Billing with hosted Checkout for fixed recurring plans.
The commercial catalogue remains the authority for immutable plan terms and
stores the exact Stripe Price reference. A Checkout request may start only for
an active workspace whose current entitlement snapshot names that plan version.

Every provider mutation begins as a durable Neon request with a stable Stripe
idempotency key. Checkout sessions, provider bindings, subscription revisions,
and reconciliation observations are retained as separate records. The current
workspace subscription is a guarded pointer to immutable provider evidence.

Atharvan reconciles open Checkout sessions and active subscriptions on the
scheduled Worker. Provider metadata, Price, customer, environment, workspace,
and plan identity must all match. Drift creates visible immutable evidence and
never changes commercial or entitlement authority. Manual reconciliation uses
`platform:billing:write`, recent passkey step-up, a named idempotent command,
and an audit reason.

Stripe credentials are runtime secrets. PostgreSQL, command payloads, API
responses, and logs never contain the key or raw provider response bodies. The
client pins the Stripe API version, bounds response size and time, and emits
only categorical failure codes plus Stripe request IDs.

## Consequences

Lost Worker responses and scheduled interruptions recover without creating a
second Checkout session. The console can show pending work, current subscription
terms, and drift without treating a provider response as a plan update. Signed
Stripe webhooks, invoices, refunds, credits, and Customer Portal operations are
separate forward slices.
