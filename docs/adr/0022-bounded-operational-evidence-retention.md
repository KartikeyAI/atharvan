# ADR 0022: Bounded operational evidence retention

Status: Accepted
Date: 2026-09-05

## Decision

Atharvan applies disposal policy through one environment-scoped hourly run. A
unique schedule window, database lease, retry budget, and terminal run record
make overlapping Worker invocations safe. Each category deletes at most 1,000
oldest eligible rows per run. A full batch remains visible as backlog evidence.

Retention version 1 removes expired workload request nonces after one day,
completed health-probe jobs after 30 days, transactional-email and resolved
alert metadata after 90 days, and dependency-health observations after 365 days.
Deletes are ordered around foreign keys and execute atomically with the terminal
run record and one aggregate audit event.

Platform commands, command results, audit events, approvals, active or lifted
recipient suppressions, their source provider event, and the associated delivery
record are excluded. Retention never removes pending, leased, running, or open
work. Legal holds and governed deletion of canonical evidence remain Phase 3
data-governance work.

## Consequences

- Database time determines eligibility and the schedule window.
- A crash before settlement rolls back all deletes; an expired lease may retry.
- The console exposes policy, latest success, aggregate counts, failures, delay,
  and batch saturation without identifiers or recipient fingerprints.
- Changing a duration or protected category requires a reviewed policy version,
  migration compatibility analysis, and updated runbook.
