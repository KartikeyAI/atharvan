# Durable verification email delivery

Status: implemented and compilation checked; migration and runtime verification
are deferred by user instruction. This is the real Resend delivery path for
Better Auth sign-in OTPs, not a simulated delivery service.

## Processing contract

Better Auth stores its hashed OTP before invoking the email callback. Atharvan
looks up the newest matching challenge, encrypts the recoverable message and
commits a delivery row with an audit event before returning from that callback.
The original authentication expiry is copied; queueing never renews a code.
A concurrent resend or consumption can supersede the callback without queueing
an obsolete code. Equal challenge timestamps are treated as ambiguous and fail
closed. Authentication remains the authority on which code can be consumed.

This integration relies on the pinned Better Auth 1.7.2 identifier and stored-value
contract (`sign-in-otp-<normalized-email>`, digest plus attempt suffix). Any auth
upgrade must verify the producer, newest-row selection and consumption contracts.
The library's older standalone onboarding service still uses its existing direct
sender; it is not exposed as the production sign-in endpoint.

An immediate `waitUntil` wake-up accelerates delivery. Its failure does not remove
the queued work. The Worker scheduled handler runs every minute in each deployed
environment and processes at most eight jobs per invocation. PostgreSQL is the
durable queue; no separate Cloudflare Queue is required for this email path.

| State         | Meaning                                                                      | Permitted recovery                                                  |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pending`     | Waiting for its next attempt                                                 | Scheduled claim; owner can bring the next attempt forward or cancel |
| `leased`      | A worker holds a 60-second lease                                             | Expired lease can be reclaimed with a new fencing token             |
| `accepted`    | Resend returned a message receipt                                            | Await authenticated provider feedback                               |
| `delivered`   | The receiving server accepted the message                                    | Later bounce or complaint evidence may supersede it                 |
| `bounced`     | Delivery failed and the recipient fingerprint is suppressed                  | Resolve the issue, then restore future delivery after review        |
| `complained`  | A spam complaint was received and the recipient fingerprint is suppressed    | Confirm authorisation before restoring future delivery              |
| `expired`     | The original code deadline passed or no retry fits                           | Request a fresh code                                                |
| `cancelled`   | Pending send cancelled, or auth challenge/eligibility superseded             | Request a fresh code if still eligible                              |
| `dead_letter` | Permanent rejection, unreadable payload, sender change or exhausted attempts | Resolve the cause, then request a fresh code                        |

Claims use `FOR UPDATE SKIP LOCKED`. Every claim increments the attempt counter;
the total limit is five, including a claimed attempt whose worker subsequently
crashed. Completion requires the current unexpired fencing token. Stale workers
cannot overwrite a newer owner's result. An existing result and audit record
commit together. No automatic operation resets the budget, expiry or identity.

Provider calls have a ten-second timeout, reject redirects, and bound successful
response bodies to 16 KiB. Retryable transport/408/409/429/5xx failures use bounded
exponential backoff with jitter. A fixed Resend idempotency key and unchanged
message content make retry after a lost receipt safe within the OTP lifetime.
Resend documents a 24-hour key retention window; these jobs expire much sooner.
[Resend idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys).

Before sending, the worker checks current operator eligibility, the latest
unconsumed challenge, the code digest, lease ownership and remaining deadline.
A request already in flight cannot be recalled when a later resend or suspension
occurs. This does not grant access: authentication independently validates the
current challenge and operator policy.

## Confidentiality and storage

The recipient, code and sender are encrypted with AES-256-GCM. A non-exportable
key is derived from `BETTER_AUTH_SECRET` using HKDF-SHA-256 with a separate purpose
and environment context. Each message has a random 96-bit nonce. Authenticated
additional data binds the ciphertext to its row, environment, challenge ID,
deadline and correlation ID, preventing row or environment substitution.

The queue never stores a plaintext OTP or logs provider bodies. Each queue row
binds its template revision, locale and non-reversible recipient fingerprint. The operational
API exposes only delivery/operator IDs, state, attempts, timestamps and fixed
reason codes. It excludes ciphertext, recipient addresses, auth identifiers,
OTP digests and provider credentials. Audit evidence records transitions without
message content.

Terminal transitions erase the recoverable ciphertext. Each scheduled invocation
also sweeps up to 100 expired/exhausted rows, including when Resend is unconfigured.
Cleanup is bounded and may lag during an outage or backlog; no expired row is
eligible for sending. Metadata and audit retention remain part of the broader
governance work. The schema allows one minute of application/database clock skew
at insertion while preserving the exact copied authentication deadline.

Changing the auth secret makes pending encrypted messages unreadable; they fail
closed and are scrubbed. Changing the sender stops old pending deliveries rather
than changing a request under an existing provider idempotency key. Drain pending
mail before sender/template/key changes, or expect operators to request fresh
codes afterwards. Keep the rendered template stable for the lifetime of pending
messages when deploying changes.

## Operator controls and visibility

Open **Email delivery** (`/email-deliveries`). `platform:security:read` is required.
The view shows the newest 100 records and reports truncation. Read access is
audited. **Retry now** and **Cancel pending email** require the active Super
Administrator, a reason and a passkey proof from the last five minutes. The
mutation and its command receipt commit atomically. A leased or terminal message
cannot be restarted or cancelled through this surface. Cancellation affects only
delivery; it does not revoke an already issued authentication code or recall mail.

Active recipient blocks appear on the same surface without exposing addresses or
fingerprints. **Restore future delivery** requires the active Super Administrator,
a reason, and passkey step-up from the last five minutes. It preserves the
provider outcome and does not retry an existing code. Later authenticated
provider failure can block the recipient again.

The overview includes warnings for messages waiting over a minute and failed or
expired jobs observed in the last 15 minutes. Failure to read queue health is an
explicit unknown-evidence alert. These signals are not durable incidents and do
not send alert emails. They do not claim inbox delivery or end-to-end health.

If Resend is absent, new OTP requests retain the existing explicit unavailable
response. Existing queued jobs consume no further attempts until configuration
returns, and still expire on schedule. Missing configuration is not an auth bypass.

## Connection and deployment lifecycle

HTTP runtimes are reused only within one Hono request context. Each request closes
its Neon pool in `finally`; background wake-ups and scheduled invocations create
and close their own pools. Failed initialization also closes its pool. Connection,
query, lock and idle-transaction deadlines bound resource retention. This replaces
the earlier isolate-wide runtime cache, which could reuse WebSockets across
requests contrary to the [Neon driver contract](https://github.com/neondatabase/serverless#pool-and-client).

Apply migrations `0018_verification_email_outbox.sql` and
`0026_transactional_email_feedback.sql` in order in a dedicated verification
environment before serving this implementation. Both remain unapplied in this
execution. The migrations add queue storage, indexed history, signed feedback
evidence, recipient suppression and monotonic transition guards. A verified
sender, Resend API key and independent webhook secret are required when actual
delivery testing resumes.

Deploy the reviewed database migration before the Worker and console. Cron
configuration is checked into both environment definitions but has not been
published. Local development uses the immediate wake-up; Wrangler does not run
deployed cron schedules automatically. Scheduled recovery must be exercised
explicitly in the later verification environment.

## Deferred verification

Required before certification: migration constraints; queue/audit rollback;
concurrent claims and fenced completion; expiry sweeps; cancellation/retry races;
lost provider receipts and idempotent replay; challenge replacement/consumption;
encryption tampering and rotation; permission/session denial; repeated requests in
the same Worker isolate; authenticated UI; real Resend acceptance and inbox
delivery; scheduled recovery after killing a worker; backlog/load bounds.

No provider, database, browser or automated tests were executed for this slice.
No migration, deployment, OTP request or email send was performed.
