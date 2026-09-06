# Current operational alerts

The overview displays current signals derived from the same evidence snapshot as
the health cards. The scheduled Worker reconciles those stable rule IDs into
durable occurrences and routes firing and recovery transitions to the configured
alert email destination. Console access requires the passkey-backed operator
session and `platform:overview:read` capability. The endpoint remains non-cacheable.

## Rules and response

| Signal                                                      | Severity | Response                                                                                                                   |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Fresh unavailable probe                                     | Critical | Review provider/integration evidence and upstream service; verify recovery with a new probe.                               |
| Health evidence read failed                                 | Critical | Refresh; check database connectivity and schema compatibility if the failure persists. The affected count remains unknown. |
| Email provider not configured                               | Critical | Configure the provider and verified sender; verify delivery to an approved recipient.                                      |
| Fresh degraded probe                                        | Warning  | Review latency/failure evidence before changing routing.                                                                   |
| Latest observation expired                                  | Warning  | Run a new probe. Refreshing the overview does not renew evidence.                                                          |
| Missing or unusable observation                             | Warning  | Check timestamps and establish health with a probe.                                                                        |
| Secret provider not configured                              | Warning  | Configure the provider and verify create/rotate/revoke operations.                                                         |
| Verification delivery read failed                           | Critical | Check migrations and database connectivity; queue progress is unknown.                                                     |
| Verification email waiting over a minute                    | Warning  | Review Email delivery, provider availability and scheduled processing.                                                     |
| Verification email failed or expired in the last 15 minutes | Warning  | Resolve the recorded cause, then request fresh codes.                                                                      |
| Arth command exchange not configured                        | Critical | Configure matching workload identity and signing keys before enabling enforcement.                                         |
| Arth command evidence read failed                           | Critical | Check migrations and database connectivity; delivery progress is unknown.                                                  |
| Arth command rejected in the last 15 minutes                | Critical | Review the acknowledgement and submit a corrected state revision.                                                          |
| Arth command dead-lettered in the last 15 minutes           | Critical | Restore delivery, resolve the recorded cause, then submit a new state revision.                                            |
| Arth command outstanding for more than two minutes          | Warning  | Check the consumer, signing configuration, leases, and network path.                                                       |

Each alert has a stable `environment:source:rule` ID. Repeated snapshots do not
create duplicate notifications. Migration `0022` enforces one open occurrence per
environment/rule and one delivery per firing or recovery transition. Affected counts describe the registered entries in that
rule's bucket, not customer impact. Read/configuration failures have null counts.
Within each severity, IDs establish a deterministic display order.

Boolean configuration evidence and aggregate email/Arth queue health enter the alert builder;
message content and credentials are excluded. A configured email
or secret provider does not prove successful delivery or healthy lifecycle
operations. The recorded-health badge still describes probe evidence; foundation
configuration alerts are shown separately. An empty alert list never establishes
that the whole platform is healthy.

## Refresh and limitations

Alerts share the overview's expiry and request cancellation. The console hides
them before refresh and on failed reads; they cannot outlive the displayed
snapshot. New healthy evidence removes the corresponding current signal. An
expired outage becomes an expired-evidence warning; it is not an incident
resolution. Filter selection survives refresh, while disclosure panels can reset
when a new snapshot renders.

All registered providers/integrations count, including inactive entries. Operators
must inspect routing and lifecycle state before treating a probe failure as live
customer impact. Workspaces, runners, workflows, costs, and incidents remain
unconnected. A total API/runtime outage cannot be reported by this in-console
feed and instead produces the overview-unavailable state. Independent uptime
monitoring is still required. Email provider acceptance, attempts, fenced leases,
dead letters, occurrences, and recovery evidence are durable; inbox bounces,
human acknowledgement, escalation, and full incident workflow remain later work.

## Delivery and recovery

Set `ATHARVAN_ALERT_EMAIL_TO` to an authorised distribution address and configure
Resend. Each minute the scheduled Worker records new occurrences, updates current
evidence without duplicating notifications, resolves absent rules, and enqueues a
recovery notification. Deliveries use 60-second fenced leases, eight bounded
exponential attempts, stable provider idempotency keys, and terminal receipts or
dead letters. Missing routing preserves pending transitions until configuration
is restored.

## Verification

The durable verification-delivery and Arth command-exchange changes add queue
queries and migrations `0018` through `0022`. Their runtime/automated verification
is deferred by user instruction. The older evidence below does not certify those
additions. See the
[verification delivery runbook](verification-email-delivery.md).

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`. Domain tests verify rule
classification, counts, stable IDs, ordering, expiry transitions, recovery, and
configuration evidence. API tests preserve authorization and no-store behavior;
component and polling tests cover filtering, limited-coverage empty states, and
incompatible older responses during rolling deployment.

On 2026-09-04, 221 normal tests passed; the two opt-in database scenarios were not
run because this slice changes no queries or schema. A temporary browser fixture
used the real component, polling hook, and alert builder with synthetic probe
evidence. Desktop 1440×1000 and mobile 390×844 checks passed critical filtering,
recovery disclosure, failed-refresh alert removal, and recovery with the selected
filter preserved. Browser plugin not available; bundled Playwright and installed
Chrome were used. No unexpected console errors, framework overlays, or horizontal
overflow remained. Live local checks verified anonymous login redirect and API
`401`; real authenticated onboarding and provider delivery remain unverified.
