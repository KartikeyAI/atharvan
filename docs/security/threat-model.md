# Atharvan platform threat model

Status: Platform implementation baseline. Review after every trust-boundary,
identity, provider, or data-classification change and before a production release.

## Scope and assets

Atharvan is the administrative control plane. Its highest-value assets are
operator identities and passkeys, platform authority, command and approval
records, secret references, provider configuration, audit evidence, and the
signing material used to exchange commands with Arth. Customer-private content,
credentials, prompts, source code, and execution artifacts are outside Atharvan's
allowed data boundary.

The assessed trust boundaries are the browser-to-console session, console-to-
Worker API, Worker-to-Neon connection, Worker-to-Resend and Secrets Store calls,
Atharvan-to-Arth signed exchange, CI-to-Cloudflare deployment, and human operator
approval/recovery processes.

## Threats and enforced controls

| Threat                                       | Boundary                  | Enforced control                                                                                                                                  | Failure behavior                                                    |
| -------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Session theft or weak reauthentication       | Browser/API               | Secure Better Auth session, mandatory passkey enrollment, recent passkey step-up for sensitive commands, server-side capability checks            | Reject with `401`/`403`; never trust UI state                       |
| Privilege escalation                         | Operator policy           | Base-role capabilities, customer-private capability exclusion, single active owner, independent scoped approvals, emergency-grant expiry/review   | Transaction aborts and immutable rejection evidence remains         |
| Replay or duplicate administrative effects   | Public API/database       | Idempotency key fingerprint, immutable command envelope, atomic effect/result receipt                                                             | Exact retry replays result; changed input conflicts                 |
| Silent repricing or history rewrite          | Commercial catalogue      | Stable identities, immutable versions, exact next-version pointers, forward-only lifecycle, database update/delete guards                         | Stale or destructive mutation aborts; historical terms remain fixed |
| Ambiguous price or provider substitution     | Commercial/provider       | Safe integer minor units, pricing-model invariants, bounded opaque provider references, environment isolation                                     | Invalid terms are rejected before persistence                       |
| Silent entitlement expansion                 | Commercial/Arth           | Sealed plan sets, immutable complete snapshots, typed values, exact next revisions, atomic signed outbox                                          | Unauthorized or partial authority cannot become current             |
| Stale entitlement enforcement                | Arth exchange             | Monotonic assignment revisions, signed complete layers, validity windows, immutable observations, desired/observed separation                     | Stale acknowledgement conflicts; pending/failed remains visible     |
| Indefinite enterprise override               | Operator/database         | Contract reference, bounded start/expiry, 128-key workspace cap, immutable revisions, terminal revocation, step-up and audit                      | Invalid or reopened grant is rejected                               |
| Approval substitution or self-approval       | Approval workflow         | Typed scope identity, requester/beneficiary checks, reviewer base-role proof, expiry and atomic consumption                                       | Protected effect does not commit                                    |
| Lost response after local commit             | Worker/database           | Transactional command receipt committed with the effect                                                                                           | Retry reads the stored terminal response                            |
| Lost response after external secret mutation | Secrets Store             | Exact provider-name reconciliation and explicit failed lifecycle states                                                                           | Recovery reconciles before creating material again                  |
| Forged or replayed Arth workload request     | Service boundary          | HMAC-SHA256 request signature, body digest, audience, bounded clock skew, rotating key IDs, durable nonce consumption                             | Reject before state mutation                                        |
| Reordered authority update                   | Arth exchange             | Monotonic per-aggregate revisions and idempotent command receipts in both systems                                                                 | Stale revision is rejected and cannot reverse authority             |
| Queue double processing                      | Scheduled workers         | PostgreSQL row locks, `SKIP LOCKED`, expiring leases, fencing tokens, bounded attempts, provider idempotency                                      | Stale worker cannot settle a newer lease                            |
| Probe SSRF or credential disclosure          | Worker/provider network   | Revisioned HTTPS-only targets, no query/user information, private literal rejection, manual redirects, bounded deadlines, database validation     | Invalid contracts are rejected; redirects are observations          |
| Alert flood or silent recovery               | Telemetry/notification    | Stable rule IDs, one open occurrence per environment/rule, transition outbox, separate triggered/recovered receipts                               | Repeated snapshots update evidence without duplicate delivery       |
| Secret disclosure                            | API/log/database          | Secret values accepted only at provider boundary; references stored locally; sensitive command fields redacted; bounded provider responses        | No read-back path; errors contain categorical reason only           |
| Customer-private data exposure               | Atharvan/Arth             | Minimal projections and command payloads; `customer-private:*` never matches platform wildcard                                                    | Private payload is rejected or remains in Arth                      |
| Cross-environment mutation                   | Runtime/database          | Environment-bound config, commands, approvals, queues, observations, uniqueness, and deployment credentials                                       | Records from another environment do not authorize an effect         |
| Database tampering or evidence deletion      | Database                  | Foreign keys, checks, partial unique indexes, immutable/transition triggers, append-only audit                                                    | Invalid transition aborts; deletion is denied                       |
| Audit export corruption or untracked access  | Browser/evidence transfer | Exact-body SHA-256 and `Content-Digest`, browser verification before save, bounded ranges/counts, immutable export-access evidence                | Corruption is rejected; every released export has actor/scope proof |
| Dependency outage                            | Provider/network          | Deadlines, bounded retries, durable queues, current evidence freshness, critical alerts                                                           | State stays pending/unknown; success is never inferred              |
| Malicious diagnostic text                    | Provider/operator input   | Length limits, newline/secret-pattern rejection, safe payload redaction, escaped email/UI rendering                                               | Input is rejected or rendered as inert text                         |
| Telemetry disclosure or log injection        | Edge diagnostics          | Fixed JSON event schemas, route templates, bounded control-character filtering, categorical errors, and exclusion of queries/bodies/headers       | Correlation remains useful without recording request content        |
| Forged or replayed email feedback            | Public webhook            | Exact-body Svix HMAC, five-minute envelope age, durable provider event uniqueness, monotonic delivery transitions, and bounded request bodies     | Request is rejected or an existing event is acknowledged once       |
| Recipient enumeration through suppression    | Database/operator UI      | Environment-bound HMAC fingerprints; no recipient or raw provider payload in feedback, suppression, Audit, or delivery projections                | Operational evidence remains non-reversible                         |
| Unsafe recipient restoration                 | Operator mutation         | Super Administrator, write capability, recent passkey step-up, idempotent command, guarded one-way transition, immutable origin evidence          | Future eligibility changes once; existing mail is untouched         |
| Unbounded or destructive evidence cleanup    | Scheduled worker/database | Hourly unique windows, fenced lease, fixed cutoffs, 1,000-row category limits, foreign-key-aware ordering, protected evidence exclusions          | Failed transaction restores every row; delay/backlog alerts remain  |
| False-positive deployment readiness          | Release/Worker/database   | Full config parse, exact migration hash/head, schema sentinel, writable mode, runtime-role privilege checks, post-deploy environment/version gate | Return generic `503`; console promotion stops                       |

## Abuse cases that must remain denied

- A Super Administrator cannot use `platform:*` to read customer-private data.
- An emergency grant cannot approve its own creation or supply reviewer authority.
- A successor cannot receive platform ownership without personally accepting the
  exact unexpired request.
- An operator cannot retry an idempotency key with a changed target or payload.
- Arth cannot acknowledge a command with another lease, revision, body, or key.
- A stale alert worker cannot overwrite a newer lease or create repeated firing
  notifications for an already-open occurrence.
- A production runtime cannot start with a local/invalid origin or without email,
  alert, secret-provider, and Arth workload configuration.
- Unsigned, stale, oversized, ambiguous, or duplicate provider feedback cannot
  change more than one delivery or overwrite stronger complaint evidence.
- A recipient suppression cannot be deleted, silently rewritten, restored twice,
  or restored by a normal operator.
- Retention cannot remove open work, canonical command/audit/approval evidence,
  or any provider event and delivery chain supporting a recipient suppression.
- A plan version cannot be edited, deleted, reactivated after retirement, or
  activated beneath a non-active product.
- A workspace snapshot cannot be edited, skip a revision, reference another
  plan's entitlement set, or report applied without a matching Arth observation.
- An enterprise grant cannot omit its contract/expiry, outlive its bounded term,
  exceed the workspace key cap, or return to active after revocation.

## Residual risks and required evidence

Cloudflare, Neon, Resend, the operator email domain, and Arth remain external
dependencies. Their account takeover, regional outage, or control-plane failure
cannot be eliminated in application code. Production certification therefore
requires least-privilege account review, provider audit-log retention, real key
rotation, database restore, workload replay/reordering, queue interruption, alert
delivery/recovery, and operator access-recovery exercises. The evidence must be
from the release candidate and must contain no credentials or customer-private
payloads.
