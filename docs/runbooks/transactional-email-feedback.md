# Transactional email feedback

## Provider configuration

Create a Resend webhook for:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.failed`
- `email.bounced`
- `email.complained`
- `email.suppressed`

Point it to `https://<control-plane-origin>/v1/webhooks/resend`. Store the
endpoint signing secret as `RESEND_WEBHOOK_SECRET`; do not reuse the API key or
authentication secret. Production startup and deployment validation require it.
Use a separate `ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET` for stable, non-reversible
recipient fingerprints. Rotating it changes recipient identity and therefore
requires a reviewed suppression migration.

The handler accepts at most 64 KiB, verifies `svix-id`, `svix-timestamp` and
`svix-signature` over the unmodified body, permits five minutes of clock skew,
and records event IDs idempotently. Configure provider retries normally: replay
of the same event is safe and returns success.

## Template rollout and rollback

Use **Settings** to change
`communications.transactional_template_version` or
`communications.default_locale`. New mail binds the selected values when queued;
pending mail keeps its original content and delivery identity. Roll back by
restoring an earlier configuration revision through the audited rollback action.

## Triage

Use **Email delivery** and **Overview**. `accepted` means Resend accepted the
request. `delivered` means the receiving server accepted it; inbox placement is
still not guaranteed. `bounced` and `complained` create a recipient suppression.
Audit contains the provider event type, payload digest, delivery identity and
correlation ID without the address or payload.

For unmatched authenticated events, correlate the provider message ID from the
Resend dashboard with deployment time and environment. Do not copy message body
or recipient content into Audit. A changed alert destination naturally receives a
new fingerprint.

## Recipient restoration

Open **Email delivery** and review **Blocked email recipients**. The active Super
Administrator must verify a passkey within five minutes, inspect the source
delivery and provider reason, and record why the mailbox or complaint issue is
resolved. **Restore future delivery** lifts only the selected suppression. It does
not retry or rewrite an existing delivery. The original provider event and
suppression remain durable evidence, and later provider feedback can block the
recipient again.

On an uncertain response, keep the same idempotency key or refresh the active
list before another action. Never restore a complaint solely to remove an alert;
confirm the recipient's authorisation first.

## Deployment order

1. Apply migrations `0026_transactional_email_feedback.sql` and
   `0027_recipient_suppression_recovery.sql` in order.
2. Configure the webhook secret in the target Worker environment.
3. Deploy the Worker, then the console.
4. Verify a signed replay, a valid delivered event, a bounce suppression, a
   complaint precedence transition, and an unmatched event in a non-production
   environment.

No migration or provider verification was performed in this implementation
slice.
