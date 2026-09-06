# ADR 0017: Durable operational alert transitions

Date: 2026-09-05
Status: Accepted for local implementation

## Decision

The scheduled Worker derives foundation alerts from one current evidence snapshot
and reconciles stable `environment:source:rule` IDs into PostgreSQL occurrences.
Only the transition from absent to open creates a firing delivery; only the
transition from open to absent creates a recovery delivery. Updated counts and
descriptions refresh the open occurrence without generating notification noise.

Delivery uses a PostgreSQL outbox with `SKIP LOCKED`, 60-second fenced leases,
eight bounded exponential attempts, terminal provider receipts/dead letters, and
a stable Resend idempotency key per transition. The alert destination is a
deployment setting rather than operator-entered state. Missing provider or
destination preserves pending work. Occurrence and delivery transition guards
deny deletion, identity changes, terminal rewrites, attempt rollback, and
cross-environment delivery linkage.

The protected overview reports routing configuration, queue backlog, recent dead
letters, and health-read failure. The email content contains only already-visible
operational metadata and links to the configured console origin. It contains no
credentials, customer-private data, command payloads, or operator session data.

## Consequences

The channel provides durable firing and recovery evidence without pretending that
provider acceptance proves inbox delivery. It cannot detect a total outage of the
Worker, scheduler, database, or its own provider; independent external uptime
monitoring remains mandatory. Human acknowledgement, escalation policies, bounce
processing, and full incident lifecycle are later governance work.
