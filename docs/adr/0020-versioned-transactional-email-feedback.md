# ADR 0020: Versioned transactional email and authenticated feedback

Status: accepted

## Decision

Transactional email templates are immutable source-controlled revisions. The
versioned configuration registry selects the version and locale for newly queued
mail. Each queue row binds that choice, so configuration rollback never changes
an in-flight message. Version `v2` is the default and English and Hindi are the
supported locales.

Resend feedback enters through a bounded public webhook. Atharvan verifies the
Svix HMAC over the exact raw body, rejects stale envelopes, stores each provider
event once, and advances only the delivery identified by the provider receipt.
Delivery, bounce and complaint evidence is append-only. Raw webhook bodies and
recipient addresses are never persisted.

Recipient suppression uses an environment-bound HMAC fingerprint. Bounce,
failure, provider suppression and complaint events prevent future sends to the
same destination without making the address queryable. Delivery workers also
reject a queued alert when its configured destination has changed.

## Consequences

Provider acceptance is no longer treated as inbox delivery. The operator view
shows accepted, delivered, bounced and complained outcomes and the template
revision used. Template selection and rollback use the existing audited Settings
workflow. Production requires a separate `RESEND_WEBHOOK_SECRET`.

Migration `0026_transactional_email_feedback.sql` safely backfills identity for
existing rows, adds feedback and suppression evidence, and replaces queue guards
with monotonic downstream state transitions. Migration application and provider
verification remain deferred by user instruction.
