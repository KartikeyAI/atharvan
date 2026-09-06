# ADR 0018: Durable scheduled health probes

Status: accepted, 2026-09-05.

## Decision

Provider and integration revisions may declare one HTTPS `GET` or `HEAD` probe
with an explicit status-code set, 0.5–10 second deadline, and 1–60 minute
schedule. Query credentials, URL user information, local/private IP literals,
redirect following, and implicit success ranges are prohibited.

The scheduled Worker materializes one PostgreSQL job per target, revision, and
time window. Partial unique indexes make scheduling idempotent. `SKIP LOCKED`,
expiring leases, attempt bounds, and fencing tokens coordinate overlapping or
interrupted Workers. Settlement verifies the target revision is still current,
then commits the append-only observation, system audit evidence, and terminal job
state atomically. Terminal coordination jobs are retained for 30 days.

Automated observations use `scheduled_probe` with no operator identity. Manual
observations retain `operator_probe` and require an active operator. Probe URLs
never contain secret material; authenticated functional checks remain explicit
provider certification work.

## Consequences

Current health can be refreshed without an operator, while failures remain
distinguishable from missing or stale evidence. A reachable endpoint only proves
the configured contract; operators must select an endpoint and expected response
that meaningfully represents the dependency.
