# ADR 0021: Audited recipient suppression recovery

Status: accepted

## Decision

Transactional email recipient suppression is a reversible lifecycle with
immutable origin evidence. A suppression row keeps its environment-bound HMAC
fingerprint, provider event, reason, and creation time. Restoration sets one
terminal lift transition with the responsible operator, reason, correlation ID,
and database time. The row cannot be deleted, rewritten, or restored twice.

Only the active Super Administrator with `platform:security:write` and a passkey
step-up from the last five minutes may restore future delivery. The command uses
the platform idempotency envelope and commits the lift, domain audit event, and
command receipt atomically. Recipient addresses and fingerprints are never
returned by the API or written to Audit.

The active uniqueness constraint applies only to unlifted rows. A later
authenticated provider failure may therefore create a new suppression episode
for the same recipient. Restoration never retries an existing message or changes
its provider outcome.

## Consequences

The Email delivery surface lists active recipient blocks by source delivery and
provider reason. Current health retains an alert until each active suppression is
reviewed. Migration `0027_recipient_suppression_recovery.sql` adds the guarded
lifecycle fields and replaces the fully immutable suppression trigger.

Migration application and runtime/provider verification remain deferred by user
instruction.
