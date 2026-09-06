# Phase 1 implementation record

Date: 2026-09-05. State: in progress; not certified or deployed.

The user requested implementation first and explicitly deferred testing. No
automated, browser, database or provider tests have been run for this change set.
Compilation does not establish runtime correctness or production readiness.
Existing test evidence elsewhere in the repository predates these changes.

Implementation checks: TypeScript compilation passed in Atharvan (27 tasks) and
Arth (33 tasks); the production console build and Worker dry-run bundle passed (15 tasks). Changed files were
formatted and the Git whitespace check passed. These commands did not deploy,
apply migrations, or execute the deferred tests.

## Implemented controls

| Control                        | Implemented behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator status                | The active Super Administrator can suspend, restore or permanently deactivate another operator after recent passkey verification, a reason and exact confirmation. Expected status prevents stale edits.                                                                                                                                                                                                                                                                        |
| Access invalidation            | Status changes delete sessions, revoke pending invitations, supersede pending verification challenges and revoke active emergency grants atomically with audit evidence. Restoration requires an allowed domain, prior activation and an enrolled passkey, and requires a new sign-in.                                                                                                                                                                                          |
| Membership domains             | Adding a previously disabled domain restores its existing record with audit evidence. Operator listings identify accounts whose domains need review. Disabling a domain does not automatically suspend existing accounts; review and suspend those accounts explicitly.                                                                                                                                                                                                         |
| Approval requests              | A stored, environment-bound request contains one closed intent: workspace ownership transfer, emergency grant, or platform ownership transfer. Requests expire after 30 minutes. Arbitrary reference strings no longer authorize protected effects.                                                                                                                                                                                                                             |
| Independent decisions          | A distinct active operator with a base Security capability approves or rejects. Emergency grants cannot supply reviewer authority; the beneficiary cannot approve their own grant. A platform ownership successor must personally accept the request. Requesters and eligible reviewers can revoke unused requests.                                                                                                                                                             |
| Scope consumption              | Requester, target, owner/source revision, successor, capability set, duration and incident reference are matched as applicable. Approval is consumed once in the same transaction as the protected effect and its audit record. Reviewer eligibility is checked again at consumption.                                                                                                                                                                                           |
| Platform ownership             | Owner and successor are locked; the successor must be active, domain-eligible and passkey-enrolled. The owner swap, approval consumption, both users' session invalidation and audit commit together. Bootstrap cannot overwrite a transferred owner.                                                                                                                                                                                                                           |
| Atomic receipts                | Every protected administrative mutation forwards the command ID into its persistence boundary and commits the replay result with the final local effect. Propagated controls include the Arth outbox record. Secrets Store success receipts commit with the final lifecycle transition. A duplicate receipt aborts a second effect.                                                                                                                                             |
| Verifiable audit export        | Bounded NDJSON exports carry exact-body SHA-256, standard digest metadata, environment/range provenance, count and truncation state. The console verifies received bytes before saving, and each released export appends immutable actor, scope, correlation and digest evidence.                                                                                                                                                                                               |
| Failure handling               | A post-effect outer completion cannot overwrite an atomic success receipt. Secrets Store failures after an uncertain provider response enter an explicit recoverable lifecycle state; exact provider-name reconciliation prevents duplicate material during provisioning recovery.                                                                                                                                                                                              |
| Console                        | Operators and Approvals include real server-backed controls, typed confirmations, decision reasons, bounded requests, server-authorized actions, and retry identity. Resource loads cancel superseded requests to prevent stale results overwriting newer state.                                                                                                                                                                                                                |
| Worker recovery                | Runtime memoization is scoped to the current HTTP context. Request, background and scheduled database pools close independently; failed initialization closes its handle. Database deadlines bound stuck operations.                                                                                                                                                                                                                                                            |
| Durable verification delivery  | The production OTP callback awaits encrypted PostgreSQL enqueue. Fenced leases, five-attempt retries, provider idempotency, expiry cleanup, scheduled processing, owner cancellation/retry and audited metadata views are implemented. Provider acceptance is distinct from inbox delivery.                                                                                                                                                                                     |
| Delivery observability         | Overview alerts report delayed work, recent dead/expired deliveries and unavailable queue evidence. The Email delivery page exposes current metadata without OTP payloads.                                                                                                                                                                                                                                                                                                      |
| Arth command producer          | Restriction and ownership intent now enqueue immutable, minimal Arth commands in the same transaction as their desired-state revision. Signed workload claim/acknowledgement endpoints use rotating keys, body digests, database-backed replay nonces, fenced leases, bounded retries and atomic observation evidence.                                                                                                                                                          |
| Arth command consumer          | The local Arth checkout now has migration-backed idempotent receipts, monotonic policy and ownership application, session revocation, signed claim/acknowledgement polling, expired-lease recovery and API enforcement for login, execution, provider, deployment, integration and runner capabilities.                                                                                                                                                                         |
| Arth directory publisher       | The local Arth checkout now creates deterministic, monotonic directory snapshots in a durable outbox. Atharvan authenticates the signed body, rejects replay and revision substitution, applies projections atomically and retains immutable ingestion provenance.                                                                                                                                                                                                              |
| Platform control propagation   | Model/provider maintenance and kill switches, integration availability, and adapter release lifecycle changes enqueue minimal signed commands atomically with their revisions. Arth validates monotonic authority, retains receipts, and blocks GitHub-backed mutations when the integration or managed adapter release is unavailable. Managed adapter keys reject undeclared versions.                                                                                        |
| Configuration rollback         | An operator can restore an exact historical scoped value by creating a new immutable revision. Recent step-up authentication, an audit reason, scope validation, and exact typed confirmation are enforced server-side; history is never rewound or deleted.                                                                                                                                                                                                                    |
| Model invocation enforcement   | Model control commands carry canonical provider/model keys into Arth. Both outbound provider runtimes require an availability policy before resolving credentials, and the PostgreSQL-backed policy evaluates provider and model maintenance/disable controls at invocation time.                                                                                                                                                                                               |
| Secret lifecycle recovery      | Failed provisioning reconciles the exact provider name before creating or replacing material, failed rotations and revocations can be retried, version numbers remain append-only across failures, and revocation is blocked while an active model provider or integration revision depends on the reference.                                                                                                                                                                   |
| Command delivery telemetry     | The protected overview reports missing Arth exchange configuration, read failures, commands outstanding for more than two minutes, and rejections/dead letters from the last 15 minutes with bounded recovery guidance. Historical terminal failures do not remain permanent current alerts.                                                                                                                                                                                    |
| Durable alert routing          | Scheduled evidence reconciliation creates one open occurrence per stable rule, durable firing/recovery deliveries, fenced leases, bounded retries, provider idempotency and immutable transition audit. Production requires an authorised alert address and provider configuration.                                                                                                                                                                                             |
| Automated dependency health    | Revisioned provider and integration probes use explicit HTTPS contracts, idempotent schedule windows, fenced recoverable leases, bounded concurrency, exact status classification, revision-safe settlement, system audit correlation and 30-day job retention. Probe URLs cannot contain credentials, query parameters, local addresses or followed redirects. The overview reconstructs 24 bounded hourly aggregate evidence states without exposing entity or probe details. |
| Correlated edge telemetry      | HTTP responses return request and W3C trace identity. Safe structured request and scheduled-task records include route/status/duration and categorical outcomes while excluding queries, bodies, headers, error messages, credentials and provider responses. Probe queue backlog, read failure and exhausted recovery are current overview and alert-delivery signals.                                                                                                         |
| Operational evidence retention | An environment-scoped hourly job uses durable unique windows, fenced leases, bounded retries and 1,000-row category limits. It removes disposable nonce, scheduler, email, resolved-alert and health metadata at documented cutoffs while preserving canonical audit, command, approval and suppression evidence. Delay, failure and batch saturation are visible in overview alerts.                                                                                           |
| Fail-closed release readiness  | Liveness remains process-only. Readiness validates full runtime configuration, exact migration head/hash, schema sentinel/trigger, writable Neon state, and required runtime-role privileges. Deployment polls the expected environment/schema after Worker publication and blocks console promotion on any mismatch.                                                                                                                                                           |
| Operational contracts          | The threat model, interface compatibility rules, environment contract, measurable SLO/RPO/RTO targets, deployment order and role ownership are repository-managed. Concrete owners/destinations and operated evidence remain production prerequisites.                                                                                                                                                                                                                          |
| CI integration entry point     | CI/deployment validation requires an uncached, explicitly disposable database suite. Mutation tests cannot fall back to application credentials. Existing fixtures were adapted to stored approvals, but have not been executed against this migration.                                                                                                                                                                                                                         |

## Database and deployment order

`0017_scoped_approvals.sql` creates approval storage, immutable-intent/transition
guards, and the deferred active-owner preservation trigger. It permits first
bootstrap activation while protecting an established active owner. The migration
contract checks require the new table and triggers. The migration is **not applied**
to local Neon, the previous QA branch or a deployed environment in this execution.
Migration `0018_verification_email_outbox.sql` adds the durable OTP delivery queue
and transition guard and also remains unapplied. See the
[delivery runbook](verification-email-delivery.md) for processing and recovery.
Migration `0019_arth_command_exchange.sql` adds the Arth outbox, replay nonce
ledger, workload attribution and transition guards and remains unapplied. See the
[command exchange runbook](arth-command-exchange.md).
Migration `0020_arth_directory_snapshot_ingestion.sql` adds signed snapshot
provenance and immutable ingestion history and also remains unapplied. Arth
migration `0061` supplies the matching leased publication outbox.
Migration `0021_arth_platform_controls.sql` extends the command outbox for model
routing, integration, and adapter release control revisions. Arth migration `0062`
adds the matching authority tables plus request-time integration and adapter
enforcement. Both remain unapplied. Migration
`0022_operational_alert_delivery.sql` adds durable alert occurrences and
firing/recovery delivery leases and also remains unapplied.
Migrations `0023_platform_health_probes.sql`,
`0024_platform_health_probe_constraints.sql`, and
`0025_platform_health_probe_outcomes.sql` add scheduled observation identity,
revisioned probe contracts, durable leases, categorical terminal outcomes,
database validation and transition guards. They also remain unapplied. See
[scheduled health probes](scheduled-health-probes.md).
Migration `0026_transactional_email_feedback.sql` adds immutable template and
locale identity, authenticated provider feedback, monotonic delivery outcomes
and pseudonymous recipient suppression. It remains unapplied. See
[transactional email feedback](transactional-email-feedback.md).
Migration `0027_recipient_suppression_recovery.sql` adds one-way audited
recipient restoration while retaining provider and suppression evidence. It
also remains unapplied.
Migration `0028_operational_evidence_retention.sql` adds guarded hourly run
records for the bounded retention policy. It also remains unapplied. See the
[operational retention runbook](operational-retention.md).

After testing is authorized again, apply the complete migration history to a
fresh disposable database, run the required suite and new security scenarios,
then verify authenticated browser flows and real provider boundaries. Apply the
reviewed migration to the destination before deploying the corresponding Worker
and console. Do not serve these controls against an unmigrated database.

The new approval policy intentionally rejects older free-text approval references.
Previously persisted transfer/grant history remains intact. Operators must create
and obtain an accepted stored approval for a new protected action. No migration
manufactures approvals for historical strings.

## Operator workflow

1. Request approval from the workspace-transfer, emergency-access or platform
   ownership form. Retain the returned approval ID.
2. An eligible independent reviewer opens **Approvals**, inspects the exact scope,
   verifies their passkey and records a decision reason. Platform ownership must
   be accepted by the selected successor.
3. The requester executes the same scope with the accepted approval ID before
   expiry. A changed scope or ineligible reviewer requires a new approval.
4. On an uncertain response, refresh the affected record and audit history before
   starting another action. Retry the same command identity when supported.
   Platform ownership signs out both parties; the successor signs in again.

Approval actions do not send email. Resend remains optional for implementation
but necessary to exercise actual onboarding delivery. Do not bypass activation
or passkey policy to work around missing provider configuration.

## Remaining work in Phase 1

- Deployed Arth producer/consumer integration, command acknowledgements, policy
  enforcement and freshness evidence. The signed monotonic snapshot path is
  implemented but has not been exercised against a deployed environment. Repository
  access was confirmed for `KartikeyAI/Arth.sh`; that is not deployment evidence.
- Operated verification of secret lifecycle recovery, model invocation controls,
  configuration rollback, automated provider/integration probes, and
  provider/integration/adapter propagation.
- Operated verification of alert firing, deduplication, delivery, recovery,
  dead-letter handling, and total-outage monitoring at the authorised destination.
- Operated verification of signed transactional-email feedback, replay handling,
  delivery/bounce/complaint precedence, suppression and template rollback.
- Resume all deferred verification, including approval expiry/races/rollback,
  owner bootstrap/transfer invariants, session invalidation, provider failures,
  authenticated UI and required Phase 1 exit gates.

No completion checkboxes are promoted on the basis of implementation or compilation
alone. Phase 2 has not started.
