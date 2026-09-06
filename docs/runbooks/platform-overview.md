# Recorded health overview

The console overview reads `GET /v1/platform/overview` through the protected
console API. It requires an active operator, a passkey-backed session, and
`platform:overview:read`. The server selects the environment from validated
runtime configuration and marks the response `Cache-Control: no-store`.

## Evidence and freshness

- Model providers and integrations use their existing health-observation tables.
  Every registered entry is included, regardless of lifecycle or routing state.
- The latest observation wins, ordered by observation time, creation time, then
  ID. An older healthy observation never replaces a newer expired observation.
- An observation expiring at or before the snapshot time is stale. Missing,
  future-dated, or invalid-lifetime evidence is unknown. Fresh evidence retains
  its recorded healthy, degraded, or unavailable status.
- Counts are mutually exclusive, except the total which sums all status buckets.
  A failed source has null counts, not zero counts. The independent source can
  still return its evidence.
- An unavailable observation takes priority as action required; degraded probes
  or partial source failures make the overview degraded. Good evidence only
  establishes partial platform coverage: workspaces, runners, workflows, costs,
  and incidents are not connected by this slice.
- The snapshot is valid for at most 30 seconds, shortened to the earliest current
  observation expiry. The browser subtracts request transit time without trusting
  its wall clock, clears counts before refreshing, ignores superseded responses,
  times out stalled requests after 15 seconds, and retries failures.

## Historical evidence

The protected overview also returns 24 rolling hourly boundaries for model
providers and integrations. Each boundary reconstructs the latest observation
available at that exact time, applies its original expiry, and counts only
entries already registered in the selected environment. The series is ordered
oldest first and fixed at 24 points. A failed history query is represented as a
null source series rather than an empty or healthy history.

History contains aggregate state counts only. It excludes entity identifiers,
probe URLs, latency, HTTP details, error codes, credentials, and provider
responses. It is evidence coverage at sampled boundaries, not a continuous
uptime claim. Scheduled alert reconciliation omits this projection because it
uses current evidence only.

Refresh reads stored evidence. It does not trigger a probe, confirm routing
readiness, reveal credentials, or modify platform state. Existing model and
integration administration surfaces remain responsible for recording probes.

## Verification

The overview now also includes [current operational alerts](operational-alerts.md)
derived from probe evidence and runtime provider configuration. They expire with
the snapshot and include severity, affected counts, and recovery guidance.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` for normal validation.
The separate read-only SQL verification explicitly loads the root `.env.local`:

```powershell
$env:ATHARVAN_RUN_OVERVIEW_READONLY = '1'
pnpm --filter @atharvan/db exec vitest run src/platform-overview-readonly.test.ts
Remove-Item Env:ATHARVAN_RUN_OVERVIEW_READONLY
```

This check uses one PostgreSQL client and `BEGIN READ ONLY`, verifies real table
queries, and exercises freshness, environment isolation, latest-observation
selection, historical boundaries, and ties using SELECT-only CTE fixtures. It
never inserts test rows.
The existing stateful integration scenario still requires a disposable database.

Local verification on 2026-09-04 passed 210 normal tests and the separate read-only
Neon check. Browser fixture QA used the production overview component and hook
with synthetic API responses at desktop 1440×1000 and mobile 390×844. Refresh
failure cleared counts; retry recovered an empty registry. No unexpected browser
errors or framework overlays remained. This fixture does not verify a real
authenticated session or live provider probes. Resend remains absent locally;
real email delivery and passkey onboarding remain to be verified.

The restarted local app redirected anonymous browser requests to
`http://localhost:3000/login?returnTo=%2F`; its protected overview API returned
`401`. Temporary tooling cache cleanup restored approximately 6.8 GiB of disk
space, and daily project cache monitoring remains configured.
