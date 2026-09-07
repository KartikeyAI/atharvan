# Atharvan Progress

Last updated: 2026-09-07
Current phase: Commercial and execution operations
Overall status: Phase 2 implementation in progress; Phase 1 certification deferred

Delivery plan: [three-phase production delivery](docs/production-delivery-plan.md).
Each subsequent execution targets one complete phase with mandatory end-to-end
exit evidence. Existing checkboxes remain the implementation record; the plan
adds completion gates and does not mark unfinished work complete.

## Three-phase delivery gates

- [ ] Phase 1: complete administrative foundation, real Arth/provider integration,
      authenticated E2E, durable operations, telemetry and recovery evidence.
- [ ] Phase 2: complete paid-platform billing, entitlements, metering/enforcement,
      runners, workflows, deployments and operated reconciliation evidence.
- [ ] Phase 3: complete support, security, enterprise/data governance, incident
      operations and production release certification with restore/rollback drills.

Implementation has moved to Phase 2 at the user's direction. Phase 1 remains open
until its deferred runtime, provider, authenticated browser, and recovery evidence
is complete; fixtures, skipped checks or missing provider credentials cannot
certify it.

On 2026-09-04 the user deferred testing and requested implementation first.
New work is compiled but remains unverified by automated, database, browser and
provider tests. Database migrations through `0029_commercial_catalogue` and Arth
`0060_atharvan_control_exchange` are generated; later migrations have not been
applied to the deferred test/development environments.
The [implementation record](docs/runbooks/phase-one-implementation.md) distinguishes
implemented controls from remaining Phase 1 delivery work.

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete and verified
- `[!]` Blocked
- `[-]` Deferred or out of current scope

An item may be marked complete only when its implementation, tests, operational evidence, and relevant documentation satisfy the definition of done in `SOURCE_OF_TRUTH.md`.

## Current blockers

- GitHub Actions validation and branch-driven development deployment are operational. Run `33347078314` passed the clean PostgreSQL migration, contract verification, type-check, all 170 tests including the PostgreSQL passkey integration scenario, builds, live database migration, required runtime-secret synchronization, and both Cloudflare development deployments.
- The development console is live at `https://atharvan-console-dev.rokad.workers.dev`; the development control-plane Worker is live at `https://atharvan-control-plane-dev.rokad.workers.dev`. Anonymous dashboard requests redirect before SSR to the rendered login page, protected APIs deny access with `401`, and liveness, readiness, service binding, Better Auth session resolution, and live WebAuthn options with the exact console relying-party ID and required user verification are verified.
- Resend is the first replaceable transactional-email adapter. `RESEND_API_KEY` is installed as a required development Worker secret and the sender is pinned to `Atharvan <login@updates.arth.sh>` on the verified `updates.arth.sh` domain. A real invitation/OTP delivery still needs an approved recipient to verify provider delivery without manufacturing an operator.
- The dedicated `atharvan-development` Neon PostgreSQL 18 project is provisioned and migrations `0000` through `0016` are live. The complete schema was also recreated and contract-verified against a clean PostgreSQL 18 service in CI.
- Customer directory search is deployed but remains operationally partial until Arth supplies the first real, monotonic snapshot. The console reports the projection as `unknown` rather than presenting sample customer records or invented freshness.
- Granular user/workspace restriction intent and immutable reconciliation evidence are deployed. Enforcement remains pending until Arth consumes commands and reports the first monotonic restriction observation; Atharvan shows `pending` instead of claiming a deny is active.
- The matching Arth consumer is implemented locally with signed polling, durable idempotent receipts, monotonic restriction/ownership/model/integration/adapter authority, session revocation, lease recovery and request-time enforcement. It has compiled successfully but remains undeployed and unverified end to end.
- Append-only customer notes and immutable risk-marker revisions are deployed. Ownership transfer commands are also deployed, but remain operationally partial until a real Arth snapshot supplies explicit workspace owners and Arth reports monotonic transfer observations; membership roles are never treated as ownership.
- The platform secret-management adapter additionally needs `CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID`, `CLOUDFLARE_SECRETS_STORE_ID`, and a dedicated `CLOUDFLARE_SECRETS_STORE_API_TOKEN` with Secrets Store read/write authority. Live create/recovery/rotate/revoke verification is deferred with the environment work.
- Production deployment remains intentionally unconfigured and was not triggered from `dev`.
- Local development now uses the root `.env.local` with hosted Neon; Docker is not required. `pnpm local:check` passed read-only schema verification on 2026-09-04. After clearing rebuildable caches and pruning unused pnpm packages, C: had more than 14 GiB free and both local servers started. Worker liveness and console login return `200`, the console-to-Worker protected overview returns `401`, and an anonymous session returns `null`. Resend and Secrets Store remain unconfigured locally; real authenticated/browser verification is still outstanding.

## Phase 0 — Product and repository foundation

- [x] Draft canonical `SOURCE_OF_TRUTH.md`.
- [x] Approve canonical product scope.
- [x] Define canonical technology stack in `tech.md`.
- [x] Commit `SOURCE_OF_TRUTH.md` to `main`.
- [x] Commit `tech.md` to `main`.
- [x] Commit `progress.md` to `main`.
- [x] Inspect repository defaults, branches, and existing contents.
- [x] Define monorepo structure and package boundaries.
- [~] Add coding, testing, migration, and security conventions.
- [x] Configure CI for formatting, migration validation, type-checking, tests, and production builds.
- [x] Define the boot-only environment and secret bootstrap contract.
- [x] Record initial architecture decision records.

### Phase 0 exit evidence

- [x] Approved source-of-truth commit SHA recorded: `522ff93953bd3461c40bc982312a5f018e998c11`.
- [ ] CI passes on `main`.
- [~] Local development and test setup reproduced from a clean checkout: dependencies, local tests, Neon read-only schema verification, server startup, and anonymous HTTP smoke checks passed; authenticated browser verification remains outstanding.
- [x] No plaintext credentials or production secrets are stored in the repository.

## Phase 1 — Safe administrative foundation

### Operator identity and access

- [x] Implement operator identity domain.
- [x] Implement the singleton Super Administrator invariant and `platform:*` authority.
- [x] Enforce hard customer-private data denies outside the platform wildcard namespace.
- [x] Implement capability-based permissions and default role bundles.
- [x] Enforce server-side authorisation on every operator command.
- [~] Implement organisation email-domain allowlist administration.
- [x] Reject invitations and activation when the email domain is not allowed.
- [x] Implement invited-to-active first-login email verification code flow.
- [x] Add mandatory strong MFA/passkey policy.
- [x] Add step-up authentication for sensitive actions.
- [~] Add owner-scoped session inventory and audited revocation: implemented and verified locally, including isolated PostgreSQL rollback tests; deployment and real authenticated browser verification remain outstanding.
- [~] Operator suspension, restoration and terminal deactivation: storage, API and confirmation UI implemented with session/invitation/emergency-grant invalidation; verification deferred.
- [~] Platform ownership transfer: independently accepted exact approval, successor eligibility, atomic owner swap and session invalidation implemented; migration and verification pending.
- [~] Scoped approvals: request/review/revoke/consume lifecycle, expiry, independent base-role reviewer and transaction-bound consumption implemented for workspace transfers and emergency grants; verification deferred.
- [~] Every protected administrative mutation now forwards its command identity and persists the success receipt with the final database effect; runtime rollback/replay verification remains outstanding.
- [~] Durable verification email delivery: encrypted queue, fenced leases, bounded idempotent retries, expiry scrubbing, scheduled recovery, operator controls and overview alerts implemented; migration and runtime verification deferred. See [delivery runbook](docs/runbooks/verification-email-delivery.md).
- [~] Neon connections scoped to each HTTP/background/scheduled invocation with cleanup and deadlines; repeated-isolate/runtime verification deferred.
- [x] Add break-glass grant lifecycle with expiry and review.

### Configuration and secrets

- [x] Implement versioned platform configuration registry.
- [x] Implement configuration precedence and validation.
- [~] Implement secret-reference abstraction.
- [~] Implement credential create/rotate/revoke flows without read-back.
- [x] Define boot-only environment configuration.

### Audit and command foundation

- [x] Implement named/versioned command envelope.
- [x] Implement immutable operator audit events.
- [x] Add reason, correlation, approval, and evidence fields.
- [x] Add audit search and export.
- [x] Verify audit coverage for all Phase 1 mutations.

### Users and workspaces

- [~] Implement user/workspace search and inspection.
- [~] Display memberships and effective permissions.
- [~] Implement granular restrictions and restoration.
- [~] Implement controlled ownership recovery/transfer contracts.
- [x] Implement internal notes and risk markers.

### Models, integrations, and flags

- [~] Implement model/provider catalogue and health.
- [~] Implement model routing, fallback, maintenance, and kill switches.
- [~] Implement platform integration and OAuth application registry.
- [~] Implement adapter lifecycle and capability registry.
- [x] Implement feature flags with targeting, ownership, expiry, and history.

### Platform overview

- [~] Implement health projections from real telemetry: the overview reads current and 24-hour historical model-provider and integration probe evidence; remaining telemetry sources are not connected.
- [~] Implement runner, workflow, model, integration, and incident summaries: model/integration aggregates implemented and verified locally; runner/workflow/incident summaries remain outstanding.
- [~] Implement unknown/partial/degraded data states.
- [~] Add operational alerts for critical foundation failures: the console covers provider probes, verification delivery, provider configuration, and Arth command delivery; stable occurrences, firing/recovery email outbox, fenced retries, provider idempotency and production routing gates are implemented. Operated delivery, external uptime monitoring and full incident workflows remain outstanding.

### Phase 1 exit evidence

- [ ] Routine configuration changes require no redeployment.
- [ ] Routine operator actions require no direct database edits.
- [ ] Secret values cannot be retrieved through Atharvan.
- [ ] Every material mutation is authorised and audited.
- [ ] Critical capabilities have tested kill switches.

## Phase 2 — Commercial and execution operations

### Plans, entitlements, and billing

- [~] Implement products and immutable plan versions: domain, PostgreSQL guards,
  protected API, audit/idempotency, and operator console are implemented;
  database and authenticated browser evidence remain deferred.
- [ ] Implement entitlement snapshots and custom enterprise grants.
- [ ] Implement subscriptions and billing-provider reconciliation.
- [ ] Implement invoices, payments, refunds, disputes, and credits.
- [ ] Add signed webhook receivers and replay protection.

### Usage, quotas, and costs

- [ ] Define the canonical meter catalogue.
- [ ] Implement append-only usage ingestion and aggregation.
- [ ] Implement workspace/project attribution.
- [ ] Implement soft limits, hard limits, alerts, and enforcement.
- [ ] Implement AI, runner, preview, storage, and network cost reporting.

### Runners and workflows

- [ ] Implement managed runner pool inventory and health.
- [ ] Implement private runner registration and revocation.
- [ ] Verify runtime isolation, egress, secret scope, and resource limits.
- [ ] Implement drain, disable, capacity, and certificate rotation operations.
- [ ] Implement workflow/queue/dead-letter inspection and safe commands.

### Environments and deployments

- [ ] Implement environment and release inventory.
- [ ] Implement deployment status, policy blocks, rollout, and rollback visibility.
- [ ] Implement preview expiry and idle shutdown.
- [ ] Implement orphan/resource cleanup and reconciliation.
- [ ] Implement provider outage and drift visibility.

### Phase 2 exit evidence

- [ ] Meter totals reconcile against provider/source records.
- [ ] Billing webhook replay and out-of-order delivery are tested.
- [ ] Limits are enforced consistently under concurrency.
- [ ] Runner isolation and cleanup canaries pass in an operated environment.
- [ ] Deployment rollback and provider reconciliation are verified live.

## Phase 3 — Production governance and support

### Support and privileged access

- [ ] Implement support cases and escalation.
- [ ] Implement customer-consented, scoped, expiring support access.
- [ ] Implement redacted diagnostic bundles.
- [ ] Implement safe account recovery.
- [ ] Link support cases to platform entities and incidents.

### Security and abuse

- [ ] Implement structured security cases and evidence.
- [ ] Implement granular identity, workspace, integration, provider, and execution restrictions.
- [ ] Integrate authentication, rate-limit, runner, malware, and secret-leak signals.
- [ ] Implement investigation retention and review workflows.
- [ ] Verify tenant-isolation evidence and alerting.

### Incidents and production evidence

- [ ] Implement incident declaration, roles, timeline, containment, and recovery.
- [ ] Implement customer-visible status and maintenance communication.
- [ ] Implement production-control evidence records.
- [ ] Implement passed/failed/skipped/waived status with expiring waivers.
- [ ] Implement post-incident review and action tracking.

### Enterprise governance

- [ ] Implement SSO/SCIM administration.
- [ ] Implement advanced approvals and separation of duties.
- [ ] Implement data export, retention, deletion, and legal holds.
- [ ] Implement residency and private-runner operations.
- [ ] Implement compliance evidence export.

### Phase 3 exit evidence

- [ ] Privileged support access automatically expires and is fully audited.
- [ ] A representative incident is exercised end-to-end.
- [ ] Production readiness is generated only from deterministic evidence.
- [ ] Data export and deletion are tested against all owned stores/providers.
- [ ] Break-glass access is tested and post-event review is enforced.

## Cross-cutting quality gates

- [x] No fake data, placeholder metrics, or mock operational success states in the foundation operator shell.
- [x] No client-side-only authorisation in implemented routes.
- [x] No plaintext authentication code, secret storage, or read-back.
- [ ] No ad hoc database mutation path for routine operations.
- [ ] No high-impact external mutation without idempotency and reconciliation.
- [ ] No production-affecting command without audit and recovery/containment.
- [ ] Accessibility checks pass for operator-critical workflows.
- [~] Loading, empty, partial, failure, retry, and success states are tested.
- [ ] Schema migrations are forward-safe and have rollback/recovery procedures.
- [ ] Operational dashboards and alerts are backed by real telemetry.

## Decision log

### Immutable commercial catalogue slice — 2026-09-07

- Added environment-scoped products, immutable product revisions, stable plans,
  and immutable plan versions with exact minor-unit pricing and forward-only
  lifecycle rules.
- Added protected catalogue APIs, atomic idempotent command/audit persistence,
  and an operator workflow for product and plan revision history.
- Added migration `0029_commercial_catalogue`, readiness sentinels, immutable
  database triggers, runtime privilege checks, and operating/security contracts.
- Static type checks and the console production build passed. Stateful database,
  automated, provider, and authenticated browser verification remain deferred at
  the user's request.

### Local development slice — 2026-09-04

- Added `pnpm dev` with validated root `.env.local` loading, loopback origin/port checks, separate console/Worker processes, shutdown cleanup, and a disk-space preflight.
- Added `pnpm local:check`, reusing migration contracts in an explicit read-only transaction. No migrations or application data changes were performed by this check.
- Added optional-provider normalization, credential isolation and serialization tests, Git exclusions for `.dev.vars*`, and the [local development runbook](docs/runbooks/local-development.md).
- No deployment was performed. Full runtime/browser verification and the stateful PostgreSQL integration scenario remain outstanding.
- Verification: 185 tests passed (including 16 local-settings tests), one stateful PostgreSQL integration test skipped, workspace type checks passed, migration history passed, and the supplied Neon schema passed read-only verification. The low-disk guard was exercised and exited before starting child processes. Added LF checkout rules for consistent Windows/Linux formatting.

### Recorded health overview slice — 2026-09-04

- Replaced the static overview with environment-scoped model-provider and integration aggregates from the existing observation tables; no migration or database writes required.
- Latest observations are selected deterministically. Expired, missing, future-dated, and failed evidence cannot count as healthy. Read failures remain separate from empty registries, and overall coverage remains partial while other telemetry is absent.
- Preserved passkey/capability protection, added no-store responses, and added automatic refresh, cancellation, timeout, expiry, and recovery handling in the console.
- Verification: 210 automated tests passed, two opt-in database tests skipped in the normal suite; the new SELECT-only Neon test passed separately inside an explicit read-only transaction. Workspace types and all production builds passed. Desktop/mobile fixture checks verified rendering, refresh failure, cleared counts, and empty-state recovery using the real overview component and polling hook. Authenticated end-to-end verification and deployment remain outstanding.
- Live local browser verification confirmed the anonymous dashboard redirects to login and the protected overview API returns `401`.
- Temporary tooling cache cleanup restored approximately 6.8 GiB of free disk space after free space fell below 110 MiB. The local console and Worker were restarted. Daily project cache monitoring remains configured.
- See [recorded health overview](docs/runbooks/platform-overview.md) for semantics and validation commands.

### Operational alerts slice — 2026-09-04

- Added deterministic, environment-scoped current alerts for unavailable/degraded probes, expired/missing evidence, failed evidence reads, and missing email/secret-provider configuration. Critical signals sort first; no provider credentials or database errors enter alert payloads.
- The existing protected overview API combines stored health with configuration booleans. Alerts share the snapshot expiry, disappear while refreshing or after failed reads, and are replaced by the next snapshot. Expired outages become evidence warnings, not recovery claims.
- Added critical/all filtering with selection preserved across refresh, affected counts when known, expandable recovery guidance, and explicit limited-coverage empty states. Older responses without alert evidence fail closed during rolling deployment.
- Verification: 221 automated tests, workspace types, and builds passed. Browser fixture QA at 1440×1000 and 390×844 covered filtering, recovery guidance, failed refresh removal, and recovered empty state; no unexpected browser errors or overflow. Live anonymous access still redirects to login and denies overview API access with `401`.
- No migrations, notification delivery, or deployment were performed. Real authenticated end-to-end verification remains pending local email/passkey onboarding. See [operational alerts](docs/runbooks/operational-alerts.md).

### Operator session security slice — 2026-09-04

- Added Security navigation and `/security` for current-first own-session inventory, device/IP context, explicit snapshot/truncation states, reason/confirmation, and post-revocation refresh.
- Added protected self-service session APIs with identity derived from the authenticated request, recent passkey proof, current-session protection, named command envelopes, and atomic deletion/audit evidence. Native token-bearing list and unaudited revoke endpoints are disabled; normal sign-out remains available.
- Verification: 237 normal tests, workspace type checks, builds, formatting, and desktop/mobile browser fixture checks passed. The isolated Neon scenario additionally verified ownership, stale/absent proof rejection, idempotency, and rollback on a forced audit failure. All test fixtures rolled back. Live anonymous Security access redirects to login and the session API returns `401`.
- Created a dedicated Neon QA branch and applied existing repository migrations there; the application database and its sessions were not changed. No new migration or deployment was performed. See [session security runbook](docs/runbooks/operator-sessions.md) and [ADR 0016](docs/adr/0016-owner-scoped-session-management.md).

### Signed platform-control propagation slice — 2026-09-05

- Model/provider routing controls, platform integration lifecycle changes, and adapter release lifecycle changes now enqueue minimal signed Arth commands in the same transaction as their immutable control revision.
- Arth validates and applies those commands through monotonic authority tables, retains acknowledgement evidence, and denies GitHub-backed mutations while the integration is unavailable or the managed `github-app` release is not active, signature-verified, and security-approved. Once an adapter key is managed, undeclared versions fail closed.
- Configuration history now supports audited rollback by creating a new immutable revision after recent step-up authentication and exact typed confirmation; the prior revision remains historical evidence.
- Added Atharvan migration `0021` and Arth migration `0062`; neither migration was applied. Static type checks, production builds, formatting, lint, diff checks, and Atharvan migration-history validation passed. Runtime and provider tests remain deferred by user instruction.
- Build caches remain small (Atharvan 30.80 MiB; Arth 5.06 MiB), with 31.32 GiB free, so no cleanup was required.

### Atomic command receipts and delivery telemetry slice — 2026-09-05

- All protected administrative mutation routes now commit their replay result in the same database transaction as the final local effect. Propagated controls also include the Arth outbox entry. Secrets Store operations record success with the final lifecycle transition and retain provider-name reconciliation for uncertain external outcomes. The outer completion step treats these results as already completed, so retries cannot repeat a successful effect.
- The protected overview now reports Arth exchange configuration, evidence-read failures, commands outstanding for more than two minutes, and recent rejection/dead-letter counts. Terminal failures age out of the current-alert window after 15 minutes.
- Type checks, production builds, formatting, and diff checks passed. Runtime, database, browser, and provider verification remain deferred by user instruction.

### Durable alert routing and operational contracts slice — 2026-09-05

- Added migration `0022` for immutable alert occurrences and firing/recovery delivery records. Scheduled reconciliation deduplicates stable rules, updates open evidence, records recovery, and processes delivery with fenced leases, eight bounded retries, provider idempotency, terminal receipts, and dead letters.
- Added alert-channel health to the protected overview, including missing destination, read failure, backlog, and recent dead-letter signals. Production startup and deployment now fail closed without a deployable HTTPS origin, Resend, an authorised alert destination, Secrets Store, and the current Arth workload identity.
- Added the foundation threat model, public/internal interface compatibility contract, deployment environment contract, SLO/RPO/RTO policy, role ownership, and durable-alert ADR/runbook. All 27 type-check tasks, all 15 production build tasks, migration-history validation, formatting, and diff checks passed. Migration application and all runtime/provider verification remain deferred by user instruction.

### Scheduled provider and integration health slice — 2026-09-05

- Provider and integration revisions now support explicit public HTTPS health contracts with exact methods, accepted statuses, timeouts and intervals. The admin console exposes the complete contract and current schedule.
- The scheduled Worker creates idempotent window jobs, leases a bounded concurrent batch, blocks credential-bearing/local targets and redirects, classifies exact results, and atomically commits current-revision observations plus correlated system audit evidence. Interrupted work is recoverable and coordination records have guarded 30-day retention.
- Added migrations `0023` and `0024`, ADR 0018, the probe runbook, contract rules and threat-model coverage. All 27 static type-check tasks, all 15 production build tasks, migration-history validation, formatting and whitespace checks passed. Migrations and runtime/provider verification remain deferred by user instruction. Build/cache output is 74.78 MiB with 27.13 GiB free, so no cleanup was required.

### Correlated telemetry and probe queue health slice — 2026-09-05

- HTTP requests now continue valid W3C trace context, return trace/request identity, and emit bounded structured completion/failure evidence without headers, queries, bodies, credentials, provider responses, error messages, or stacks. Scheduled delivery/probe tasks emit correlated run, parent/child span, duration, and categorical outcome records.
- Durable probe jobs distinguish recorded observations, target-revision replacement, and exhausted recovery. The protected overview and durable alert delivery now report queue read failure, jobs delayed over two minutes, and exhaustion in the last 15 minutes.
- Added migration `0025` with safe terminal-row backfill, ADR 0019, interface/runbook/SLO/threat-model updates. All 27 static type-check tasks, all 15 production build tasks, migration-history validation, formatting and whitespace checks passed. Migration application and runtime/provider verification remain deferred by user instruction. Build/cache output is 77.77 MiB with 27.12 GiB free, so no cleanup was required.

### Versioned transactional email and feedback slice — 2026-09-05

- Transactional OTP and operational-alert mail now binds an immutable source template revision and locale selected through audited versioned configuration; English and Hindi renderers are production implementations and rollback uses the existing Settings history.
- Added a bounded, signed Resend webhook, immutable idempotent provider-event evidence, monotonic delivered/bounced/complained transitions, environment-bound pseudonymous recipient suppression, alert-destination change protection, and operator feedback visibility.
- Added migration `0026`, ADR 0020, the feedback runbook, deployment/SLO/threat-model updates, and migration contract coverage. All 27 static type-check tasks, all 15 production build tasks, migration-history validation, formatting and whitespace checks passed. Migration application and runtime/provider verification remain deferred by user instruction. Build/cache output is 83.31 MiB with 25.43 GiB free, so no cleanup was required.

### Recipient suppression recovery slice — 2026-09-05

- Active bounce, failure, provider-suppression, and complaint blocks are now visible without exposing addresses or recipient fingerprints. Ongoing blocks remain current health alerts instead of aging out with recent delivery failures.
- The active Super Administrator can restore future delivery after recent passkey step-up. Restoration is idempotent and atomic with its audit and command receipt, preserves immutable provider/origin evidence, cannot be repeated, and allows a later provider event to create a new block.
- Added migration `0027`, ADR 0021, and contract/runbook/threat-model coverage. All 27 static type-check tasks, all 15 production build tasks, migration-history validation, formatting, and whitespace checks passed. Migration application and runtime/provider verification remain deferred by user instruction. Build/cache output is 86.32 MiB with 25.39 GiB free, so no cleanup was required.

### Operational evidence retention slice — 2026-09-05

- Added a durable hourly retention workflow with unique schedule windows, fenced lease recovery, five bounded attempts, atomic cleanup/completion/audit settlement, and a 1,000-row limit per evidence category.
- Policy version 1 removes expired replay nonces after one day, completed probe jobs after 30 days, unprotected email and resolved-alert metadata after 90 days, and dependency-health observations after 365 days. Canonical audit, command, approval, and complete recipient-suppression evidence chains are preserved.
- Platform overview now exposes the policy and latest safe aggregate counts and alerts on read failure, late or failed execution, and batch saturation. Added migration `0028`, ADR 0022, and the operator runbook. All 27 static type-check tasks, all 15 production build tasks, migration-history validation, formatting, and whitespace checks passed. Migration application and runtime/database verification remain deferred by user instruction. Build/cache output is 80.95 MiB with 23.62 GiB free, so no cleanup was required.

### Fail-closed deployment readiness slice — 2026-09-05

- Process liveness remains dependency-free, while deployment readiness now validates runtime configuration, Neon connectivity, the exact migration head and hash, required retention schema safeguards, database write mode, and runtime-role privileges through one read-only query.
- Worker readiness returns safe schema evidence on success and a generic unavailable response on failure. Deployment promotion waits through Worker propagation and blocks console publication until the expected environment and schema version are ready. Migration validation rejects stale readiness constants or deployment expectations.
- All 27 static type-check tasks, all 15 production build tasks, migration-history and readiness-head validation, formatting, script syntax, and whitespace checks passed. Migration application and runtime/deployed verification remain deferred by user instruction. Build/cache output is 83.45 MiB with 22.03 GiB free, so no cleanup was required.

### Historical foundation health slice — 2026-09-05

- The protected overview now reconstructs 24 rolling hourly model-provider and integration states from immutable probe observations. Boundaries include only registered entities that existed at that time, apply original evidence expiry, preserve source read failures, and return bounded aggregate counts without entity, endpoint, latency, error, or credential details.
- The responsive console renders accessible evidence timelines with exact per-boundary counts and explicitly distinguishes sampled evidence from continuous uptime. Scheduled alert reconciliation skips the historical query and continues to use current evidence only.
- All 27 static type-check tasks, all 15 production build tasks, formatting, and whitespace checks passed. Runtime, database, browser, and provider verification remain deferred by user instruction. Build/cache output is 86.46 MiB with 25.10 GiB free, so no cleanup was required.

### Verifiable audit export slice — 2026-09-05

- Bounded event-per-line NDJSON exports now carry schema, environment, generation/range, byte length, count and truncation provenance plus an exact-body SHA-256 in standard `Content-Digest`, ETag, and stable Atharvan headers. The response remains backward-compatible, non-cacheable, and limited to 5,000 records or 16 MiB.
- The console fetches into a bounded blob, validates every required header, recomputes SHA-256 over the received bytes, and saves only a matching file with a digest-bearing filename. Before release, the service appends immutable actor, normalized scope, request correlation, count, truncation and digest evidence; a failed audit write denies the export.
- All 27 static type-check tasks, all 15 production build tasks, formatting, and whitespace checks passed. Runtime, database, browser, and security verification remain deferred by user instruction. Build/cache output is 92.49 MiB with 27.06 GiB free, so no cleanup was required.

### Architecture decisions

| Date       | Decision                                                                                                                                                                                                                                                     | Status   | Reference                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------- |
| 2026-08-28 | Atharvan will be the internal operator control plane for Arth, separate from customer workspace/project administration.                                                                                                                                      | Accepted | `SOURCE_OF_TRUTH.md`                                                          |
| 2026-08-28 | Environment variables will bootstrap the platform; normal operational and commercial configuration will live in versioned control-plane state.                                                                                                               | Accepted | `SOURCE_OF_TRUTH.md`                                                          |
| 2026-08-28 | The initial implementation will use a modular control-plane monolith with explicit domain boundaries.                                                                                                                                                        | Accepted | `SOURCE_OF_TRUTH.md`                                                          |
| 2026-08-28 | Atharvan will use a separate Neon-hosted PostgreSQL database through a provider-neutral database package.                                                                                                                                                    | Accepted | `tech.md`                                                                     |
| 2026-08-28 | TanStack Start and shadcn/ui blocks/components are the application and UI foundation.                                                                                                                                                                        | Accepted | `tech.md`                                                                     |
| 2026-08-28 | Exactly one Super Administrator may hold `platform:*`; customer-private resources remain outside that wildcard.                                                                                                                                              | Accepted | `SOURCE_OF_TRUTH.md`, `tech.md`                                               |
| 2026-08-28 | Operator membership is invitation-only, domain-allowlisted, and activated by a first-login email verification code.                                                                                                                                          | Accepted | `tech.md`                                                                     |
| 2026-08-30 | Normal operator roles are immutable versioned capability bundles; assignments are atomic and audited, while the singleton Super Administrator remains outside the assignable role catalogue.                                                                 | Accepted | `docs/adr/0002-versioned-operator-role-assignments.md`                        |
| 2026-08-30 | Normal non-secret configuration uses typed definitions, immutable revisions, and environment-over-platform-over-default resolution; credentials remain outside the registry.                                                                                 | Accepted | `docs/adr/0003-versioned-platform-configuration.md`                           |
| 2026-08-30 | Platform secret values live only in a provider behind `@atharvan/secrets`; PostgreSQL retains lifecycle metadata and Atharvan exposes no administrative read-back operation.                                                                                 | Accepted | `docs/adr/0004-platform-secret-reference-lifecycle.md`                        |
| 2026-08-30 | Model providers and models use immutable metadata revisions; provider health is append-only, expiring evidence and never inferred from catalogue presence.                                                                                                   | Accepted | `docs/adr/0005-model-provider-catalogue-and-health.md`                        |
| 2026-08-30 | Model routing uses immutable ordered policy revisions, deterministic basis-point rollout, explicit enablement, expiring maintenance, persistent kill switches, and observable fallback evidence.                                                             | Accepted | `docs/adr/0006-deterministic-model-routing-and-operational-controls.md`       |
| 2026-08-30 | Platform integrations use environment-scoped immutable revisions, secret-reference bindings, exact OAuth callbacks/scopes, explicit controls, and expiring health evidence; customer installations and tokens are excluded.                                  | Accepted | `docs/adr/0007-platform-integration-and-oauth-registry.md`                    |
| 2026-08-30 | Platform adapter releases use immutable package identity, an exact eight-capability maturity matrix, declarative contracts, evidence-gated activation, and explicit block/deprecation controls; executable packages and customer installations are excluded. | Accepted | `docs/adr/0008-versioned-platform-adapter-releases.md`                        |
| 2026-08-30 | Platform feature flags use owned append-only revisions, ordered typed targeting, deterministic basis-point buckets, mandatory review/expiry surfacing, and a fail-closed emergency kill switch; flags are not durable configuration.                         | Accepted | `docs/adr/0009-versioned-platform-feature-flags.md`                           |
| 2026-08-30 | Material platform mutations use named/versioned command envelopes, secret-safe payload and idempotency fingerprints, replayable terminal results, and append-only audit evidence; raw request payloads and idempotency keys are not retained.                | Accepted | `docs/adr/0010-named-platform-commands-and-immutable-audit.md`                |
| 2026-08-30 | Customer identity and membership metadata is a bounded, disposable projection from Arth with monotonic snapshot replacement, explicit freshness, purpose-bound audited reads, and no customer-private content; Atharvan never infers effective permissions.  | Accepted | `docs/adr/0011-customer-directory-projection-and-purpose-bound-inspection.md` |
| 2026-08-30 | Customer user/workspace restrictions use exact capability-scoped desired-state revisions and append-only Arth observations; Atharvan records intent but never claims enforcement before reconciliation.                                                      | Accepted | `docs/adr/0012-reconciled-customer-access-restrictions.md`                    |
| 2026-08-30 | Customer notes are append-only, risk markers use immutable revisions, and ownership transfers remain pending until Arth supplies explicit ownership and a monotonic reconciliation observation; ownership is never inferred from membership.                 | Accepted | `docs/adr/0013-reconciled-customer-operations.md`                             |
| 2026-08-31 | Break-glass authority uses exact 5–60 minute capability grants, approval and incident evidence, automatic expiry, guarded revocation, immutable terminal review, and command-level grant provenance.                                                         | Accepted | `docs/adr/0014-expiring-operator-break-glass-grants.md`                       |
| 2026-08-31 | Email OTP is bootstrap-only; all platform access and recent step-up evidence require a user-verified passkey session, with fail-closed credential lifecycle and no OTP recovery downgrade.                                                                   | Accepted | `docs/adr/0015-phishing-resistant-operator-passkeys.md`                       |
| 2026-09-05 | Provider and integration health uses revisioned public HTTPS contracts, durable idempotent schedule windows, fenced leases, current-revision settlement, system audit correlation and bounded retention.                                                     | Accepted | `docs/adr/0018-durable-scheduled-health-probes.md`                            |
| 2026-09-05 | HTTP and scheduled execution use W3C-compatible trace identity and bounded structured records; durable queue and audit state remain canonical operational evidence.                                                                                          | Accepted | `docs/adr/0019-correlated-edge-telemetry.md`                                  |

## Work log

| Date       | Work completed                                                                                                                                                                                                                                                                                                                                                          | Verification                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Commit/PR                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-28 | Drafted, approved, and committed the initial source-of-truth.                                                                                                                                                                                                                                                                                                           | User approval and GitHub commit                                                                                                                                                                                                                                                                                                                                                                                                                                       | `522ff93953bd3461c40bc982312a5f018e998c11`                                                                                         |
| 2026-08-28 | Defined and committed the technical stack and privileged-access boundaries.                                                                                                                                                                                                                                                                                             | GitHub commit                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `3ebf7d3cf4f3326de98d711571437a3425b09e8b`                                                                                         |
| 2026-08-28 | Built the initial monorepo, operator shell, platform worker, database boundary, CI, and branch-driven deployment workflow.                                                                                                                                                                                                                                              | Formatting, type-check, 9 tests, and production builds                                                                                                                                                                                                                                                                                                                                                                                                                | `6364d34f3c3ecd2fb609d241627c0d661152d87c`                                                                                         |
| 2026-08-28 | Published the first development slice and removed duplicate/reusable workflow coordination as failure variables.                                                                                                                                                                                                                                                        | Exactly `dev` and `main`; GitHub run `33204688336` failed before runner allocation                                                                                                                                                                                                                                                                                                                                                                                    | `4425a46daa51951facbf3fa7849865539445b9a2`                                                                                         |
| 2026-08-28 | Added operator allowlist, invitation, verification-code, email-adapter, transactional Neon, and immutable migration foundations.                                                                                                                                                                                                                                        | Formatting, migration history check, 28 tests, 7-workspace type-check, and production builds                                                                                                                                                                                                                                                                                                                                                                          | `f1e85ebc793382dc57dda4cc86137fc90379428f`                                                                                         |
| 2026-08-28 | Implemented onboarding application commands and the PostgreSQL transactional adapter for bootstrap, domain changes, invitation, challenge issuance/delivery tracking, attempt locking, and atomic activation.                                                                                                                                                           | Formatting, migration history check, 39 local tests, 8-workspace type-check, production builds, and one PostgreSQL concurrency test wired for CI                                                                                                                                                                                                                                                                                                                      | `1a0fcc83197232b4dba83f56676d3917ccfbe77e`                                                                                         |
| 2026-08-30 | Provisioned the separate `atharvan-development` Neon PostgreSQL 18 project and applied immutable migrations `0000` and `0001`.                                                                                                                                                                                                                                          | Six live tables, both Drizzle migration hashes, singleton Super Administrator index, active-state constraint, and pending-challenge index verified through Neon                                                                                                                                                                                                                                                                                                       | External development environment                                                                                                   |
| 2026-08-30 | Added Better Auth email-OTP sessions, policy-gated user/session hooks, server-side protected routes, Resend delivery, the operator identity link, and ADR 0001.                                                                                                                                                                                                         | Formatting, migration consistency, 51 local tests, 8-workspace type-check, both production bundles, and live Neon migration `0002` verification                                                                                                                                                                                                                                                                                                                       | `4126c821a74ad055292b574622342228deff9723`                                                                                         |
| 2026-08-30 | Added the first usable operator-administration surface: same-origin service-binding proxy, sign-in UI, operator directory/invitations, domain rules, safe read projections, and audited mutations.                                                                                                                                                                      | Formatting, migration consistency, 55 local tests, 8-workspace type-check, TanStack route generation, and both production bundles; rendered QA remains blocked by local preview infrastructure                                                                                                                                                                                                                                                                        | `0aec0bc999c707339e23503baf47eec35788808b`                                                                                         |
| 2026-08-30 | Added immutable versioned operator-role definitions, persistent audited assignments, role-based invitation activation, effective-authority resolution, role APIs, and the operator role-management surface.                                                                                                                                                             | Formatting, migration consistency, 61 local tests, 8-workspace type-check, TanStack SSR build, and Worker dry-run build; one PostgreSQL integration test and rendered QA remain environment-gated                                                                                                                                                                                                                                                                     | `1573f00ade16839d61f622bd48fa7ad0cd8ce1d8`                                                                                         |
| 2026-08-30 | Added the typed non-secret platform-configuration registry, immutable revisions and current bindings, deterministic precedence, audited mutations, protected APIs, first live invitation consumers, and the Settings surface.                                                                                                                                           | Formatting, migration consistency, 69 local tests, 8-workspace type-check, TanStack SSR build, and Worker dry-run build; the expanded PostgreSQL integration test and rendered QA remain environment-gated                                                                                                                                                                                                                                                            | `ecf5a57283e4b2275dea731186fdfa292cd4efc9`                                                                                         |
| 2026-08-30 | Added provider-neutral secret management, metadata-only lifecycle state, audited create/rotate/revoke commands, Cloudflare Secrets Store adapter, protected APIs, migration `0005`, and the Secrets console surface.                                                                                                                                                    | Formatting, migration consistency, 81 local tests, 9-workspace type-check, TanStack client/SSR build, and Worker dry-run build; PostgreSQL integration, live provider operations, and rendered QA remain environment-gated                                                                                                                                                                                                                                            | `b490258726dbfd0a61530279dfbf89cfce15a6c6`                                                                                         |
| 2026-08-30 | Added environment-scoped model providers, immutable provider/model revisions, active secret-reference binding, integer pricing, expiring health evidence, protected APIs, migration `0006`, ADR 0005, and the Models console surface.                                                                                                                                   | Formatting, migration consistency, 93 local tests, 10-workspace type-check, TanStack client/SSR build, and Worker dry-run build; the PostgreSQL scenario is CI-gated and rendered QA remains blocked by local preview infrastructure                                                                                                                                                                                                                                  | `872e2395dabb2c1a4e9f79fcb788695e1bd2787c`                                                                                         |
| 2026-08-30 | Added immutable task-routing policies, ordered fallback targets, deterministic basis-point rollout, explicit provider/model enablement, expiring maintenance, persistent kill switches, observable route evaluation, protected APIs, migration `0007`, ADR 0006, and the Model Routing console surface.                                                                 | Formatting, migration consistency, 105 local tests, 10-workspace type-check, TanStack client/SSR build, and Worker dry-run build; the PostgreSQL route/kill-switch scenario is CI-gated and rendered QA remains blocked by local preview infrastructure                                                                                                                                                                                                               | `02ebd4be22b7494e00295e7fb7c0f6d43deb782c`                                                                                         |
| 2026-08-30 | Added environment-scoped platform integrations, immutable OAuth/application revisions, exact callback and scope validation, adapter capabilities and versions, active secret-reference bindings, lifecycle/maintenance/kill-switch controls, expiring health evidence, protected APIs, migration `0008`, ADR 0007, and the Integrations console surface.                | Formatting, migration consistency, 113 local tests, 11-workspace type-check, TanStack client/SSR build, and Worker dry-run build; the expanded PostgreSQL scenario is CI-gated and rendered QA remains blocked by local preview infrastructure                                                                                                                                                                                                                        | `00944a9e87e5fbc976ec7a3553eb16d88b844f81`                                                                                         |
| 2026-08-30 | Added environment-scoped immutable adapter releases, exact eight-capability maturity contracts, package digest identity, permissions/configuration/command/health declarations, signing and security-review gates, release channels, block/deprecation controls, protected APIs, migration `0009`, ADR 0008, and the Adapters console surface.                          | Formatting, Drizzle migration-history consistency, 122 local tests, 12-workspace type-check, TanStack client/SSR build, and Worker dry-run build; the expanded PostgreSQL scenario, live migration, signed artifact operations, and rendered QA remain environment-gated                                                                                                                                                                                              | `4f64703c996063f9d2bd826328ec349b69df733f`                                                                                         |
| 2026-08-30 | Restored branch-driven deployment, selected the Cloudflare Vite environment at build time, attached the console service binding, ordered Worker-before-console publication, synchronized required Worker runtime secrets without read-back, set the real development origin, and deployed the complete `dev` state.                                                     | Actions run `33318604482` passed validation and deployment; migrations `0000`–`0009`, Worker liveness/readiness, console SSR, service binding, `401` protected-route denial, and Better Auth session resolution were verified live                                                                                                                                                                                                                                    | `0e3ddf7e6ba1180ab24781c53ae275965554afd6`                                                                                         |
| 2026-08-30 | Added environment-scoped feature flags with active ownership, immutable revisions, ordered targeting across plan/workspace/user/region/cohort/staff/account-age/percentage context, deterministic evaluation, review/expiry surfacing, emergency containment, protected APIs, migration `0010`, ADR 0009, and the Feature Flags console surface.                        | Formatting, migration consistency, 131 local tests, 13-workspace type-check, both production bundles, PostgreSQL-backed two-revision targeting/kill-switch verification, live Neon migration, live route `200`, Worker health, and unauthenticated `401`; Actions run `33320316142` passed                                                                                                                                                                            | `007ebc9b292a3df808135489ae62c1d673e2679b`                                                                                         |
| 2026-08-30 | Added named/versioned command envelopes to every platform mutation route, secret-safe payload fingerprints, idempotent response replay and conflict handling, immutable command/result/audit history, bounded NDJSON export, protected APIs, migration `0011`, ADR 0010, and the Audit console surface.                                                                 | Formatting, migration consistency, 137 local tests, 14-workspace type-check, production builds, PostgreSQL-backed replay/conflict/immutability verification, live Neon migration, Worker health, live `/audit` SSR, and unauthenticated `401`; Actions run `33325755499` passed                                                                                                                                                                                       | `28dfec740aaed51a9426e7d8bd609a88d1d31b32`                                                                                         |
| 2026-08-30 | Added the bounded Arth customer-directory projection, monotonic full-snapshot reconciliation, explicit unknown/current/stale status, purpose-bound audited search and inspection, exact membership/effective-permission display, protected APIs, migration `0012`, ADR 0011, and the Customers console surface.                                                         | Formatting, migration consistency, 145 local tests, 15-workspace type-check, production builds, PostgreSQL-backed replacement/revision/privacy verification, live Neon migration, live `/customers` rendered QA, and unauthenticated binding denial; Actions run `33328131152` passed                                                                                                                                                                                 | `9c53473efcdf7f2f9bbfcd75cedf158e4b4375ad`                                                                                         |
| 2026-08-30 | Added reconciled capability-scoped customer user/workspace restrictions and restoration, immutable revisions/observations, protected APIs, migration `0013`, ADR 0012, and Customers controls; configured required Resend delivery from `login@updates.arth.sh`; and moved all dashboard routes behind a pre-render authenticated layout.                               | Formatting, clean PostgreSQL 18 migration/contract verification, 150 tests, 15-workspace type-check, client/SSR/Worker builds, live Neon migration, required secret sync, anonymous dashboard `307`, login SSR `200`, and protected API `401`; Actions run `33334501288` passed                                                                                                                                                                                       | `aa2f5aee20d01caef1f5d2bde5b99ab4be5d6c5f`, `f9ccc673eb3d6fe4107e4f048ce0d6c3b5e02b15`                                             |
| 2026-08-30 | Added append-only customer notes, immutable risk-marker revisions and resolution, explicit workspace ownership projection, step-up/approval-gated transfer intent, monotonic Arth observations, protected APIs, migration `0014`, ADR 0013, and Customers controls.                                                                                                     | Formatting, clean PostgreSQL 18 migration/contract verification, 156 tests, 15-workspace type-check, client/SSR/Worker builds, live Neon migration, Worker liveness/readiness, anonymous Customers redirect/login rendering, native form validation, and protected API `401`; Actions run `33339723637` passed                                                                                                                                                        | `8eedc3093a843e47decc86ebc3f61e97d83705e5`                                                                                         |
| 2026-08-31 | Added exact, expiring operator break-glass capability grants with incident/approval evidence, automatic session-authority overlay, revocation, immutable terminal review, command provenance, protected APIs, migration `0015`, ADR 0014, and Operators controls; repaired the CI environment boundary so the PostgreSQL integration scenario runs on every validation. | Formatting, clean PostgreSQL 18 migration/contract verification, 165 tests including the PostgreSQL integration scenario, 15-workspace type-check, client/SSR/Worker builds, live Neon migration, secret sync, and both development deployments; Actions run `33344270472` passed. Worker version `954e6643-3271-427f-9817-5ea61e12e73d`; console version `1bcb1382-d6b8-4aef-aa09-bd95cdad7aed`.                                                                     | `92192ddca8486946132ba62470a99f66c393cfe9`, `497146e4bf6b3a7d3958df81bcd6692adb553a44`, `01abb6c57046e22685cc8bdf774c1acdbc0ea4b9` |
| 2026-08-31 | Added mandatory discoverable, user-verified operator passkeys, bootstrap-only email OTP, explicit session assurance, five-minute passkey-backed step-up, audited and guarded credential lifecycle, enrollment/verification console ceremonies, migration `0016`, and ADR 0015.                                                                                          | Formatting, clean PostgreSQL 18 migration/contract verification, 170 tests including final-passkey retention and session audit integration, 15-workspace type-check, client/SSR/Worker builds, live Neon migration, anonymous denial, live WebAuthn RP/user-verification contract, and both development deployments; Actions run `33347078314` passed. Worker version `b43515e7-e002-4763-b780-4b42ba633eda`; console version `bb9c4653-d3c9-458a-909d-dd00c86b511a`. | `7c31b0a179063626f2a94d65b198bfbd60f583ef`, `7156cb69f320f7adf211f4dbd95385e5d918ca8b`, `f7ed447b172226301279930756512cf6545e0790` |

# 2026-09-05

- Added a transactional Arth command outbox for customer restrictions and
  workspace ownership transfers, plus signed workload claim/acknowledgement,
  replay protection, fenced recovery and atomic observation evidence.
- Added migration `0019_arth_command_exchange.sql` and the operator runbook. The
  migration is generated but unapplied.
- Implemented the corresponding Arth command consumer, local enforcement, and
  signed directory publisher. Atharvan migration
  `0020_arth_directory_snapshot_ingestion.sql` now records immutable workload
  provenance and atomically applies monotonic snapshots. Arth migrations `0060`
  and `0061` remain unapplied; live exchange verification is deferred.
