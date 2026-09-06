# ADR 0023: Fail-closed deployment readiness

Status: Accepted
Date: 2026-09-05

## Decision

`GET /health/live` remains a process-only signal. `GET /health/ready` is an
uncached dependency gate. It reports ready only after full runtime configuration
validation and a read-only Neon check confirms all of the following:

- the exact latest migration timestamp and SHA-256 hash;
- the current schema sentinel table and transition trigger;
- a writable database connection;
- the runtime role's command-write, retention-write, and cleanup privileges.

The success response exposes environment, numeric schema version, database time,
and request ID. Every failure returns the same bounded `503` response with a
30-second retry hint. It never exposes a connection error, migration hash,
database role, hostname, or configuration detail.

Deployment applies migrations, publishes the Worker, then polls the configured
HTTPS control-plane origin until the expected environment and schema version are
ready. The console is published only after that gate succeeds. Migration-history
validation also hashes the current migration file against the Worker readiness
constant so a new or edited migration cannot silently leave readiness stale.

## Consequences

- Liveness cannot be used as evidence that requests are safe to serve.
- A missing migration, read-only branch, insufficient runtime role, or partial
  Worker rollout prevents console promotion.
- Every new migration must update the readiness head and deployment expectation.
- Provider availability remains represented by scheduled health observations;
  readiness proves configuration and the canonical database boundary only.
