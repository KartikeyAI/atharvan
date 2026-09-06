# Operational evidence retention

## Purpose

The scheduled Worker claims one durable retention window per environment and
hour. Every deletion category is limited to 1,000 oldest eligible rows. The
deletes, completion record, counts, and aggregate audit event commit together.

## Policy version 1

| Evidence                                                         |      Age | Disposition |
| ---------------------------------------------------------------- | -------: | ----------- |
| Expired Arth workload replay nonces                              |    1 day | Delete      |
| Completed or superseded health-probe jobs                        |  30 days | Delete      |
| Terminal transactional-email metadata outside suppression chains |  90 days | Delete      |
| Resolved operational-alert history outside suppression chains    |  90 days | Delete      |
| Model and integration health observations                        | 365 days | Delete      |
| Commands, results, audit, approvals, and all suppression chains  |     None | Preserve    |

Email cleanup deletes unprotected provider events before their terminal delivery
records. Any provider event referenced by a recipient suppression is preserved,
as are its delivery and occurrence chain. Open occurrences and non-terminal work
are never eligible.

## Health and recovery

The Platform overview shows the latest run state and latest successful counts.
No success within two hours raises an overdue warning. Five failed lease attempts
raise a critical alert. A category removing exactly 1,000 rows raises a backlog
warning until a later successful run finishes below the limit.

Check scheduled Worker telemetry and database availability when a run is late.
Pending retries use bounded backoff. Do not edit run rows or delete evidence by
hand. Repair the cause and allow the next scheduled invocation to reclaim an
expired lease or retry a pending run.

## Deployment and verification

Apply `0028_operational_evidence_retention.sql` before deploying the Worker and
console. In an isolated database, create records immediately before, at, and
after every cutoff. Verify only strictly older eligible rows are removed, each
batch is bounded, suppression chains remain intact, concurrent claims settle
once, expired leases recover, terminal runs are immutable, and the overview
reports success, delay, failure, and saturation accurately.
