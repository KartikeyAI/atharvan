# Atharvan: three-phase production delivery plan

Created: 2026-09-04. Status: execution plan; no phase is certified complete.

Execution instruction updated 2026-09-04: the user explicitly deferred testing
and requested implementation first. Continue Phase 1 implementation without
running automated, browser, database, or provider tests. Formatting, type
compilation and production builds remain implementation checks. Do not apply
database migrations or send test email as a substitute for deferred verification.
The exit gates below remain required before phase certification; this instruction
changes their timing, not their acceptance standard. See the
[Phase 1 implementation record](runbooks/phase-one-implementation.md).

This plan compiles all remaining work in `SOURCE_OF_TRUTH.md`, `tech.md`, and
`progress.md`. It preserves their product and privacy boundaries. It replaces
small-slice delivery as the execution unit: each subsequent execution targets one
whole phase, in order. Existing implementations are completed and verified rather
than rebuilt merely to match this document.

## Delivery contract

- Each execution implements its phase through persistence, policy, API, UI,
  integration, failure recovery, automated tests, operated verification, and
  documentation. It does not stop after scaffolding or a demonstration.
- A phase remains in progress until every mandatory exit gate passes. Missing
  credentials, external services, customer consent, or access are explicit
  blockers, never reasons to substitute fake success or mark the phase complete.
  Complete independent work before requesting the exact remaining prerequisite.
- Test doubles and synthetic fixtures belong only in tests. Production paths must
  use working integrations. Unsupported configuration fails explicitly; a stored
  intent, interface, preview, or simulated response is not proof of enforcement.
- Do not silently defer scope, lower a gate, or carry unfinished mandatory work
  into the next phase. A resumed execution continues the same incomplete phase.
- Completion requires evidence tied to a reviewed commit and tested environment.
  Browser fixtures supplement, but do not replace, authenticated end-to-end tests
  through the deployed API, real database, and applicable provider.
- Phase 3 produces a deployable release candidate and a rehearsed release path.
  Actual production publication is a separate action. Planning is not permission
  to send messages, charge customers, mutate customer resources, or publish.
- No system can be guaranteed flaw-free. The release standard is complete agreed
  scope, all mandatory gates passed, no unresolved release-blocking defects, no
  known critical/high security findings, and measured recovery evidence.

## Architecture and implementation boundaries

Retain the modular TypeScript monorepo: TanStack Start/React with shadcn UI;
Hono on Cloudflare Workers; Better Auth with passkeys; Drizzle/PostgreSQL behind
`@atharvan/db`, hosted in a dedicated Neon project. Local development uses Neon
without Docker. Keep the portable PostgreSQL contract and existing CI database
coverage.

Atharvan owns operator policy, versioned administrative state, command/workflow
history, approvals, financial and usage records, and evidence. Arth owns customer
state and workload execution. Exchange data through authenticated, versioned
platform APIs/events, never direct access to Arth's database. Customer-private
data remains outside `platform:*`, including for the Super Administrator.

Add bounded domain packages for durable operations, commercial records, metering,
runtime operations, support, governance, and observability as their phases need
them. Keep provider SDKs in adapters. Extend the existing Worker through domain
modules rather than continuing to accumulate unrelated logic in one route file.

Use transactional command/audit/event persistence and an outbox/inbox, with
Cloudflare durable workflow/queue execution behind explicit ports. Specify
idempotency, retries, timeouts, cancellation, dead letters, and reconciliation
before adding external mutations. PostgreSQL is canonical; provider observations
and dashboard projections record source, revision, environment, and freshness.
Never claim exactly-once external delivery; prove deduplicated effects under
at-least-once delivery and uncertain outcomes.

Commercial design separates immutable plan versions, entitlement snapshots,
append-only usage, quota reservations, and financial adjustments. Currency and
unit arithmetic must be exact. Platform/workspace/project rules may narrow
authority and allowance, never expand them past higher-level constraints.

## Baseline and prerequisites

The local baseline has operator, configuration, secret-reference, model, routing,
integration, adapter, flag, audit, and customer-operation foundations. The latest
session slice passed 237 normal tests plus isolated PostgreSQL and browser
fixture checks. That evidence does not certify real authenticated operation or
production readiness. Local changes have not yet been promoted as a release.

The backlog records missing real Arth snapshots and command acknowledgements;
local Resend and Secrets Store are unconfigured. Runtime, billing, incidents,
support, and enterprise governance are substantially outstanding. The production
workflow now requires an injected deployable HTTPS origin and complete email,
alert, Secrets Store, and Arth workload configuration; the actual values,
provider resources, and release controls still need operated verification.

Resolve dependencies at the start of Phase 1, before committing to external
implementation contracts. Keep actual credentials out of this plan and Git.

| Prerequisite                                                                                | Needed for                                                    | Completion condition                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Resend configuration, verified sender, authorised test inbox, operator participation        | Phase 1 onboarding and notifications                          | Real delivery, OTP activation, passkey enrollment and sign-in verified without bypass                    |
| Scoped Secrets Store credentials and dedicated test resources                               | Phase 1 secret lifecycle                                      | Create, rotate, revoke, failure reconciliation and no-read-back verified                                 |
| Arth repository/API access, service identity, test tenant and consumer deployment           | Phase 1 customer controls; Phase 2 execution and entitlements | Real producers and consumers deployed, contract-tested, and observable                                   |
| Provider test accounts, model/integration resources and adapter signing identity            | Phase 1 routing/integrations                                  | Actual probes, enforcement, signature verification and recovery exercised                                |
| Selected billing provider, test merchant/webhook access, commercial rules                   | Phase 2 paid operations                                       | Supported currencies/tax handling, plans, refund rules and reconciliation contract recorded              |
| Execution/deployment provider access and an isolated operated runner                        | Phase 2 runtime operations                                    | Actual job, isolation, cleanup and rollback canaries can run                                             |
| Test enterprise identity provider, consent participant, owned-store inventory               | Phase 3 enterprise governance                                 | SSO/SCIM, support consent, export/deletion and retention verified                                        |
| Production domains, environment access, telemetry/alert destinations and operational owners | Design in Phase 1; certify in Phase 3                         | Deployment settings, SLOs, capacity envelope, retention, recovery targets and on-call ownership recorded |

Provider-specific choices must be recorded before implementation and checked
against current official documentation. Access to a service must not be assumed
from its mention in the backlog. Use dedicated test resources and authorised
recipients; customer production resources are not test fixtures.

## Phase 1 — Complete and prove the administrative foundation

Outcome: operators can safely configure and control Arth through real, audited
workflows; every existing foundation surface works end to end.

### Work packages, in execution order

1. **Engineering and dependency closure.** Reproduce the current checkout,
   preserve/review existing local changes, resolve the prerequisite inventory,
   and establish isolated integration environments. Bring regression, browser,
   migration and portability tests into repository-managed CI. Establish threat
   model, data classification, API/event contracts, operational ownership,
   capacity expectations and measurable service/recovery targets.
2. **Identity and authority.** Finish domain allowlist lifecycle, invitations,
   OTP/passkey onboarding, operator suspension/deactivation/reactivation,
   capability/session invalidation, own-session revocation, singleton ownership
   transfer, and safe bootstrap. Verify CSRF/origin/cookie/replay controls, rate
   limits, enumeration resistance and concurrent invariants. Implement a shared
   approval record with distinct eligible approver, exact command/target/version,
   expiry, revocation, and one-time consumption; a supplied reference string alone
   must not authorise an ownership transfer or critical command. Preserve
   break-glass expiry/review and final-passkey protections.
3. **Durable operations and audit.** Implement outbox/inbox delivery, durable
   execution, idempotency conflict/replay, bounded retries, uncertainty handling,
   cancellation/containment, dead letters and scheduled reconciliation. Resolve
   crash windows between command, effect, audit and result completion. Audit all
   material writes and sensitive reads, approvals and automated actions; provide
   bounded search/export, provenance and retention controls.
4. **Configuration, credentials and providers.** Finish versioned configuration
   consumers and rollback without redeployment. Operate real secret creation,
   rotation and revocation without read-back. Finish model/provider policy,
   classification/region/BYOK restrictions, pricing/rate limits, routing,
   fallback/circuit breaking, maintenance and kill switches in the actual Arth
   consumer. Exercise OAuth scopes/callbacks/webhooks, refresh/revocation health,
   signed adapter activation, compatibility, rollout and deprecation. Verify
   flag targeting, expiry, kill switches and policy precedence in consuming code.
5. **Customer control integration.** Connect monotonic directory snapshots with
   real users, organisations, workspaces, memberships, explicit owners and
   effective permissions. Complete purpose-bound inspection, notes/risk markers,
   granular restrictions/restoration and approved ownership recovery/transfer.
   Deliver commands to Arth, enforce them there, and reconcile observations;
   stale or missing acknowledgements must remain pending/unknown.
6. **Telemetry and communication foundation.** Add correlated, redacted
   OpenTelemetry instrumentation, scheduled real probes, dependency readiness,
   freshness/lag/error measures, current and historical foundation health, and
   durable alert routing/deduplication/recovery. Implement versioned transactional
   templates, recipient policy, localisation, delivery/bounce failure handling
   and template rollback. Complete responsive, accessible foundation workflows
   and all loading/empty/partial/stale/forbidden/failure/retry/success states.

### Mandatory exit evidence

- A real invited operator receives an OTP, activates, enrolls a passkey, signs
  in, performs allowed commands, and is denied unauthorised/private-data access.
  Session revocation, suspension, permission changes and step-up expiry take
  effect; races cannot violate singleton or single-use authentication rules.
- Configuration changes and rollback affect a real consumer without deployment;
  secret lifecycle and provider outage/recovery pass against actual test services.
  Audit, logs, exports and client bundles contain no secret values.
- A real Arth test workspace is projected, restricted, denied at execution time,
  restored and reconciled; ownership transfer requires a valid distinct approver.
  Duplicate/out-of-order/stale observations cannot reverse current authority.
- Kill switches stop the applicable real consumer. Durable work survives worker
  interruption and ambiguous provider responses without duplicate material effects.
- Authenticated desktop/mobile and accessibility checks pass for every foundation
  workflow; real alert delivery is verified to an authorised destination.
- CI passes at the recorded development commit, including all relevant opt-in
  database scenarios as required jobs, migrations and supported upgrades. Record
  deployment/configuration evidence for the development environment. No Phase 1
  implementation, integration or mandatory verification remains outstanding.

## Phase 2 — Complete commercial and execution operations

Outcome: Atharvan can sell, meter, limit, reconcile and operate paid Arth workloads
using real provider state. Depends on the certified Phase 1 foundation.

### Work packages, in execution order

1. **Commercial catalogue and entitlements.** Products, immutable monthly/annual/
   enterprise/grandfathered plan versions, negotiated terms, trials, coupons,
   currencies and tax-provider handling; versioned entitlement snapshots,
   enterprise grants, seats, included allowances, overages and lifecycle changes.
   Editing plans never rewrites existing customer contracts silently.
2. **Billing integration and financial history.** Actual provider subscriptions,
   invoices, payments, refunds, disputes and credits with scoped permissions,
   step-up/approval where required, exact arithmetic and append-only corrections.
   Signed webhook inbox, timestamp/replay protection, duplicate/out-of-order
   handling, scheduled reconciliation, discrepancy resolution and audit links.
3. **Usage, limits and costs.** Canonical meters for model tokens/calls/embeddings/
   agents, runner CPU/memory/time/concurrency, preview/browser minutes, storage,
   artifacts/retention/network, deployments/provider operations, indexing and
   telemetry ingestion. Validate source identity, units and tenant attribution;
   handle late events and additive corrections. Implement concurrent reservation,
   commit/release, soft/hard thresholds, alerts and actual Arth enforcement.
   Reconcile usage, allowance, provider costs and customer charges independently.
4. **Runners and workflows.** Real managed pool inventory, regions/images/resource
   classes, private registration, heartbeat/health, identities/certificate
   rotation/revocation, capacity, drain and disable. Verify isolation, egress,
   secret scope and resource limits in the execution plane. Add bounded workflow,
   queue and dead-letter inspection and safe retry/cancel/class-pause/drain/replay/
   reconciliation commands; never directly rewrite workflow history.
5. **Environments and deployments.** Actual environment/release/deployment
   inventories, policy blocks and evidence, staged rollout and rollback commands,
   drift/provider outage visibility, preview expiry/idle shutdown, artifact
   retention, orphan cleanup and reconciliation. Honour workspace policy and
   explicit approval for production-affecting operations.
6. **Integrated operational views.** Complete growth, execution/ChangeSet, queue,
   runner, preview/deployment, model latency/token/spend, integration/connection,
   revenue/payment and cost projections. Show historical trends and current
   source coverage/freshness; alerts must link to real corrective workflows.

### Mandatory exit evidence

- A real provider test-mode customer completes trial/subscription/invoice/payment,
  plan change, cancellation and refund/credit/dispute scenarios with reconciled
  records. Duplicate, reordered, delayed, invalid and lost-response webhook cases
  produce correct outcomes. Provider-declared test mechanisms are acceptable;
  application-side fabricated payment success is not.
- Real test workloads emit all supported meter types, map to the correct tenant,
  reconcile against source/provider records, and produce exact expected charges.
  Concurrent requests cannot overspend hard limits; cancellation and failed work
  release reservations correctly. Reconciliation detects missing/extra usage.
- An operated runner proves isolation, egress/secret/resource boundaries and
  revocation; a real workflow is retried/cancelled and recovered from a dead letter
  safely. Private runner lifecycle and certificate rotation are exercised.
- A real test deployment rolls forward and back; preview expiry and orphan
  cleanup remove only authorised resources. Provider outages and delayed state
  converge without false success or cross-tenant effects.
- Critical commercial/runtime UI and accessibility flows, migration/upgrade,
  concurrency, API, database and provider integration suites pass in CI and the
  operated test environment. Every Phase 2 feature has telemetry, audit evidence
  and a verified recovery path; no mandatory dependency remains simulated.

## Phase 3 — Complete enterprise governance and certify the release

Outcome: the full agreed platform is supportable, governable, recoverable and
ready for an authorised production deployment. Depends on certified Phases 1–2.

### Work packages, in execution order

1. **Support and recovery.** Cases, assignment/escalation, entity/incident links,
   safe account recovery, customer-consented diagnostic access and redacted
   diagnostic bundles. Consent binds purpose, ticket, resources, actions and
   expiry; withdrawal and expiry are enforced at every access path in Arth.
   Private data access never follows from a platform wildcard.
2. **Security and abuse.** Structured investigations/evidence, retention and
   reviews; ingest authentication, rate-limit, runner, malware, secret-leak,
   webhook and tenant-isolation signals. Finish identity/IP/workspace/provider/
   integration/execution containment and audited restoration through actual
   consumers. Validate redaction across diagnostics, telemetry and exports.
3. **Incidents and communications.** Declaration, severity, incident roles,
   timeline, escalation, containment, recovery, maintenance and customer-visible
   status; in-product announcements and authorised notifications with delivery
   health. Post-incident review, action ownership and completion evidence.
4. **Enterprise identity and policy.** SSO/SCIM administration with a real test
   identity provider, deprovisioning/session invalidation, group mappings,
   separation of duties and policy-driven approvals. Preserve mandatory operator
   passkeys and hard privacy boundaries. Enforce enterprise residency and private
   runner policies in storage/processing/placement consumers, not just metadata.
5. **Data governance and evidence.** Export, retention, deletion, legal holds and
   recovery windows across every owned store, projection, artifact and provider.
   Respect holds and audit-retention obligations; exercise failure and retry.
   Add production-control records with deterministic passed/failed/skipped/waived
   results, reviewer/scope/evidence/expiry, and compliance evidence exports.
6. **Release engineering and hardening.** Configure verified production origins,
   bindings, credentials and environment separation; protected promotion and
   required CI gates; consistent schema/application rollout and compatibility;
   migration/restore/rollback runbooks; artifact provenance, dependency/secret
   scans, vulnerability remediation and reviewed release diff. Replace remaining
   disabled navigation or incomplete production paths with completed features.
   Exercise load/soak, connection/resource bounds, outage/retry storms, alert
   routing, backup restoration, telemetry retention and operational ownership.

### Mandatory release gate

- Every requirement in the coverage table below has implementation and operated
  evidence at the release candidate commit. Re-run earlier phase critical paths
  against that candidate; old evidence alone cannot certify changed behaviour.
- Real SSO/SCIM lifecycle, consent grant/use/revoke/expiry, account recovery,
  investigation containment, incident response and break-glass expiry/review
  journeys pass, including privacy and separation-of-duties denial cases.
- Export/deletion/retention/legal-hold tests cover all owned stores and provider
  resources, including projection rebuilds and restored backups. A documented
  strategy prevents deleted data from reappearing after recovery.
- All required unit, property/concurrency, API, database portability, clean/upgrade
  migration, authenticated E2E, accessibility, security, provider and operated
  isolation/cleanup/reconciliation suites pass. Required tests may not silently
  skip when credentials or infrastructure are missing.
- Load/soak and failure tests meet the capacity, latency/error, recovery-point and
  recovery-time targets recorded in Phase 1. Restore and rollout/rollback drills
  provide measured results, not merely written procedures.
- No release-blocking defects, known critical/high security findings, unfinished
  mandatory functionality, fake production data, no-op handlers or placeholder
  provider success paths remain. Missing/stale evidence blocks certification.
  The platform supports waivers, but waivers cannot substitute for completion of
  this plan's mandatory release gates.
- Production configuration preflight passes: valid domains/TLS/auth relying-party
  settings, separate database/secrets, least-privilege identities, required
  providers, workflow/queue bindings, migration state, telemetry, backups and
  on-call/alert destinations. No default/invalid origin or development identity
  remains in the release configuration.
- The release candidate is deployed and exercised in a production-like staging
  environment. Its immutable artifacts, checksums/provenance, schema versions,
  configuration inventory, deployment steps, rollback/forward-fix/restore steps,
  smoke tests, remaining non-blocking risks and operational owners are packaged.
  Promotion to production requires the recorded release gate and authorisation.

## Scope coverage and phase ownership

These rows are coverage requirements, not completion claims. Detailed checkboxes
and evidence belong in `progress.md`; all original unfinished items remain open
until their mapped work and acceptance criteria pass.

| Canonical scope                                           | Phase ownership and required finish                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Repository/engineering foundation; original Phase 0 exits | Phase 1 repeatable setup/CI; Phase 3 protected production promotion and CI on release/main                                              |
| 7.1 Overview                                              | Phase 1 provider/customer/auth health; Phase 2 growth/commercial/runtime history; Phase 3 security/incidents/readiness                  |
| 7.2 Users, organisations, workspaces                      | Phase 1 identity/projections/restrictions/ownership; Phase 2 commercial state; Phase 3 consent and data lifecycle                       |
| 7.3 Plans, pricing, subscriptions, entitlements           | Phase 2 all catalogue, commercial terms and provider financial flows                                                                    |
| 7.4 Usage, quotas, cost controls                          | Phase 2 all meters, attribution, limits, enforcement and reconciliation                                                                 |
| 7.5 Models and providers                                  | Phase 1 real policy/routing/credentials/health; Phase 2 metering and cost projections                                                   |
| 7.6 Integrations and adapters                             | Phase 1 complete provider lifecycle and signed activation; Phase 2 commercial/runtime adapter consumers                                 |
| 7.7 Runners and execution                                 | Phase 2 operated fleet/isolation/cleanup; Phase 3 enterprise residency governance                                                       |
| 7.8 Workflows/jobs                                        | Phase 1 durable foundation; Phase 2 complete operations; Phase 3 governance workflow consumers                                          |
| 7.9 Environments/deployments/releases                     | Phase 2 runtime operations; Phase 3 Atharvan production release certification                                                           |
| 7.10 Flags/configuration                                  | Phase 1 real consumption, staged rollout, expiry and rollback                                                                           |
| 7.11 Security/trust/abuse                                 | Phase 1 preventive boundaries; Phase 2 runtime canaries; Phase 3 full signal/investigation/containment workflows                        |
| 7.12 Audit/policy/production evidence                     | Phase 1 command/audit/approval primitives; Phase 3 enterprise approvals, certification and export                                       |
| 7.13 Support/incidents                                    | Phase 2 financial adjustment primitives; Phase 3 full consent, recovery, case and incident operations                                   |
| 7.14 Notifications/communication                          | Phase 1 templates/routing/delivery; Phase 2 usage/billing/runtime alerts; Phase 3 status/maintenance/announcements                      |
| Enterprise requirements in progress.md                    | Phase 3 SSO/SCIM, separation of duties, legal holds, retention/deletion/export, residency and compliance                                |
| Source-of-truth sections 8–12 and 14; technical contract  | Enforced in every phase: configuration precedence, privacy, security, canonical data, named commands, durability and definition of done |

## Evidence and handoff for each execution

Maintain a phase checklist in `progress.md` linked to this plan. For each completed
work package record the requirement, implementation paths, commit, environment,
test/run identifiers, observed result, redacted evidence location, migration and
recovery outcome, and any blocker. Keep credentials and private customer payloads
out of evidence. Record resource cleanup and continued cache/disk checks.

End an execution with either a fully evidenced phase completion or the exact
unresolved prerequisite and the work already completed. Never relabel partial
completion as an enterprise-ready phase. Phase 3's final artifact is the release
readiness dossier and deployable candidate, not a promise of zero future bugs.

Next execution: Phase 1, starting with prerequisite verification and converting
existing authentication/provider checks into real, repository-managed E2E gates.
