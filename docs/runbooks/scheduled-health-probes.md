# Scheduled provider and integration health probes

## Configuration

Set the probe on an immutable provider or integration revision. Use a dedicated
public HTTPS health endpoint without credentials or query parameters. Declare
only response codes that prove the dependency is ready, select `HEAD` only when
the endpoint supports it, and keep the deadline below the interval.

Only active providers and active, effectively enabled integrations are scheduled.
Maintenance suppresses integration probes until its expiry. Changing or disabling
the probe appends a new revision; an older leased job settles as `superseded` and
cannot update current health.

## Processing and recovery

The once-per-minute Worker trigger creates idempotent time-window jobs, leases a
bounded batch, performs requests without following redirects, and records:

- `healthy` when the exact response status is declared;
- `degraded` for an unexpected non-5xx response;
- `unavailable` for 5xx, timeout, or network failure.

Every observation carries its job UUID as the correlation ID and expires after
twice the configured interval. An interrupted lease is reclaimable. Five failed
lease recoveries retire the job with audit evidence; the prior observation then
expires rather than falsely extending success. Retained terminal jobs are removed
after 30 days.

The protected overview reports unavailable queue evidence as critical, any
recovery exhaustion in the last 15 minutes as critical, and an outstanding job
older than two minutes as delayed. Terminal jobs retain a categorical completion
reason, so revision replacement cannot be mistaken for execution failure.

Scheduled logs use one run ID and W3C trace, with a child span, duration, and
categorical outcome per task. Search by the job correlation UUID in audit and
observation evidence; use the scheduled run trace for execution diagnostics.
Logs contain no probe URL, response body, headers, or error message.

## Production verification

For each configured target, exercise declared success, unexpected response,
timeout, network failure, revision replacement during a lease, overlapping cron
runs, lease recovery, and retention. Confirm the overview changes from unknown or
stale to the correct current state and that the correlation ID joins the job,
observation, and audit event. Do not use live credentials in a probe URL.
